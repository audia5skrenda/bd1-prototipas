function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getCompanyId() {
  return new URLSearchParams(window.location.search).get("id");
}

let currentCompany = null;
let currentWorks = [];

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseTimePart(value) {
  const match = String(value ?? "").match(/(\d{1,2})[:.](\d{2})/);

  if (!match) {
    return null;
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2])
  };
}

function buildDateTime(dateValue, timeValue, fallbackHour) {
  if (!dateValue) {
    return null;
  }

  const time = parseTimePart(timeValue) || { hours: fallbackHour, minutes: 0 };
  const date = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(time.hours, time.minutes, 0, 0);
  return date;
}

function getWorkWindow(work) {
  const timeText = String(work.time ?? "");
  const timeParts = timeText.split(/[-–—]/);
  const start = buildDateTime(work.date, timeParts[0], 0);
  let end = buildDateTime(work.date, timeParts[1] || timeParts[0], 23);

  if (!start || !end) {
    return null;
  }

  if (end < start) {
    end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }

  return { start, end };
}

function workAffectsCompany(work, company) {
  if (work.affectedCompanies?.length) {
    return work.affectedCompanies.some(item => String(item.id) === String(company.id));
  }

  return normalizeName(work.company) === normalizeName(company.name);
}

function categorizeWorks(works) {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const categories = {
    past: [],
    current: [],
    upcoming: []
  };

  works.forEach(work => {
    const window = getWorkWindow(work);

    if (!window) {
      return;
    }

    if (window.start <= now && window.end >= now) {
      categories.current.push(work);
    } else if (window.end < now && window.end >= last24h) {
      categories.past.push(work);
    } else if (window.start > now && window.start <= next24h) {
      categories.upcoming.push(work);
    }
  });

  return categories;
}

function renderValue(id, value) {
  document.getElementById(id).textContent = value || "-";
}

function renderCompany(company) {
  currentCompany = company;
  document.title = company.name || "Įmonė";
  document.getElementById("companyTitle").textContent = company.name || "Įmonė";
  renderValue("companyId", company.id);
  renderValue("companyName", company.name);
  renderValue("companyAddress", company.address);
  renderValue("companyPhone", company.phone);
  renderValue("companyEmail", company.email);
}

function setEditMode(isEditing) {
  if (isEditing && !isAdmin()) {
    return;
  }

  document.getElementById("companyDetails").classList.toggle("hidden", isEditing);
  document.getElementById("companyEditForm").classList.toggle("hidden", !isEditing);
  document.getElementById("editCompanyButton").classList.toggle("hidden", isEditing);
  document.getElementById("companyEditMessage").textContent = "";

  if (isEditing && currentCompany) {
    document.getElementById("editCompanyName").value = currentCompany.name || "";
    document.getElementById("editCompanyAddress").value = currentCompany.address || "";
    document.getElementById("editCompanyPhone").value = currentCompany.phone || "";
    document.getElementById("editCompanyEmail").value = currentCompany.email || "";
  }
}

function getCompanyPayload(form) {
  const formData = new FormData(form);

  return {
    name: formData.get("name"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    email: formData.get("email")
  };
}

function renderCompanyWorks(company, works) {
  const companyWorks = works.filter(work => workAffectsCompany(work, company));
  const categories = categorizeWorks(companyWorks);

  renderSummary(categories);
  renderWorks("pastWorks", categories.past);
  renderWorks("currentWorks", categories.current);
  renderWorks("upcomingWorks", categories.upcoming);
}

function renderWorks(listId, works) {
  const list = document.getElementById(listId);
  list.innerHTML = "";

  if (!works.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Planinių darbų nėra.";
    list.appendChild(empty);
    return;
  }

  works
    .slice()
    .sort((first, second) => String(first.date || "").localeCompare(String(second.date || "")))
    .forEach(work => {
      const li = document.createElement("li");
      li.className = "work-item company-item";
      const title = escapeHtml(work.title || "Planiniai darbai");
      const date = escapeHtml(work.date || "Data nenurodyta");
      const time = escapeHtml(work.time || "Laikas nenurodytas");
      const address = escapeHtml(work.address || "Adresas nenurodytas");
      const status = escapeHtml(work.emailSent ? "Išsiųsta" : work.status || "Naujas");
      const description = escapeHtml(work.description || "Aprašymas nenurodytas");

      li.innerHTML = `
        <div>
          <p class="work-title">
            <span class="status-dot ${work.emailSent ? "sent" : ""}"></span>
            ${title}
          </p>
          <div class="work-meta">
            <span class="pill">${date}</span>
            <span class="pill">${time}</span>
            <span class="pill">${address}</span>
            <span class="pill">${status}</span>
          </div>
          <p class="work-description">${description}</p>
        </div>
        <a class="button button-secondary" href="work.html?id=${work.id}">Atidaryti</a>
      `;

      list.appendChild(li);
    });
}

function renderSummary(categories) {
  document.getElementById("pastCount").textContent = categories.past.length;
  document.getElementById("currentCount").textContent = categories.current.length;
  document.getElementById("upcomingCount").textContent = categories.upcoming.length;
}

async function loadCompanyPage() {
  const id = getCompanyId();

  if (!id) {
    document.getElementById("companyTitle").textContent = "Įmonė nerasta";
    return;
  }

  const [companyRes, worksRes] = await Promise.all([
    fetch(`/companies/${id}`),
    fetch("/works")
  ]);

  if (!companyRes.ok) {
    document.getElementById("companyTitle").textContent = "Įmonė nerasta";
    return;
  }

  const company = await companyRes.json();
  const works = await worksRes.json();
  currentWorks = works;

  renderCompany(company);
  renderCompanyWorks(company, currentWorks);
}

async function updateCompany(event) {
  event.preventDefault();

  const id = getCompanyId();
  const form = event.currentTarget;
  const message = document.getElementById("companyEditMessage");

  message.textContent = "";

  const res = await apiFetch(`/companies/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getCompanyPayload(form))
  });

  if (!res.ok) {
    const error = await res.json();
    message.textContent = error.message || "Nepavyko atnaujinti įmonės.";
    return;
  }

  const company = await res.json();
  renderCompany(company);
  renderCompanyWorks(company, currentWorks);
  setEditMode(false);
}

document.getElementById("editCompanyButton").addEventListener("click", () => setEditMode(true));
document.getElementById("cancelCompanyEdit").addEventListener("click", () => setEditMode(false));
document.getElementById("companyEditForm").addEventListener("submit", updateCompany);
loadCompanyPage();
setInterval(loadCompanyPage, 60 * 1000);
