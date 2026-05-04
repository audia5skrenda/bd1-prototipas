function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let allWorks = [];
let currentWorksPage = 1;
const WORKS_PER_PAGE = 20;

function getCompanyLabel(work) {
  if (work.affectedCompanies?.length) {
    return work.affectedCompanies.map(company => company.name).filter(Boolean).join(", ");
  }

  return work.company || "Įmonė nenurodyta";
}

function getWorkTime(work) {
  const time = new Date(`${work.date || ""}T${String(work.time || "00:00").split(/[-–—]/)[0]}`).getTime();
  const fallback = new Date(work.createdAt || 0).getTime();

  return Number.isNaN(time) ? fallback || 0 : time;
}

function getFilteredWorks() {
  const query = document.getElementById("allWorksSearch").value.trim().toLowerCase();
  const status = document.getElementById("allWorksStatus").value;
  const sort = document.getElementById("allWorksSort").value;
  const filtered = allWorks.filter(work => {
    const haystack = [
      work.title,
      getCompanyLabel(work),
      work.address,
      work.date,
      work.time,
      work.description,
      work.status
    ].join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesStatus =
      status === "all" ||
      (status === "sent" && work.emailSent) ||
      (status === "not-sent" && !work.emailSent);

    return matchesQuery && matchesStatus;
  });

  return sortWorks(filtered, sort);
}

function sortWorks(works, sort) {
  return works.slice().sort((first, second) => {
    if (sort === "oldest") {
      return getWorkTime(first) - getWorkTime(second);
    }

    if (sort === "company") {
      return getCompanyLabel(first).localeCompare(getCompanyLabel(second), "lt");
    }

    if (sort === "status") {
      return String(first.emailSent ? "Išsiųsta" : first.status || "").localeCompare(String(second.emailSent ? "Išsiųsta" : second.status || ""), "lt");
    }

    return getWorkTime(second) - getWorkTime(first);
  });
}

async function loadAllWorks() {
  const res = await fetch("/works");
  allWorks = await res.json();
  renderAllWorks();
}

function renderAllWorks() {
  const filtered = getFilteredWorks();
  const totalPages = Math.max(1, Math.ceil(filtered.length / WORKS_PER_PAGE));

  if (currentWorksPage > totalPages) {
    currentWorksPage = totalPages;
  }

  const pageStart = (currentWorksPage - 1) * WORKS_PER_PAGE;
  const pageWorks = filtered.slice(pageStart, pageStart + WORKS_PER_PAGE);
  const list = document.getElementById("allWorksList");
  list.innerHTML = "";

  if (!pageWorks.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Darbų nėra.";
    list.appendChild(empty);
  } else {
    pageWorks.forEach(renderWorkRow);
  }

  renderPagination(filtered.length, totalPages, pageStart, pageWorks.length);
}

function renderWorkRow(work) {
  const list = document.getElementById("allWorksList");
  const li = document.createElement("li");
  li.className = "work-row";
  const title = escapeHtml(work.title || "Planiniai darbai");
  const company = escapeHtml(getCompanyLabel(work));
  const date = escapeHtml(work.date || "-");
  const time = escapeHtml(work.time || "-");
  const status = escapeHtml(work.emailSent ? "Išsiųsta" : work.status || "Naujas");
  const description = escapeHtml(work.description || "-");

  li.innerHTML = `
    <div class="email-row-status">
      <span class="status-dot ${work.emailSent ? "sent" : ""}"></span>
      <span>${status}</span>
    </div>
    <div class="email-row-main">
      <a class="email-subject" href="work.html?id=${work.id}">${title}</a>
      <span class="email-muted">${description}</span>
    </div>
    <span class="email-muted">${company}</span>
    <span class="email-muted">${date}</span>
    <span class="email-muted">${time}</span>
    <div class="email-row-actions">
      <a class="button button-secondary" href="work.html?id=${work.id}">Atidaryti</a>
      <button class="button button-secondary" type="button" data-send-work="${work.id}">Siųsti</button>
    </div>
  `;

  list.appendChild(li);
}

function renderPagination(totalWorks, totalPages, pageStart, pageCount) {
  const from = totalWorks ? pageStart + 1 : 0;
  const to = pageStart + pageCount;

  document.getElementById("worksPageSummary").textContent = `${from}-${to} iš ${totalWorks} darbų`;
  document.getElementById("worksPageIndicator").textContent = `${currentWorksPage} / ${totalPages}`;
  document.getElementById("previousWorksPage").disabled = currentWorksPage <= 1;
  document.getElementById("nextWorksPage").disabled = currentWorksPage >= totalPages;
}

function resetWorksPageAndRender() {
  currentWorksPage = 1;
  renderAllWorks();
}

async function sendWork(id, button) {
  button.disabled = true;
  button.textContent = "Siunčiama...";

  const res = await fetch(`/send-email/${id}`, { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    button.disabled = false;
    button.textContent = "Siųsti";
    alert(data.details || "Nepavyko išsiųsti");
    return;
  }

  await loadAllWorks();
}

document.getElementById("allWorksSearch").addEventListener("input", resetWorksPageAndRender);
document.getElementById("allWorksSort").addEventListener("change", resetWorksPageAndRender);
document.getElementById("allWorksStatus").addEventListener("change", resetWorksPageAndRender);
document.getElementById("previousWorksPage").addEventListener("click", () => {
  currentWorksPage = Math.max(1, currentWorksPage - 1);
  renderAllWorks();
});
document.getElementById("nextWorksPage").addEventListener("click", () => {
  currentWorksPage += 1;
  renderAllWorks();
});
document.addEventListener("click", event => {
  const button = event.target.closest("[data-send-work]");

  if (!button) {
    return;
  }

  sendWork(button.dataset.sendWork, button);
});

loadAllWorks();
