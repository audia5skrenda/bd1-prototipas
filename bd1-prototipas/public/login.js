document.getElementById("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.currentTarget;
  const message = document.getElementById("loginMessage");
  const payload = Object.fromEntries(new FormData(form).entries());

  message.textContent = "Jungiamasi...";

  const res = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();

  if (!res.ok) {
    message.textContent = data.message || "Nepavyko prisijungti.";
    return;
  }

  setCurrentUser(data);
  window.location.href = "index.html";
});
