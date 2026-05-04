function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getFormPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setMessage(id, text) {
  document.getElementById(id).textContent = text || "";
}

async function loadSettings() {
  requireAdminPage();

  const res = await fetch("/settings");
  const settings = await res.json();

  if (!res.ok) {
    setMessage("settingsMessage", settings.message || "Nepavyko gauti nustatymų.");
    return;
  }

  document.getElementById("autoEmailProcessing").checked = Boolean(settings.autoEmailProcessing);
}

async function saveSettings() {
  const checkbox = document.getElementById("autoEmailProcessing");
  setMessage("settingsMessage", "Saugoma...");

  const res = await apiFetch("/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoEmailProcessing: checkbox.checked })
  });
  const data = await res.json();

  if (!res.ok) {
    setMessage("settingsMessage", data.message || "Nepavyko išsaugoti nustatymų.");
    return;
  }

  setMessage(
    "settingsMessage",
    data.autoEmailProcessing
      ? "Automatinis email apdorojimas įjungtas."
      : "Automatinis email apdorojimas išjungtas. Emailus reikės patvirtinti rankiniu būdu."
  );
}

async function loadUsers() {
  const list = document.getElementById("usersList");
  list.innerHTML = "";

  const res = await apiFetch("/users");
  const users = await res.json();

  if (!res.ok) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent = users.message || "Nepavyko gauti vartotojų.";
    list.appendChild(li);
    return;
  }

  if (!users.length) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent = "Vartotojų dar nėra.";
    list.appendChild(li);
    return;
  }

  users.forEach(user => {
    const li = document.createElement("li");
    li.className = "work-item";
    li.innerHTML = `
      <div>
        <p class="work-title">${escapeHtml(user.name)}</p>
        <div class="work-meta">
          <span class="pill">ID: ${escapeHtml(user.id)}</span>
          <span class="pill">${escapeHtml(user.role)}</span>
        </div>
      </div>
      <button class="button button-secondary" type="button" data-delete-user="${escapeHtml(user.id)}">Ištrinti</button>
    `;
    list.appendChild(li);
  });
}

async function deleteUser(id) {
  setMessage("userMessage", "Trinama...");

  const res = await apiFetch(`/users/${id}`, { method: "DELETE" });
  const data = await res.json();

  if (!res.ok) {
    setMessage("userMessage", data.message || "Nepavyko ištrinti vartotojo.");
    return;
  }

  setMessage("userMessage", data.message || "Vartotojas ištrintas.");
  loadUsers();
}

document.getElementById("autoEmailProcessing").addEventListener("change", saveSettings);

document.getElementById("userForm").addEventListener("submit", async event => {
  event.preventDefault();
  setMessage("userMessage", "Kuriama...");

  const res = await apiFetch("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getFormPayload(event.currentTarget))
  });
  const data = await res.json();

  if (!res.ok) {
    setMessage("userMessage", data.message || "Nepavyko sukurti vartotojo.");
    return;
  }

  event.currentTarget.reset();
  setMessage("userMessage", "Vartotojas sukurtas.");
  loadUsers();
});

document.getElementById("settingsCompanyForm").addEventListener("submit", async event => {
  event.preventDefault();
  setMessage("settingsCompanyMessage", "Kuriama...");

  const res = await apiFetch("/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getFormPayload(event.currentTarget))
  });
  const data = await res.json();

  if (!res.ok) {
    setMessage("settingsCompanyMessage", data.message || "Nepavyko pridėti įmonės.");
    return;
  }

  event.currentTarget.reset();
  setMessage("settingsCompanyMessage", `Įmonė pridėta. ID: ${data.id}`);
});

document.getElementById("usersList").addEventListener("click", event => {
  const button = event.target.closest("[data-delete-user]");

  if (!button) {
    return;
  }

  deleteUser(button.dataset.deleteUser);
});

loadSettings();
loadUsers();
