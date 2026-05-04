function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let allEmails = [];
let currentPage = 1;
const EMAILS_PER_PAGE = 20;

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("lt-LT");
}

async function confirmEmail(uid, button) {
  button.disabled = true;
  button.textContent = "Tvirtinama...";

  const res = await fetch(`/confirm-email/${uid}`, { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    button.disabled = false;
    button.textContent = data.details || data.message || "Nepavyko";
    return;
  }

  button.textContent = "Patvirtinta";
  loadEmails();
}

async function rejectEmail(uid, button) {
  button.disabled = true;
  button.textContent = "Atmetama...";

  const res = await fetch(`/reject-email/${uid}`, { method: "POST" });
  const data = await res.json();

  if (!res.ok) {
    button.disabled = false;
    button.textContent = data.message || "Nepavyko";
    return;
  }

  button.textContent = "Atmesta";
  loadEmails();
}

const folderState = {
  complete: true,
  partial: true,
  empty: true
};

function getFilteredEmails() {
  const query = document.getElementById("emailSearch").value.trim().toLowerCase();
  const sort = document.getElementById("emailSort").value;
  const readFilter = document.getElementById("emailReadFilter").value;

  const filtered = allEmails.filter(email => {
    const haystack = [
      email.subject,
      email.from,
      email.to,
      formatDateTime(email.sentAt),
      email.classification?.missingFields?.join(" ")
    ].join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesRead =
      readFilter === "all" ||
      (readFilter === "seen" && email.seen) ||
      (readFilter === "unseen" && !email.seen);

    return matchesQuery && matchesRead;
  });

  return sortEmails(filtered, sort);
}

function sortEmails(emails, sort) {
  return emails.slice().sort((first, second) => {
    if (sort === "oldest") {
      return getEmailTime(first) - getEmailTime(second);
    }

    if (sort === "subject") {
      return String(first.subject || "").localeCompare(String(second.subject || ""), "lt");
    }

    if (sort === "sender") {
      return String(first.from || "").localeCompare(String(second.from || ""), "lt");
    }

    if (sort === "unread") {
      return Number(first.seen) - Number(second.seen) || getEmailTime(second) - getEmailTime(first);
    }

    return getEmailTime(second) - getEmailTime(first);
  });
}

function getEmailTime(email) {
  const time = new Date(email.sentAt || email.receivedAt || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

async function loadEmails() {
  const folders = {
    empty: document.getElementById("emptyEmails"),
    partial: document.getElementById("partialEmails"),
    complete: document.getElementById("completeEmails")
  };
  const counts = {
    empty: document.getElementById("emptyEmailCount"),
    partial: document.getElementById("partialEmailCount"),
    complete: document.getElementById("completeEmailCount")
  };

  Object.values(folders).forEach(list => {
    list.innerHTML = "";
  });

  const res = await fetch("/emails");
  const data = await res.json();

  if (!res.ok) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = data.details || data.message || "Nepavyko gauti emailų.";
    folders.empty.appendChild(empty);
    Object.values(counts).forEach(count => {
      count.textContent = "0";
    });
    return;
  }

  allEmails = data;
  renderEmails();
}

function renderEmails() {
  const data = getFilteredEmails();
  const totalPages = Math.max(1, Math.ceil(data.length / EMAILS_PER_PAGE));

  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  const pageStart = (currentPage - 1) * EMAILS_PER_PAGE;
  const pageEmails = data.slice(pageStart, pageStart + EMAILS_PER_PAGE);
  const folders = {
    empty: document.getElementById("emptyEmails"),
    partial: document.getElementById("partialEmails"),
    complete: document.getElementById("completeEmails")
  };
  const counts = {
    empty: document.getElementById("emptyEmailCount"),
    partial: document.getElementById("partialEmailCount"),
    complete: document.getElementById("completeEmailCount")
  };

  Object.values(folders).forEach(list => {
    list.innerHTML = "";
  });

  const groupedCounts = {
    complete: data.filter(email => email.classification?.folder === "complete").length,
    partial: data.filter(email => email.classification?.folder === "partial").length,
    empty: data.filter(email => email.classification?.folder === "empty").length
  };
  const grouped = {
    complete: pageEmails.filter(email => email.classification?.folder === "complete"),
    partial: pageEmails.filter(email => email.classification?.folder === "partial"),
    empty: pageEmails.filter(email => email.classification?.folder === "empty")
  };

  Object.entries(grouped).forEach(([folder, emails]) => {
    counts[folder].textContent = groupedCounts[folder];
    renderEmailFolder(folders[folder], emails, getEmptyMessage(folder));
  });

  renderPagination(data.length, totalPages, pageStart, pageEmails.length);
  syncFolderVisibility();
}

function renderPagination(totalEmails, totalPages, pageStart, pageCount) {
  const from = totalEmails ? pageStart + 1 : 0;
  const to = pageStart + pageCount;

  document.getElementById("emailPageSummary").textContent = `${from}-${to} iš ${totalEmails} emailų`;
  document.getElementById("emailPageIndicator").textContent = `${currentPage} / ${totalPages}`;
  document.getElementById("previousEmailPage").disabled = currentPage <= 1;
  document.getElementById("nextEmailPage").disabled = currentPage >= totalPages;
}

function getEmptyMessage(folder) {
  if (folder === "empty") {
    return "Emailų be atpažintos informacijos nėra.";
  }

  if (folder === "partial") {
    return "Emailų su daline informacija nėra.";
  }

  return "Emailų su visa reikalinga informacija nėra.";
}

function renderEmailFolder(list, emails, emptyMessage) {
  list.innerHTML = "";

  if (!emails.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    list.appendChild(empty);
    return;
  }

  emails.forEach(email => {
    const li = document.createElement("li");
    li.className = "email-row";
    const subject = escapeHtml(email.subject || "(be temos)");
    const from = escapeHtml(email.from || "Siuntėjas nenurodytas");
    const sentAt = escapeHtml(formatDateTime(email.sentAt));
    const status = email.seen ? "Skaitytas" : "Naujas";
    const imported = email.imported ? "Importuotas" : "Neimportuotas";
    const missing = escapeHtml(email.classification?.missingFields?.join(", ") || "-");
    const canConfirm = email.classification?.folder === "complete" && !email.imported;
    const canReject = !email.imported;

    li.innerHTML = `
      <div class="email-row-status">
        <span class="status-dot ${email.seen ? "sent" : ""}"></span>
        <span>${escapeHtml(status)}</span>
      </div>
      <div class="email-row-main">
        <a class="email-subject" href="email.html?uid=${email.uid}">${subject}</a>
        <span class="email-muted">${from}</span>
      </div>
      <span class="email-muted">${sentAt}</span>
      <span class="email-muted">${escapeHtml(imported)}</span>
      <span class="email-muted">${missing}</span>
      <div class="email-row-actions">
        ${canConfirm ? `<button class="button button-primary" type="button" data-confirm-email="${email.uid}">Patvirtinti</button>` : ""}
        ${canReject ? `<button class="button button-secondary" type="button" data-reject-email="${email.uid}">Atmesti</button>` : ""}
        <a class="button button-secondary" href="email.html?uid=${email.uid}">Atidaryti</a>
      </div>
    `;

    list.appendChild(li);
  });
}

function syncFolderVisibility() {
  Object.entries(folderState).forEach(([folder, isOpen]) => {
    const section = document.querySelector(`[data-email-folder="${folder}"]`);
    const button = document.querySelector(`[data-toggle-folder="${folder}"]`);
    const list = document.getElementById(`${folder}Emails`);

    if (!section || !button || !list) {
      return;
    }

    section.classList.toggle("is-collapsed", !isOpen);
    list.classList.toggle("hidden", !isOpen);
    button.textContent = isOpen ? "Uždaryti" : "Atidaryti";
    button.setAttribute("aria-expanded", String(isOpen));
  });
}

document.querySelectorAll("[data-toggle-folder]").forEach(button => {
  button.addEventListener("click", () => {
    const folder = button.dataset.toggleFolder;
    folderState[folder] = !folderState[folder];
    syncFolderVisibility();
  });
});

function resetEmailPageAndRender() {
  currentPage = 1;
  renderEmails();
}

document.getElementById("emailSearch").addEventListener("input", resetEmailPageAndRender);
document.getElementById("emailSort").addEventListener("change", resetEmailPageAndRender);
document.getElementById("emailReadFilter").addEventListener("change", resetEmailPageAndRender);
document.getElementById("previousEmailPage").addEventListener("click", () => {
  currentPage = Math.max(1, currentPage - 1);
  renderEmails();
});
document.getElementById("nextEmailPage").addEventListener("click", () => {
  currentPage += 1;
  renderEmails();
});

document.addEventListener("click", event => {
  const confirmButton = event.target.closest("[data-confirm-email]");
  const rejectButton = event.target.closest("[data-reject-email]");

  if (confirmButton) {
    confirmEmail(confirmButton.dataset.confirmEmail, confirmButton);
  }

  if (rejectButton) {
    rejectEmail(rejectButton.dataset.rejectEmail, rejectButton);
  }
});

loadEmails();
