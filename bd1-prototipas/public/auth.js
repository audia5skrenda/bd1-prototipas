const AUTH_STORAGE_KEY = "planiniaiUser";

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

function setCurrentUser(user) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
}

function logout() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  window.location.href = "login.html";
}

function authHeaders(extraHeaders = {}) {
  const user = getCurrentUser();

  return {
    ...extraHeaders,
    "X-User-Role": user?.role || "",
    "X-User-Id": user?.id || ""
  };
}

function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: authHeaders(options.headers || {})
  });
}

function isAdmin() {
  return getCurrentUser()?.role === "admin";
}

function requireLogin() {
  const isLoginPage = window.location.pathname.endsWith("/login.html");
  const user = getCurrentUser();

  if (!user && !isLoginPage) {
    window.location.href = "login.html";
    return null;
  }

  return user;
}

function requireAdminPage() {
  if (!isAdmin()) {
    window.location.href = "index.html";
  }
}

function applyRoleUi() {
  const user = getCurrentUser();

  document.querySelectorAll("[data-admin-only]").forEach(element => {
    element.classList.toggle("hidden", !isAdmin());
  });

  const topbarActions = document.querySelector(".topbar-actions");

  if (!user || !topbarActions || document.getElementById("logoutButton")) {
    return;
  }

  const badge = document.createElement("span");
  badge.className = "auth-badge";
  badge.textContent = `${user.name} (${user.role})`;
  topbarActions.appendChild(badge);

  const button = document.createElement("button");
  button.className = "button button-secondary";
  button.id = "logoutButton";
  button.type = "button";
  button.textContent = "Atsijungti";
  button.addEventListener("click", logout);
  topbarActions.appendChild(button);
}

requireLogin();
document.addEventListener("DOMContentLoaded", applyRoleUi);
