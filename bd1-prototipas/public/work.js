function getWorkId() {
  return new URLSearchParams(window.location.search).get("id");
}

function renderValue(id, value) {
  document.getElementById(id).textContent = value || "-";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let currentWork = null;

function getAffectedCompanies(work) {
  if (work.affectedCompanies?.length) {
    return work.affectedCompanies;
  }

  return [{
    id: work.companyId,
    name: work.company,
    address: work.address
  }];
}

function renderAffectedCompanies(work) {
  const list = document.getElementById("affectedCompanies");
  const companies = getAffectedCompanies(work);
  list.innerHTML = "";

  if (!companies.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Paveiktų įmonių nėra.";
    list.appendChild(empty);
    return;
  }

  companies.forEach(company => {
    const li = document.createElement("li");
    li.className = "work-item";
    const name = escapeHtml(company.name || "Įmonė nenurodyta");
    const address = escapeHtml(company.address || "Adresas nenurodytas");
    const id = escapeHtml(company.id || "ID nenurodytas");

    li.innerHTML = `
      <div>
        <p class="work-title">
          <span class="status-dot sent"></span>
          ${name}
        </p>
        <div class="work-meta">
          <span class="pill">ID: ${id}</span>
          <span class="pill">${address}</span>
        </div>
      </div>
      ${company.id ? `<a class="button button-secondary" href="company.html?id=${company.id}">Įmonė</a>` : ""}
    `;

    list.appendChild(li);
  });
}

function renderWork(work) {
  currentWork = work;
  document.title = work.title || "Planiniai darbai";
  document.getElementById("workTitle").textContent = work.title || "Planiniai darbai";
  renderValue("workDate", work.date);
  renderValue("workTime", work.time);
  renderValue("workDuration", work.duration);
  renderValue("workStatus", work.emailSent ? `Išsiųsta į ${work.sentTo || "testinį adresą"}` : work.status);
  renderValue("workDescription", work.description);
  renderAffectedCompanies(work);
}

async function loadWork() {
  const id = getWorkId();

  if (!id) {
    document.getElementById("workTitle").textContent = "Darbas nerastas";
    return;
  }

  const res = await fetch(`/works/${id}`);
  const data = await res.json();

  if (!res.ok) {
    document.getElementById("workTitle").textContent = data.message || "Darbas nerastas";
    return;
  }

  renderWork(data);
}

async function sendWork() {
  if (!currentWork) {
    return;
  }

  const res = await fetch(`/send-email/${currentWork.id}`, { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    alert(data.details || "Nepavyko išsiųsti");
    return;
  }

  renderWork(data.work);
  alert("Testiniai emailai išsiųsti");
}

document.getElementById("sendWorkButton").addEventListener("click", sendWork);
loadWork();
