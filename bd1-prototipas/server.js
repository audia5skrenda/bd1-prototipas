const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const Database = require("better-sqlite3");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "works.json");
const COMPANIES_FILE = path.join(DATA_DIR, "companies.json");
const IMPORTED_EMAILS_FILE = path.join(DATA_DIR, "importedEmails.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const DB_FILE = path.join(DATA_DIR, "app.db");

// Užtikrinam, kad failas egzistuoja
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}
if (!fs.existsSync(DATA_FILE) || fs.readFileSync(DATA_FILE, "utf8").trim() === "") {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}
if (!fs.existsSync(COMPANIES_FILE) || fs.readFileSync(COMPANIES_FILE, "utf8").trim() === "") {
  fs.writeFileSync(COMPANIES_FILE, JSON.stringify([]));
}
if (!fs.existsSync(IMPORTED_EMAILS_FILE) || fs.readFileSync(IMPORTED_EMAILS_FILE, "utf8").trim() === "") {
  fs.writeFileSync(IMPORTED_EMAILS_FILE, JSON.stringify([]));
}
if (!fs.existsSync(SETTINGS_FILE) || fs.readFileSync(SETTINGS_FILE, "utf8").trim() === "") {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
    autoEmailProcessing: true
  }, null, 2));
}
if (!fs.existsSync(USERS_FILE) || fs.readFileSync(USERS_FILE, "utf8").trim() === "") {
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    {
      id: createSeedId(1),
      name: "Admin",
      role: "admin",
      password: "admin",
      createdAt: new Date()
    },
    {
      id: createSeedId(2),
      name: "User",
      role: "user",
      password: "user",
      createdAt: new Date()
    }
  ], null, 2));
}

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Pagalbinės funkcijos
function readJsonFile(filePath, fallback = []) {
  const fileContents = fs.readFileSync(filePath, "utf8").trim();

  if (!fileContents) {
    return fallback;
  }

  try {
    return JSON.parse(fileContents);
  } catch (error) {
    console.error(`Nepavyko perskaityti ${path.basename(filePath)} migracijai.`, error);
    return fallback;
  }
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function parseJsonValue(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function boolToInt(value) {
  return value ? 1 : 0;
}

function intToBool(value) {
  return Boolean(value);
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name ON companies (lower(name));

    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS imported_emails (
      uid INTEGER PRIMARY KEY,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS email_overrides (
      uid INTEGER PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS rejected_emails (
      uid INTEGER PRIMARY KEY,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      password TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
  `);

  migrateJsonData();
}

function migrateJsonData() {
  const companyCount = db.prepare("SELECT COUNT(*) AS count FROM companies").get().count;
  const workCount = db.prepare("SELECT COUNT(*) AS count FROM works").get().count;
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  const settingsCount = db.prepare("SELECT COUNT(*) AS count FROM settings").get().count;
  const importedCount = db.prepare("SELECT COUNT(*) AS count FROM imported_emails").get().count;

  const insertCompany = db.prepare(`
    INSERT OR IGNORE INTO companies (id, name, address, phone, email, created_at, updated_at)
    VALUES (@id, @name, @address, @phone, @email, @createdAt, @updatedAt)
  `);
  const insertWork = db.prepare(`
    INSERT OR IGNORE INTO works (id, payload_json, created_at)
    VALUES (@id, @payloadJson, @createdAt)
  `);
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, name, role, password, created_at, updated_at)
    VALUES (@id, @name, @role, @password, @createdAt, @updatedAt)
  `);
  const insertImportedEmail = db.prepare(`
    INSERT OR IGNORE INTO imported_emails (uid, created_at)
    VALUES (?, ?)
  `);
  const upsertSetting = db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const migrate = db.transaction(() => {
    if (!companyCount) {
      readJsonFile(COMPANIES_FILE).forEach(company => {
        if (!company?.name || !company?.address) {
          return;
        }

        insertCompany.run({
          id: Number(company.id) || createId(),
          name: normalizeValue(company.name),
          address: normalizeValue(company.address),
          phone: normalizeValue(company.phone),
          email: normalizeValue(company.email),
          createdAt: toIsoDate(company.createdAt) || new Date().toISOString(),
          updatedAt: toIsoDate(company.updatedAt)
        });
      });
    }

    if (!workCount) {
      readJsonFile(DATA_FILE).forEach(work => {
        if (!work?.id) {
          return;
        }

        const normalizedWork = normalizeWorkForStorage(work);
        insertWork.run({
          id: Number(normalizedWork.id),
          payloadJson: JSON.stringify(normalizedWork),
          createdAt: toIsoDate(normalizedWork.createdAt) || new Date().toISOString()
        });
      });
    }

    if (!userCount) {
      readJsonFile(USERS_FILE).forEach(user => {
        if (!user?.name) {
          return;
        }

        insertUser.run({
          id: Number(user.id) || createId(),
          name: normalizeValue(user.name),
          role: user.role === "admin" ? "admin" : "user",
          password: normalizeValue(user.password) || (user.role === "admin" ? "admin" : "user"),
          createdAt: toIsoDate(user.createdAt) || new Date().toISOString(),
          updatedAt: toIsoDate(user.updatedAt)
        });
      });
    }

    if (!settingsCount) {
      const settings = {
        autoEmailProcessing: true,
        ...readJsonFile(SETTINGS_FILE, {})
      };

      Object.entries(settings).forEach(([key, value]) => {
        upsertSetting.run(key, JSON.stringify(value));
      });
    }

    if (!importedCount) {
      readJsonFile(IMPORTED_EMAILS_FILE).forEach(uid => {
        if (uid) {
          insertImportedEmail.run(Number(uid), new Date().toISOString());
        }
      });
    }
  });

  migrate();
}

function normalizeWorkForStorage(work) {
  return {
    ...work,
    id: Number(work.id) || createId(),
    createdAt: toIsoDate(work.createdAt) || new Date().toISOString(),
    updatedAt: toIsoDate(work.updatedAt),
    sentAt: toIsoDate(work.sentAt),
    emailErrorAt: toIsoDate(work.emailErrorAt),
    affectedCompanies: work.affectedCompanies || [],
    affectedCompanyRefs: work.affectedCompanyRefs || [],
    companyIds: work.companyIds || [],
    sentNotifications: work.sentNotifications || [],
    emailSent: Boolean(work.emailSent)
  };
}

function readWorks() {
  return db.prepare("SELECT payload_json FROM works ORDER BY created_at DESC, id DESC")
    .all()
    .map(row => parseJsonValue(row.payload_json, null))
    .filter(Boolean);
}

function writeWorks(data) {
  const replaceWorks = db.transaction(works => {
    db.prepare("DELETE FROM works").run();
    const insert = db.prepare("INSERT INTO works (id, payload_json, created_at) VALUES (?, ?, ?)");

    works.forEach(work => {
      const normalizedWork = normalizeWorkForStorage(work);
      insert.run(normalizedWork.id, JSON.stringify(normalizedWork), toIsoDate(normalizedWork.createdAt));
    });
  });

  replaceWorks(data);
}

function readCompanies() {
  return db.prepare(`
    SELECT id, name, address, phone, email, created_at AS createdAt, updated_at AS updatedAt
    FROM companies
    ORDER BY lower(name)
  `).all();
}

function writeCompanies(data) {
  const replaceCompanies = db.transaction(companies => {
    db.prepare("DELETE FROM companies").run();
    const insert = db.prepare(`
      INSERT INTO companies (id, name, address, phone, email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    companies.forEach(company => {
      insert.run(
        Number(company.id) || createId(),
        normalizeValue(company.name),
        normalizeValue(company.address),
        normalizeValue(company.phone),
        normalizeValue(company.email),
        toIsoDate(company.createdAt) || new Date().toISOString(),
        toIsoDate(company.updatedAt)
      );
    });
  });

  replaceCompanies(data);
}

function readImportedEmails() {
  return db.prepare("SELECT uid FROM imported_emails ORDER BY uid").all().map(row => row.uid);
}

function writeImportedEmails(data) {
  const replaceImportedEmails = db.transaction(uids => {
    db.prepare("DELETE FROM imported_emails").run();
    const insert = db.prepare("INSERT OR IGNORE INTO imported_emails (uid, created_at) VALUES (?, ?)");

    uids.forEach(uid => {
      insert.run(Number(uid), new Date().toISOString());
    });
  });

  replaceImportedEmails(data);
}

function readRejectedEmails() {
  return db.prepare("SELECT uid FROM rejected_emails ORDER BY uid").all().map(row => row.uid);
}

function rememberRejectedEmail(uid) {
  db.prepare(`
    INSERT OR IGNORE INTO rejected_emails (uid, created_at)
    VALUES (?, ?)
  `).run(Number(uid), new Date().toISOString());
}

function readEmailOverride(uid) {
  const row = db.prepare("SELECT payload_json FROM email_overrides WHERE uid = ?").get(Number(uid));
  return row ? parseJsonValue(row.payload_json, null) : null;
}

function rememberEmailOverride(uid, payload) {
  db.prepare(`
    INSERT INTO email_overrides (uid, payload_json, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET
      payload_json = excluded.payload_json,
      created_at = excluded.created_at
  `).run(Number(uid), JSON.stringify(payload), new Date().toISOString());
}

function readSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const settings = rows.reduce((acc, row) => {
    acc[row.key] = parseJsonValue(row.value, row.value);
    return acc;
  }, {});

  return {
    autoEmailProcessing: true,
    ...settings
  };
}

function writeSettings(data) {
  const merged = {
    ...readSettings(),
    ...data
  };
  const upsert = db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  Object.entries(merged).forEach(([key, value]) => {
    upsert.run(key, JSON.stringify(value));
  });
}

function readUsers() {
  return db.prepare(`
    SELECT id, name, role, password, created_at AS createdAt, updated_at AS updatedAt
    FROM users
    ORDER BY lower(name)
  `).all();
}

function writeUsers(data) {
  const replaceUsers = db.transaction(users => {
    db.prepare("DELETE FROM users").run();
    const insert = db.prepare(`
      INSERT INTO users (id, name, role, password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    users.forEach(user => {
      insert.run(
        Number(user.id) || createId(),
        normalizeValue(user.name),
        user.role === "admin" ? "admin" : "user",
        normalizeValue(user.password) || (user.role === "admin" ? "admin" : "user"),
        toIsoDate(user.createdAt) || new Date().toISOString(),
        toIsoDate(user.updatedAt)
      );
    });
  });

  replaceUsers(data);
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  const { password, ...safeUser } = user;
  return safeUser;
}

function getUserPassword(user) {
  if (user.password) {
    return user.password;
  }

  return user.role === "admin" ? "admin" : "user";
}

function requireAdmin(req, res, next) {
  if (req.get("x-user-role") !== "admin") {
    return res.status(403).json({ message: "Šiam veiksmui reikia admin rolės." });
  }

  next();
}

function normalizeValue(value) {
  return String(value ?? "").trim();
}

function createSeedId(index) {
  return 1777815000000 + index;
}

function createId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function normalizeCompanyPayload(body) {
  return {
    name: normalizeValue(body.name),
    address: normalizeValue(body.address),
    phone: normalizeValue(body.phone),
    email: normalizeValue(body.email)
  };
}

function getTemplateValue(text, labels) {
  const labelList = Array.isArray(labels) ? labels : [labels];

  for (const label of labelList) {
    const regex = new RegExp(`^\\s*${label}\\s*:(.*)$`, "im");
    const match = text.match(regex);

    if (match) {
      return match[1].trim();
    }
  }

  return "";
}

function getTemplateValues(text, labels) {
  const labelList = Array.isArray(labels) ? labels : [labels];
  const values = [];

  labelList.forEach(label => {
    const regex = new RegExp(`^\\s*${label}\\s*:(.*)$`, "img");
    let match;

    while ((match = regex.exec(text)) !== null) {
      values.push(match[1].trim());
    }
  });

  return values.filter(Boolean);
}

function addMinutesToTime(timeValue, durationValue) {
  const timeMatch = normalizeValue(timeValue).match(/(\d{1,2})[:.](\d{2})/);
  const durationMatch = normalizeValue(durationValue).match(/(\d+(?:[,.]\d+)?)\s*(h|val|val\.|min|m)?/i);

  if (!timeMatch || !durationMatch) {
    return normalizeValue(timeValue);
  }

  const start = new Date("2026-01-01T00:00:00");
  start.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);

  const rawDuration = Number(durationMatch[1].replace(",", "."));
  const unit = (durationMatch[2] || "min").toLowerCase();
  const minutes = unit.startsWith("h") || unit.startsWith("val") ? rawDuration * 60 : rawDuration;
  const end = new Date(start.getTime() + minutes * 60 * 1000);
  const pad = value => String(value).padStart(2, "0");

  return `${pad(start.getHours())}:${pad(start.getMinutes())}-${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

function parseSchedule(text) {
  const start = getTemplateValue(text, ["Pradžia", "Pradzia", "Pradžios laikas", "Pradzios laikas", "Laikas", "Start"]);
  const duration = getTemplateValue(text, ["Trukmė", "Trukme", "Duration"]);
  const date = getTemplateValue(text, ["Data", "Date"]) || (start.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || "";
  const startTime = (start.match(/\d{1,2}[:.]\d{2}(?:\s*[-–—]\s*\d{1,2}[:.]\d{2})?/) || [])[0] || "";
  const time = duration && !/[-–—]/.test(startTime) ? addMinutesToTime(startTime, duration) : startTime;

  return { date, time, duration, start };
}

function parseCompanyReferences(text) {
  const refs = [];
  const companyIds = getTemplateValues(text, ["Įmonės ID", "Imones ID", "Company ID", "CompanyId"]);
  const companyNames = getTemplateValues(text, ["Įmonė", "Imone", "Company"]);
  const addresses = getTemplateValues(text, ["Adresas", "Address"]);

  companyIds.forEach(companyId => {
    refs.push({ companyId });
  });

  companyNames.forEach((company, index) => {
    refs.push({
      company,
      address: addresses[index] || ""
    });
  });

  return refs;
}

function parseTemplateText(text) {
  const schedule = parseSchedule(text);
  const companyRefs = parseCompanyReferences(text);
  const firstCompany = companyRefs.find(ref => ref.companyId || ref.company || ref.address) || {};

  return {
    companyId: firstCompany.companyId || "",
    companyIds: companyRefs.map(ref => ref.companyId).filter(Boolean),
    company: firstCompany.company || "",
    address: firstCompany.address || "",
    affectedCompanyRefs: companyRefs,
    phone: getTemplateValue(text, ["Telefonas", "Tel", "Phone"]),
    email: getTemplateValue(text, ["El\\. paštas", "El\\. pastas", "Email", "E-mail"]),
    date: schedule.date,
    time: schedule.time,
    duration: schedule.duration,
    startsAt: schedule.start,
    description: getTemplateValue(text, ["Aprašymas", "Aprasymas", "Description"]),
    title: "Planiniai darbai"
  };
}

function normalizeEditedWorkPayload(payload) {
  const companyIds = Array.isArray(payload.companyIds)
    ? payload.companyIds.map(normalizeValue).filter(Boolean)
    : normalizeValue(payload.companyId).split(",").map(normalizeValue).filter(Boolean);
  const company = normalizeValue(payload.company);
  const address = normalizeValue(payload.address);

  return {
    companyId: companyIds[0] || "",
    companyIds,
    company,
    address,
    affectedCompanyRefs: companyIds.length
      ? companyIds.map(companyId => ({ companyId }))
      : [{ company, address }],
    phone: normalizeValue(payload.phone),
    email: normalizeValue(payload.email),
    date: normalizeValue(payload.date),
    time: normalizeValue(payload.time),
    duration: normalizeValue(payload.duration),
    description: normalizeValue(payload.description),
    title: "Planiniai darbai"
  };
}

function createWorkFromPayload(payload, source = "manual") {
  const affectedCompanies = resolveCompanies(payload);
  const primaryCompany = affectedCompanies[0] || resolveCompany(payload);
  const normalizedPayload = {
    ...payload,
    companyId: primaryCompany?.id || normalizeValue(payload.companyId),
    company: affectedCompanies.length ? affectedCompanies.map(company => company.name).join(", ") : primaryCompany?.name || payload.company,
    address: affectedCompanies.length ? affectedCompanies.map(company => company.address).join("; ") : primaryCompany?.address || payload.address,
    affectedCompanies
  };
  const newWork = {
    id: createId(),
    ...normalizedPayload,
    status: "Naujas",
    createdAt: new Date(),
    source
  };

  const works = readWorks();
  works.push(newWork);
  writeWorks(works);
  if (!affectedCompanies.length) {
    upsertCompany({
      name: newWork.company,
      address: newWork.address,
      phone: newWork.phone,
      email: newWork.email
    });
  }

  return newWork;
}

function rememberImportedEmail(uid) {
  const importedEmails = readImportedEmails();

  if (importedEmails.includes(uid)) {
    return;
  }

  importedEmails.push(uid);
  writeImportedEmails(importedEmails);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Veiksmas užtruko per ilgai.")), ms);
    })
  ]);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isValidWorkPayload(payload) {
  return Boolean(resolveCompanies(payload).length && payload.date && payload.time && payload.description);
}

const REQUIRED_EMAIL_FIELDS = [
  { key: "date", label: "Data" },
  { key: "time", label: "Laikas" },
  { key: "description", label: "Aprašymas" }
];

const MATCHING_EMAIL_FIELDS = [
  { key: "companyId", label: "Įmonės ID" },
  { key: "company", label: "Įmonė" },
  { key: "address", label: "Adresas" }
];

function classifyParsedEmail(parsedWork) {
  const presentRequired = REQUIRED_EMAIL_FIELDS.filter(field => normalizeValue(parsedWork[field.key]));
  const missingRequired = REQUIRED_EMAIL_FIELDS.filter(field => !normalizeValue(parsedWork[field.key]));
  const resolvedCompanies = resolveCompanies(parsedWork);
  const hasCompanyId = Boolean(normalizeValue(parsedWork.companyId) || parsedWork.companyIds?.length);
  const hasCompanyAndAddress = Boolean(normalizeValue(parsedWork.company) && normalizeValue(parsedWork.address));
  const missingMatchingFields = resolvedCompanies.length ? [] : [hasCompanyId || hasCompanyAndAddress ? "Bent viena egzistuojanti įmonė" : "Įmonės ID arba Įmonė + Adresas"];
  const presentMatching = MATCHING_EMAIL_FIELDS.filter(field => normalizeValue(parsedWork[field.key]));
  const optionalPresent = ["phone", "email"].filter(key => normalizeValue(parsedWork[key]));
  const recognizedCount = presentRequired.length + presentMatching.length + optionalPresent.length;

  if (!recognizedCount) {
    return {
      folder: "empty",
      folderLabel: "Be informacijos",
      recognizedFields: [],
      missingFields: ["Įmonės ID arba Įmonė + Adresas"].concat(REQUIRED_EMAIL_FIELDS.map(field => field.label))
    };
  }

  if (!missingRequired.length && !missingMatchingFields.length) {
    return {
      folder: "complete",
      folderLabel: "Visa informacija",
      recognizedFields: presentMatching.map(field => field.label).concat(presentRequired.map(field => field.label), optionalPresent.map(key => key === "phone" ? "Telefonas" : "El. paštas")),
      missingFields: []
    };
  }

  return {
    folder: "partial",
    folderLabel: "Dalis informacijos",
    recognizedFields: presentMatching.map(field => field.label).concat(presentRequired.map(field => field.label), optionalPresent.map(key => key === "phone" ? "Telefonas" : "El. paštas")),
    missingFields: missingMatchingFields.concat(missingRequired.map(field => field.label))
  };
}

function formatEmailAddress(address) {
  if (!address) {
    return "";
  }

  return address.name ? `${address.name} <${address.address}>` : address.address;
}

function formatEmailAddresses(addresses) {
  return (addresses || []).map(formatEmailAddress).filter(Boolean).join(", ");
}

function summarizeEmail(message) {
  const envelope = message.envelope || {};

  return {
    uid: message.uid,
    subject: envelope.subject || "(be temos)",
    from: formatEmailAddresses(envelope.from),
    to: formatEmailAddresses(envelope.to),
    sentAt: envelope.date || message.internalDate || null,
    receivedAt: message.internalDate || null,
    seen: message.flags ? message.flags.has("\\Seen") : false,
    size: message.size || 0
  };
}

function getEmailErrorDetails(error) {
  return [
    error.message,
    error.code,
    error.responseStatus,
    error.response
  ].filter(Boolean).join(" | ");
}

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST || "smtp.zoho.eu",
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || process.env.EMAIL_USER,
    password: process.env.SMTP_PASSWORD || process.env.EMAIL_PASSWORD,
    from: process.env.SMTP_FROM || process.env.SMTP_USER || process.env.EMAIL_USER,
    testTo: process.env.TEST_EMAIL_TO || "bakisplaninis@gmail.com"
  };
}

function isSmtpConfigured(config = getSmtpConfig()) {
  return Boolean(config.host && config.user && config.password && config.from && config.testTo);
}

function createTransporter(config = getSmtpConfig()) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.password
    }
  });
}

function buildWorkNotification(work) {
  return buildCompanyWorkNotification(work, work.affectedCompanies?.[0] || {
    name: work.company,
    address: work.address
  });
}

function buildCompanyWorkNotification(work, companyInfo) {
  const company = escapeHtml(companyInfo?.name || work.company || "Įmonė");
  const address = escapeHtml(companyInfo?.address || work.address || "Adresas nenurodytas");
  const date = escapeHtml(work.date || "Data nenurodyta");
  const time = escapeHtml(work.time || "Laikas nenurodytas");
  const description = escapeHtml(work.description || "Aprašymas nenurodytas");
  const subject = `Planiniai darbai: ${companyInfo?.name || work.company || "įmonė"} ${work.date || ""} ${work.time || ""}`.trim();
  const text = [
    `Sveiki, ${companyInfo?.name || work.company || ""},`,
    ``,
    `Informuojame apie planinius darbus.`,
    ``,
    `Įmonė: ${companyInfo?.name || work.company || "-"}`,
    `Adresas: ${companyInfo?.address || work.address || "-"}`,
    `Data: ${work.date || "-"}`,
    `Laikas: ${work.time || "-"}`,
    `Aprašymas: ${work.description || "-"}`,
    ``,
    `Tai testinis prototipo laiškas. Tikras gavėjas būtų įmonė, bet šiame prototipe visi laiškai siunčiami į bakisplaninis@gmail.com.`
  ].join("\n");
  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f7;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #d4d8dd;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="background:#2f363f;color:#ffffff;padding:24px;">
                    <div style="font-size:12px;text-transform:uppercase;font-weight:700;opacity:.75;">Planinių darbų pranešimas</div>
                    <h1 style="margin:8px 0 0;font-size:26px;line-height:1.15;">${company}</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px;">
                    <p style="margin:0 0 18px;line-height:1.55;">Sveiki, ${company}, informuojame apie planinius darbus žemiau nurodytu laiku.</p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                      <tr>
                        <td style="padding:12px;border-top:1px solid #e5e7eb;font-weight:700;width:150px;">Adresas</td>
                        <td style="padding:12px;border-top:1px solid #e5e7eb;">${address}</td>
                      </tr>
                      <tr>
                        <td style="padding:12px;border-top:1px solid #e5e7eb;font-weight:700;">Data</td>
                        <td style="padding:12px;border-top:1px solid #e5e7eb;">${date}</td>
                      </tr>
                      <tr>
                        <td style="padding:12px;border-top:1px solid #e5e7eb;font-weight:700;">Laikas</td>
                        <td style="padding:12px;border-top:1px solid #e5e7eb;">${time}</td>
                      </tr>
                      <tr>
                        <td style="padding:12px;border-top:1px solid #e5e7eb;font-weight:700;vertical-align:top;">Aprašymas</td>
                        <td style="padding:12px;border-top:1px solid #e5e7eb;line-height:1.55;">${description}</td>
                      </tr>
                    </table>
                    <p style="margin:22px 0 0;color:#66717e;font-size:13px;line-height:1.5;">
                      Testinis prototipo laiškas. Tikras gavėjas būtų įmonė, bet šiame prototipe visi laiškai siunčiami tik į bakisplaninis@gmail.com.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return { subject, text, html };
}

async function sendOneWorkNotification(work, companyInfo) {
  const config = getSmtpConfig();

  if (!isSmtpConfigured(config)) {
    throw new Error("SMTP siuntimas nesukonfigūruotas.");
  }

  const message = buildCompanyWorkNotification(work, companyInfo);
  const transporter = createTransporter(config);

  return transporter.sendMail({
    from: config.from,
    to: config.testTo,
    subject: message.subject,
    text: message.text,
    html: message.html
  });
}

async function sendWorkNotification(work) {
  const companies = work.affectedCompanies?.length
    ? work.affectedCompanies
    : [{ id: work.companyId, name: work.company, address: work.address }];
  const results = [];

  for (const company of companies) {
    const info = await sendOneWorkNotification(work, company);
    results.push({
      companyId: company.id,
      company: company.name,
      sentTo: getSmtpConfig().testTo,
      messageId: info.messageId
    });
  }

  return results;
}

function markWorkEmailResult(id, fields) {
  const works = readWorks();
  const work = works.find(item => item.id == id);

  if (!work) {
    return null;
  }

  Object.assign(work, fields);
  writeWorks(works);
  return work;
}

async function createWorkAndSendNotifications(parsedWork, emailUid, source = "email") {
  const createdWork = createWorkFromPayload({ ...parsedWork, emailUid }, source);

  try {
    const results = await sendWorkNotification(createdWork);
    return markWorkEmailResult(createdWork.id, {
      emailSent: true,
      sentAt: new Date(),
      sentTo: getSmtpConfig().testTo,
      sentNotifications: results
    });
  } catch (error) {
    return markWorkEmailResult(createdWork.id, {
      emailSent: false,
      emailError: error.message,
      emailErrorAt: new Date()
    });
  }
}

function createEmailClient(config = getEmailConfig()) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: {
      user: config.user,
      pass: config.password
    },
    logger: false
  });
}

async function withInbox(callback, options = {}) {
  const config = getEmailConfig();

  if (!isEmailConfigured(config)) {
    const error = new Error("Email importas nesukonfigūruotas.");
    error.status = 400;
    throw error;
  }

  const client = createEmailClient(config);

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX", { readOnly: Boolean(options.readOnly) });

    try {
      return await callback(client);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

function resolveCompanies(payload) {
  const companies = readCompanies();
  const refs = payload.affectedCompanyRefs?.length
    ? payload.affectedCompanyRefs
    : [{ companyId: payload.companyId, company: payload.company, address: payload.address }];
  const companyIds = new Set([...(payload.companyIds || []), payload.companyId].filter(Boolean).map(String));
  const resolved = [];

  refs.forEach(ref => {
    if (ref.companyId) {
      companyIds.add(String(ref.companyId));
    }
  });

  companyIds.forEach(companyId => {
    const company = companies.find(item => String(item.id) === companyId);

    if (company && !resolved.some(item => item.id === company.id)) {
      resolved.push(company);
    }
  });

  refs.forEach(ref => {
    const normalizedCompany = normalizeValue(ref.company);
    const normalizedAddress = normalizeValue(ref.address);

    if (!normalizedCompany || !normalizedAddress) {
      return;
    }

    const company = companies.find(item =>
      item.name.toLowerCase() === normalizedCompany.toLowerCase() &&
      normalizeValue(item.address).toLowerCase() === normalizedAddress.toLowerCase()
    );

    if (company && !resolved.some(item => item.id === company.id)) {
      resolved.push(company);
    }
  });

  return resolved;
}

function resolveCompany({ companyId, company, address }) {
  const normalizedCompanyId = normalizeValue(companyId);
  const normalizedCompany = normalizeValue(company);
  const normalizedAddress = normalizeValue(address);
  const companies = readCompanies();

  if (normalizedCompanyId) {
    return companies.find(item => String(item.id) === normalizedCompanyId) || null;
  }

  if (normalizedCompany && normalizedAddress) {
    return companies.find(item =>
      item.name.toLowerCase() === normalizedCompany.toLowerCase() &&
      normalizeValue(item.address).toLowerCase() === normalizedAddress.toLowerCase()
    ) || null;
  }

  return null;
}

function upsertCompany({ name, address, phone, email }) {
  const companyName = normalizeValue(name);
  const companyAddress = normalizeValue(address);
  const companyPhone = normalizeValue(phone);
  const companyEmail = normalizeValue(email);

  if (!companyName) {
    return null;
  }

  const companies = readCompanies();
  const existing = companies.find(company => company.name.toLowerCase() === companyName.toLowerCase());

  if (existing) {
    let changed = false;

    if (companyAddress && existing.address !== companyAddress) {
      existing.address = companyAddress;
      changed = true;
    }
    if (companyPhone && existing.phone !== companyPhone) {
      existing.phone = companyPhone;
      changed = true;
    }
    if (companyEmail && existing.email !== companyEmail) {
      existing.email = companyEmail;
      changed = true;
    }
    if (changed) {
      existing.updatedAt = new Date();
      writeCompanies(companies);
    }

    return existing;
  }

  const newCompany = {
    id: createId(),
    name: companyName,
    address: companyAddress,
    phone: companyPhone,
    email: companyEmail,
    createdAt: new Date()
  };

  companies.push(newCompany);
  writeCompanies(companies);

  return newCompany;
}

initializeDatabase();

// ================= ROUTES =================

app.post("/login", (req, res) => {
  const name = normalizeValue(req.body.name).toLowerCase();
  const password = normalizeValue(req.body.password);
  const user = readUsers().find(item => item.name.toLowerCase() === name);

  if (!user || getUserPassword(user) !== password) {
    return res.status(401).json({ message: "Neteisingas vardas arba slaptažodis." });
  }

  res.json(sanitizeUser(user));
});

// Gauti visus darbus
app.get("/works", (req, res) => {
  res.json(readWorks());
});

// Gauti vieną darbą
app.get("/works/:id", (req, res) => {
  const work = readWorks().find(item => item.id == req.params.id);

  if (!work) {
    return res.status(404).json({ message: "Darbas nerastas." });
  }

  res.json(work);
});

// Pridėti naują darbą
app.post("/works", (req, res) => {
  const newWork = createWorkFromPayload(req.body);
  res.json(newWork);
});

// Gauti visas įmones
app.get("/companies", (req, res) => {
  res.json(readCompanies());
});

// Gauti vieną įmonę
app.get("/companies/:id", (req, res) => {
  const company = readCompanies().find(item => item.id == req.params.id);

  if (!company) {
    return res.status(404).json({ message: "Įmonė nerasta." });
  }

  res.json(company);
});

// Pridėti naują įmonę
app.post("/companies", requireAdmin, (req, res) => {
  const { name, address, phone, email } = normalizeCompanyPayload(req.body);

  if (!name || !address) {
    return res.status(400).json({ message: "Įveskite įmonės pavadinimą ir adresą." });
  }

  const companies = readCompanies();
  const exists = companies.some(company => company.name.toLowerCase() === name.toLowerCase());

  if (exists) {
    return res.status(409).json({ message: "Tokia įmonė jau yra sąraše." });
  }

  const newCompany = {
    id: createId(),
    name,
    address,
    phone,
    email,
    createdAt: new Date()
  };

  companies.push(newCompany);
  writeCompanies(companies);

  res.status(201).json(newCompany);
});

// Atnaujinti įmonę
app.put("/companies/:id", requireAdmin, (req, res) => {
  const companies = readCompanies();
  const company = companies.find(item => item.id == req.params.id);

  if (!company) {
    return res.status(404).json({ message: "Įmonė nerasta." });
  }

  const { name, address, phone, email } = normalizeCompanyPayload(req.body);

  if (!name || !address) {
    return res.status(400).json({ message: "Įveskite įmonės pavadinimą ir adresą." });
  }

  const duplicate = companies.some(item =>
    item.id != req.params.id && item.name.toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    return res.status(409).json({ message: "Tokia įmonė jau yra sąraše." });
  }

  const previousName = company.name;
  company.name = name;
  company.address = address;
  company.phone = phone;
  company.email = email;
  company.updatedAt = new Date();

  writeCompanies(companies);

  if (previousName.toLowerCase() !== name.toLowerCase()) {
    const works = readWorks();
    let renamedWorks = false;

    works.forEach(work => {
      if (normalizeValue(work.company).toLowerCase() === previousName.toLowerCase()) {
        work.company = name;
        renamedWorks = true;
      }
    });

    if (renamedWorks) {
      writeWorks(works);
    }
  }

  res.json(company);
});

// Email importas (šabloninis parsing)
app.post("/import-email", (req, res) => {
  const { text } = req.body;
  const parsed = parseTemplateText(text || "");

  res.json(parsed);
});

// Nustatymai
app.get("/settings", (req, res) => {
  res.json(readSettings());
});

app.patch("/settings", requireAdmin, (req, res) => {
  const nextSettings = {};

  if (typeof req.body.autoEmailProcessing === "boolean") {
    nextSettings.autoEmailProcessing = req.body.autoEmailProcessing;
  }

  writeSettings(nextSettings);
  res.json(readSettings());
});

// Vartotojai
app.get("/users", requireAdmin, (req, res) => {
  res.json(readUsers().map(sanitizeUser));
});

app.post("/users", requireAdmin, (req, res) => {
  const name = normalizeValue(req.body.name);
  const role = normalizeValue(req.body.role) === "admin" ? "admin" : "user";
  const password = normalizeValue(req.body.password);

  if (!name || !password) {
    return res.status(400).json({ message: "Įveskite vartotojo vardą ir slaptažodį." });
  }

  const users = readUsers();
  const duplicate = users.some(user => user.name.toLowerCase() === name.toLowerCase());

  if (duplicate) {
    return res.status(409).json({ message: "Toks vartotojas jau yra." });
  }

  const newUser = {
    id: createId(),
    name,
    role,
    password,
    createdAt: new Date()
  };

  users.push(newUser);
  writeUsers(users);

  res.status(201).json(sanitizeUser(newUser));
});

app.delete("/users/:id", requireAdmin, (req, res) => {
  const users = readUsers();
  const user = users.find(item => item.id == req.params.id);

  if (!user) {
    return res.status(404).json({ message: "Vartotojas nerastas." });
  }

  if (user.role === "admin" && users.filter(item => item.role === "admin").length === 1) {
    return res.status(400).json({ message: "Negalima ištrinti paskutinio admin vartotojo." });
  }

  const nextUsers = users.filter(item => item.id != req.params.id);
  writeUsers(nextUsers);

  res.json({ message: "Vartotojas ištrintas." });
});

// Gauti email sąrašą
app.get("/emails", async (req, res) => {
  try {
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 500) : null;
    const emails = await withInbox(async client => {
      const uids = await client.search({ all: true }, { uid: true });
      const recentUids = uids.sort((a, b) => b - a);
      const selectedUids = limit ? recentUids.slice(0, limit) : recentUids;

      if (!selectedUids.length) {
        return [];
      }

      const messages = [];
      const importedEmails = readImportedEmails();
      const rejectedEmails = readRejectedEmails();

      for await (const message of client.fetch(selectedUids, {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true,
        source: true
      }, { uid: true })) {
        if (rejectedEmails.includes(message.uid)) {
          continue;
        }

        const parsedEmail = await simpleParser(message.source);
        const parsedWork = readEmailOverride(message.uid) || parseTemplateText(parsedEmail.text || parsedEmail.html || "");
        messages.push({
          ...summarizeEmail(message),
          imported: importedEmails.includes(message.uid),
          parsedWork,
          classification: classifyParsedEmail(parsedWork)
        });
      }

      return messages.sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
    }, { readOnly: true });

    res.json(emails);
  } catch (error) {
    res.status(error.status || 500).json({ message: "Nepavyko gauti email sąrašo.", details: getEmailErrorDetails(error) });
  }
});

// Gauti vieną email
app.get("/emails/:uid", async (req, res) => {
  try {
    const uid = Number(req.params.uid);

    if (!uid) {
      return res.status(400).json({ message: "Neteisingas email UID." });
    }

    if (readRejectedEmails().includes(uid)) {
      return res.status(410).json({ message: "Email atmestas." });
    }

    const email = await withInbox(async client => {
      const message = await client.fetchOne(uid, {
        uid: true,
        source: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true
      }, { uid: true });

      if (!message) {
        return null;
      }

      const parsedEmail = await simpleParser(message.source);
      const parsedWork = readEmailOverride(message.uid) || parseTemplateText(parsedEmail.text || parsedEmail.html || "");

      return {
        ...summarizeEmail(message),
        imported: readImportedEmails().includes(message.uid),
        cc: formatEmailAddresses(message.envelope?.cc),
        bcc: formatEmailAddresses(message.envelope?.bcc),
        replyTo: formatEmailAddresses(message.envelope?.replyTo),
        messageId: message.envelope?.messageId || "",
        text: parsedEmail.text || "",
        html: parsedEmail.text ? "" : parsedEmail.html || "",
        attachments: (parsedEmail.attachments || []).map(attachment => ({
          filename: attachment.filename || "attachment",
          contentType: attachment.contentType,
          size: attachment.size
        })),
        parsedWork,
        classification: classifyParsedEmail(parsedWork)
      };
    }, { readOnly: true });

    if (!email) {
      return res.status(404).json({ message: "Email nerastas." });
    }

    res.json(email);
  } catch (error) {
    res.status(error.status || 500).json({ message: "Nepavyko gauti email.", details: getEmailErrorDetails(error) });
  }
});

// Rankiniu būdu patvirtinti gautą email
app.post("/confirm-email/:uid", async (req, res) => {
  try {
    const uid = Number(req.params.uid);

    if (!uid) {
      return res.status(400).json({ message: "Neteisingas email UID." });
    }

    if (readImportedEmails().includes(uid)) {
      return res.status(409).json({ message: "Šis email jau importuotas." });
    }

    const work = await withInbox(async client => {
      const message = await client.fetchOne(uid, {
        uid: true,
        source: true,
        envelope: true
      }, { uid: true });

      if (!message) {
        return null;
      }

      const parsedEmail = await simpleParser(message.source);
      const parsedWork = req.body.parsedWork && typeof req.body.parsedWork === "object"
        ? normalizeEditedWorkPayload(req.body.parsedWork)
        : parseTemplateText(parsedEmail.text || parsedEmail.html || "");

      if (!isValidWorkPayload(parsedWork)) {
        const error = new Error("Email nepritaikytas šablonui arba nerasta egzistuojanti įmonė.");
        error.status = 400;
        throw error;
      }

      const createdWork = await createWorkAndSendNotifications(parsedWork, message.uid, "email");
      rememberEmailOverride(message.uid, parsedWork);
      rememberImportedEmail(message.uid);
      await withTimeout(client.messageFlagsAdd(message.uid, ["\\Seen"], { uid: true }), 3000).catch(() => {});

      return createdWork;
    });

    if (!work) {
      return res.status(404).json({ message: "Email nerastas." });
    }

    res.json({
      message: work.emailSent
        ? "Email patvirtintas, darbas sukurtas ir pranešimai išsiųsti."
        : "Email patvirtintas ir darbas sukurtas, bet pranešimų išsiųsti nepavyko.",
      work
    });
  } catch (error) {
    res.status(error.status || 500).json({ message: "Nepavyko patvirtinti email.", details: error.message });
  }
});

// Atmesti emailą, kad jis dingtų iš sistemos sąrašų
app.post("/reject-email/:uid", (req, res) => {
  const uid = Number(req.params.uid);

  if (!uid) {
    return res.status(400).json({ message: "Neteisingas email UID." });
  }

  rememberRejectedEmail(uid);
  res.json({ message: "Email atmestas." });
});

// Siųsti pranešimą apie planinius darbus
app.post("/send-email/:id", async (req, res) => {
  const works = readWorks();
  const work = works.find(w => w.id == req.params.id);

  if (!work) {
    return res.status(404).send("Nerasta");
  }

  try {
    const results = await sendWorkNotification(work);
    const updatedWork = markWorkEmailResult(work.id, {
      emailSent: true,
      sentAt: new Date(),
      sentTo: getSmtpConfig().testTo,
      sentNotifications: results
    });

    res.json({ message: "Email išsiųstas į testinį adresą", work: updatedWork });
  } catch (error) {
    markWorkEmailResult(work.id, {
      emailSent: false,
      emailError: error.message,
      emailErrorAt: new Date()
    });
    res.status(500).json({ message: "Nepavyko išsiųsti email.", details: error.message });
  }
});

// ==========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Serveris veikia: http://localhost:${PORT}`);
  startEmailPolling();
});

function getEmailConfig() {
  return {
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 993),
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    pollSeconds: Number(process.env.EMAIL_POLL_SECONDS || 60)
  };
}

function isEmailConfigured(config) {
  return Boolean(
    config.host &&
    config.user &&
    config.password &&
    config.password !== "ivesk_slaptazodi_cia"
  );
}

let emailPollRunning = false;

async function importUnreadEmails() {
  if (emailPollRunning) {
    return;
  }

  const config = getEmailConfig();

  if (!isEmailConfigured(config)) {
    return;
  }

  if (!readSettings().autoEmailProcessing) {
    return;
  }

  emailPollRunning = true;
  const client = createEmailClient(config);

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      for await (const message of client.fetch({ seen: false }, { uid: true, source: true, envelope: true })) {
        if (readImportedEmails().includes(message.uid)) {
          continue;
        }

        const parsedEmail = await simpleParser(message.source);
        const bodyText = parsedEmail.text || parsedEmail.html || "";
        const parsedWork = parseTemplateText(bodyText);

        if (!isValidWorkPayload(parsedWork)) {
          console.warn(`Email nepritaikytas šablonui: ${parsedEmail.subject || "(be temos)"}`);
          continue;
        }

        try {
          await createWorkAndSendNotifications(parsedWork, message.uid, "email");
        } catch (error) {
          console.warn(`Darbas importuotas, bet pranešimo išsiųsti nepavyko: ${error.message}`);
        }
        rememberImportedEmail(message.uid);
        await withTimeout(client.messageFlagsAdd(message.uid, ["\\Seen"], { uid: true }), 3000).catch(error => {
          console.warn(`Email importuotas, bet nepavyko pažymėti kaip perskaityto: ${error.message}`);
        });
        console.log(`Importuotas planinis darbas iš email: ${parsedEmail.subject || parsedWork.company}`);
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    console.error(`Nepavyko patikrinti email inboxo. ${getEmailErrorDetails(error)}`);
  } finally {
    await client.logout().catch(() => {});
    emailPollRunning = false;
  }
}

function startEmailPolling() {
  const config = getEmailConfig();

  if (!isEmailConfigured(config)) {
    console.log("Email importas neįjungtas: patikrinkite .env nustatymus.");
    return;
  }

  const pollMs = Math.max(config.pollSeconds, 15) * 1000;
  console.log(`Email importas įjungtas: inbox tikrinamas kas ${pollMs / 1000}s.`);
  importUnreadEmails();
  setInterval(importUnreadEmails, pollMs);
}
