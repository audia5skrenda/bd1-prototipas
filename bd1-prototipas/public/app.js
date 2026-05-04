function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let allWorks = [];
let incompleteEmails = [];

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

function categorizeWorks(works) {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const categories = {
    recent: [],
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
      categories.recent.push(work);
    } else if (window.start > now && window.start <= next24h) {
      categories.upcoming.push(work);
    }
  });

  return categories;
}

function sortByStartTime(works) {
  return works.slice().sort((first, second) => {
    const firstWindow = getWorkWindow(first);
    const secondWindow = getWorkWindow(second);

    return (firstWindow?.start?.getTime() || 0) - (secondWindow?.start?.getTime() || 0);
  });
}

function getCompanyNames(work) {
  if (work.affectedCompanies?.length) {
    return work.affectedCompanies.map(company => company.name).filter(Boolean);
  }

  return [work.company].filter(Boolean);
}

function populateCompanyFilter(works) {
  const filter = document.getElementById("workCompanyFilter");
  const selected = filter.value;
  const names = [...new Set(works.flatMap(getCompanyNames))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "lt"));

  filter.innerHTML = `
    <option value="all">Visos įmonės</option>
    ${names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}
  `;
  filter.value = names.includes(selected) ? selected : "all";
}

function getFilteredWorks() {
  const query = document.getElementById("workSearch").value.trim().toLowerCase();
  const status = document.getElementById("workStatusFilter").value;
  const company = document.getElementById("workCompanyFilter").value;

  return allWorks.filter(work => {
    const haystack = [
      work.title,
      work.company,
      work.address,
      work.date,
      work.time,
      work.description,
      ...getCompanyNames(work)
    ].join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesStatus =
      status === "all" ||
      (status === "sent" && work.emailSent) ||
      (status === "not-sent" && !work.emailSent);
    const matchesCompany = company === "all" || getCompanyNames(work).includes(company);

    return matchesQuery && matchesStatus && matchesCompany;
  });
}

function renderWorkList(listId, works, emptyMessage) {
  const list = document.getElementById(listId);
  list.innerHTML = "";

  if (!works.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    list.appendChild(empty);
    return;
  }

  sortByStartTime(works).forEach(w => {
    const li = document.createElement("li");
    li.className = "work-item dashboard-work-item";
    const title = escapeHtml(w.title || "Planiniai darbai");
    const company = escapeHtml(w.affectedCompanies?.length ? `${w.affectedCompanies.length} įmonės` : w.company || "Įmonė nenurodyta");
    const date = escapeHtml(w.date || "Data nenurodyta");
    const time = escapeHtml(w.time || "Laikas nenurodytas");
    const status = escapeHtml(w.emailSent ? "Išsiųsta" : w.status || "Naujas");

    li.innerHTML = `
      <div>
        <p class="work-title">
          <span class="status-dot ${w.emailSent ? "sent" : ""}"></span>
          ${title}
        </p>
        <div class="work-meta">
          <span class="pill">${company}</span>
          <span class="pill">${date}</span>
          <span class="pill">${time}</span>
          <span class="pill">${status}</span>
        </div>
      </div>
      <div class="form-actions company-actions">
        <a class="button button-secondary" href="work.html?id=${w.id}">Atidaryti</a>
        <button class="button button-secondary" onclick="sendEmail(${w.id})" type="button">Siųsti</button>
      </div>
    `;

    list.appendChild(li);
  });
}

async function loadWorks() {
  const [worksRes, emailsRes] = await Promise.all([
    fetch("/works"),
    fetch("/emails").catch(() => null)
  ]);

  allWorks = await worksRes.json();
  incompleteEmails = [];

  if (emailsRes?.ok) {
    const emails = await emailsRes.json();
    incompleteEmails = emails.filter(email => email.classification?.folder !== "complete" && !email.imported);
  }

  populateCompanyFilter(allWorks);
  renderDashboard();
}

function renderDashboard() {
  const categories = categorizeWorks(getFilteredWorks());

  document.getElementById("recentWorksCount").textContent = categories.recent.length;
  document.getElementById("currentWorksCount").textContent = categories.current.length;
  document.getElementById("upcomingWorksCount").textContent = categories.upcoming.length;
  document.getElementById("incompleteEmailsCount").textContent = incompleteEmails.length;

  renderWorkList("recentWorks", categories.recent, "Per paskutines 24 val. darbų nebuvo.");
  renderWorkList("currentWorks", categories.current, "Šiuo metu darbų nėra.");
  renderWorkList("upcomingWorks", categories.upcoming, "Per artimiausias 24 val. darbų nėra.");
  renderIncompleteEmails();
}

function renderIncompleteEmails() {
  const list = document.getElementById("incompleteEmails");
  list.innerHTML = "";

  if (!incompleteEmails.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Nepilnų emailų nėra.";
    list.appendChild(empty);
    return;
  }

  incompleteEmails.slice(0, 8).forEach(email => {
    const li = document.createElement("li");
    li.className = "work-item dashboard-work-item";
    const subject = escapeHtml(email.subject || "(be temos)");
    const from = escapeHtml(email.from || "Siuntėjas nenurodytas");
    const missing = escapeHtml(email.classification?.missingFields?.join(", ") || "Trūksta informacijos");

    li.innerHTML = `
      <div>
        <p class="work-title">
          <span class="status-dot"></span>
          ${subject}
        </p>
        <div class="work-meta">
          <span class="pill">${from}</span>
          <span class="pill">Trūksta: ${missing}</span>
        </div>
      </div>
      <div class="form-actions company-actions">
        <a class="button button-secondary" href="email.html?uid=${email.uid}">Tvarkyti</a>
      </div>
    `;

    list.appendChild(li);
  });
}

async function sendEmail(id) {
  const res = await fetch(`/send-email/${id}`, { method: "POST" });

  if (!res.ok) {
    const error = await res.json();
    alert(error.details || "Nepavyko išsiųsti");
    return;
  }

  alert("Išsiųsta į testinį adresą");
  loadWorks();
}

loadWorks();
document.getElementById("workSearch").addEventListener("input", renderDashboard);
document.getElementById("workStatusFilter").addEventListener("change", renderDashboard);
document.getElementById("workCompanyFilter").addEventListener("change", renderDashboard);
setInterval(loadWorks, 60 * 1000);
