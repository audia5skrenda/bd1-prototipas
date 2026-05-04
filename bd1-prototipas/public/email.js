function getEmailUid() {
  return new URLSearchParams(window.location.search).get("uid");
}

let companySuggestions = [];
let currentEmail = null;

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("lt-LT");
}

function renderValue(id, value) {
  document.getElementById(id).textContent = value || "-";
}

function setInputValue(id, value) {
  document.getElementById(id).value = value || "";
}

function setConfirmMessage(text) {
  document.getElementById("confirmEmailMessage").textContent = text || "";
}

function renderParsedWork(parsedWork = {}) {
  const enrichedWork = enrichParsedWork(parsedWork);

  setInputValue("parsedCompanyId", enrichedWork.companyIds?.length ? enrichedWork.companyIds.join(", ") : enrichedWork.companyId);
  setInputValue("parsedCompany", enrichedWork.company);
  setInputValue("parsedAddress", enrichedWork.address);
  setInputValue("parsedPhone", parsedWork.phone);
  setInputValue("parsedEmail", parsedWork.email);
  setInputValue("parsedDate", parsedWork.date);
  setInputValue("parsedTime", parsedWork.time);
  setInputValue("parsedDuration", parsedWork.duration);
  setInputValue("parsedDescription", parsedWork.description);
}

function enrichParsedWork(parsedWork = {}) {
  const ids = parsedWork.companyIds?.length
    ? parsedWork.companyIds.map(String)
    : parsedWork.companyId
      ? [String(parsedWork.companyId)]
      : [];
  const matchedCompanies = ids
    .map(id => companySuggestions.find(company => String(company.id) === id))
    .filter(Boolean);

  if (!matchedCompanies.length) {
    return parsedWork;
  }

  return {
    ...parsedWork,
    companyIds: ids,
    companyId: ids[0] || parsedWork.companyId,
    company: parsedWork.company || matchedCompanies.map(company => company.name).join(", "),
    address: parsedWork.address || matchedCompanies.map(company => company.address).join("; "),
    phone: parsedWork.phone || matchedCompanies[0].phone || "",
    email: parsedWork.email || matchedCompanies[0].email || ""
  };
}

function getEditedWorkPayload() {
  const formData = new FormData(document.getElementById("emailWorkForm"));
  const payload = Object.fromEntries(formData.entries());
  const companyIds = String(payload.companyId || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  return {
    ...payload,
    companyId: companyIds[0] || "",
    companyIds,
    affectedCompanyRefs: companyIds.length
      ? companyIds.map(companyId => ({ companyId }))
      : [{ company: payload.company, address: payload.address }]
  };
}

async function loadCompanySuggestions() {
  const res = await fetch("/companies");

  if (!res.ok) {
    return;
  }

  companySuggestions = await res.json();
  renderDatalist("companyIdSuggestions", companySuggestions.map(company => ({
    value: company.id,
    label: `${company.name} | ${company.address}`
  })));
  renderDatalist("companyNameSuggestions", companySuggestions.map(company => ({
    value: company.name,
    label: `${company.id} | ${company.address}`
  })));
  renderDatalist("companyAddressSuggestions", companySuggestions.map(company => ({
    value: company.address,
    label: `${company.id} | ${company.name}`
  })));
}

function renderDatalist(id, options) {
  document.getElementById(id).innerHTML = options.map(option => `
    <option value="${escapeHtml(option.value)}" label="${escapeHtml(option.label)}"></option>
  `).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderEmail(email) {
  currentEmail = email;
  document.title = email.subject || "Email";
  document.getElementById("emailTitle").textContent = email.subject || "(be temos)";
  renderValue("emailSentAt", formatDateTime(email.sentAt));
  renderValue("emailReceivedAt", formatDateTime(email.receivedAt));
  renderValue("emailFrom", email.from);
  renderValue("emailTo", email.to);
  document.getElementById("emailBody").textContent = email.text || email.html || "";
  renderParsedWork(email.parsedWork);
  renderConfirmButton(email);
  renderRejectButton(email);
}

function renderConfirmButton(email) {
  const buttons = [
    document.getElementById("confirmEmailButton"),
    document.getElementById("confirmEmailButtonSecondary")
  ].filter(Boolean);

  buttons.forEach(button => {
    button.classList.remove("hidden");
    button.onclick = null;

    if (email.imported) {
      button.textContent = "Jau patvirtinta";
      button.disabled = true;
      setConfirmMessage("Šis email jau importuotas.");
      return;
    }

    button.textContent = "Patvirtinti";
    button.disabled = false;
    button.onclick = () => confirmCurrentEmail(button);
  });
}

function renderRejectButton(email) {
  const button = document.getElementById("rejectEmailButton");

  if (!button) {
    return;
  }

  if (email.imported) {
    button.classList.add("hidden");
    button.onclick = null;
    return;
  }

  button.classList.remove("hidden");
  button.disabled = false;
  button.textContent = "Atmesti";
  button.onclick = () => rejectCurrentEmail(button);
}

async function confirmCurrentEmail(button) {
  const uid = getEmailUid();

  if (!uid) {
    return;
  }

  button.disabled = true;
  button.textContent = "Tvirtinama...";
  const payload = getEditedWorkPayload();
  const validationMessage = validateEditedWorkPayload(payload);

  if (validationMessage) {
    button.disabled = false;
    button.textContent = "Patvirtinti";
    setConfirmMessage(validationMessage);
    return;
  }

  setAllConfirmButtonsDisabled(true, "Tvirtinama...");
  setConfirmMessage("Kuriamas planinis darbas ir siunčiami testiniai pranešimai...");

  const res = await fetch(`/confirm-email/${uid}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parsedWork: payload })
  });
  const data = await res.json();

  if (!res.ok) {
    setAllConfirmButtonsDisabled(false, "Patvirtinti");
    setConfirmMessage(data.details || data.message || "Nepavyko patvirtinti email.");
    return;
  }

  setConfirmMessage(data.message || "Email patvirtintas, planinis darbas sukurtas.");
  setAllConfirmButtonsDisabled(true, "Jau patvirtinta");
  document.getElementById("rejectEmailButton")?.classList.add("hidden");
}

async function rejectCurrentEmail(button) {
  const uid = getEmailUid();

  if (!uid) {
    return;
  }

  button.disabled = true;
  button.textContent = "Atmetama...";
  setConfirmMessage("Email atmetamas...");

  const res = await fetch(`/reject-email/${uid}`, { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    button.disabled = false;
    button.textContent = "Atmesti";
    setConfirmMessage(data.message || "Nepavyko atmesti email.");
    return;
  }

  setConfirmMessage(data.message || "Email atmestas.");
  window.location.href = "emails.html";
}

function validateEditedWorkPayload(payload) {
  const hasCompanyIds = payload.companyIds?.length;
  const hasCompanyAndAddress = payload.company && payload.address;

  if (!hasCompanyIds && !hasCompanyAndAddress) {
    return "Pasirink įmonės ID arba įvesk įmonės pavadinimą ir adresą.";
  }

  if (!payload.date) {
    return "Įvesk datą.";
  }

  if (!payload.time) {
    return "Įvesk laiką.";
  }

  if (!payload.description) {
    return "Įvesk aprašymą.";
  }

  return "";
}

function setAllConfirmButtonsDisabled(disabled, text) {
  ["confirmEmailButton", "confirmEmailButtonSecondary"].forEach(id => {
    const button = document.getElementById(id);

    if (!button) {
      return;
    }

    button.disabled = disabled;
    button.textContent = text;
  });
}

function syncCompanyFields(source) {
  const idValue = document.getElementById("parsedCompanyId").value.trim();
  const companyValue = document.getElementById("parsedCompany").value.trim().toLowerCase();
  const addressValue = document.getElementById("parsedAddress").value.trim().toLowerCase();
  let company = null;

  if (source === "id") {
    const firstId = idValue.split(",").map(value => value.trim()).filter(Boolean)[0];
    company = companySuggestions.find(item => String(item.id) === firstId);
  } else if (source === "name") {
    company = companySuggestions.find(item => item.name.toLowerCase() === companyValue);
  } else if (source === "address") {
    company = companySuggestions.find(item => item.address.toLowerCase() === addressValue);
  }

  if (!company) {
    return;
  }

  setInputValue("parsedCompanyId", company.id);
  setInputValue("parsedCompany", company.name);
  setInputValue("parsedAddress", company.address);
  setInputValue("parsedPhone", document.getElementById("parsedPhone").value || company.phone);
  setInputValue("parsedEmail", document.getElementById("parsedEmail").value || company.email);
  setConfirmMessage("");
}

async function loadEmail() {
  const uid = getEmailUid();

  if (!uid) {
    document.getElementById("emailTitle").textContent = "Email nerastas";
    return;
  }

  const res = await fetch(`/emails/${uid}`);
  const data = await res.json();

  if (!res.ok) {
    document.getElementById("emailTitle").textContent = data.details || data.message || "Email nerastas";
    return;
  }

  renderEmail(data);
}

document.getElementById("parsedCompanyId").addEventListener("change", () => syncCompanyFields("id"));
document.getElementById("parsedCompany").addEventListener("change", () => syncCompanyFields("name"));
document.getElementById("parsedAddress").addEventListener("change", () => syncCompanyFields("address"));

Promise.all([
  loadCompanySuggestions(),
  loadEmail()
]).then(() => {
  if (currentEmail) {
    renderParsedWork(currentEmail.parsedWork);
  }
});
