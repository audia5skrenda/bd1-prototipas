function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let allCompanies = [];
let currentCompaniesPage = 1;
const COMPANIES_PER_PAGE = 20;

function getFilteredCompanies() {
  const query = document.getElementById("companySearch").value.trim().toLowerCase();
  const contactFilter = document.getElementById("companyContactFilter").value;

  return allCompanies.filter(company => {
    const haystack = [
      company.id,
      company.name,
      company.address,
      company.phone,
      company.email
    ].join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesContact =
      contactFilter === "all" ||
      (contactFilter === "with-email" && company.email) ||
      (contactFilter === "without-email" && !company.email) ||
      (contactFilter === "with-phone" && company.phone) ||
      (contactFilter === "without-phone" && !company.phone);

    return matchesQuery && matchesContact;
  });
}

async function loadCompanies() {
  const res = await fetch("/companies");
  allCompanies = await res.json();
  renderCompanies();
}

function renderCompanies() {
  const data = getFilteredCompanies();
  const totalPages = Math.max(1, Math.ceil(data.length / COMPANIES_PER_PAGE));

  if (currentCompaniesPage > totalPages) {
    currentCompaniesPage = totalPages;
  }

  const pageStart = (currentCompaniesPage - 1) * COMPANIES_PER_PAGE;
  const pageCompanies = data.slice(pageStart, pageStart + COMPANIES_PER_PAGE);
  const list = document.getElementById("companies");
  const totalCompanies = document.getElementById("totalCompanies");
  const companiesWithAddress = document.getElementById("companiesWithAddress");
  const companiesStatus = document.getElementById("companiesStatus");

  list.innerHTML = "";
  totalCompanies.textContent = data.length;
  companiesWithAddress.textContent = data.filter(company => company.address).length;
  companiesStatus.textContent = data.length ? "Aktyvu" : "Tuščia";
  renderCompaniesPagination(data.length, totalPages, pageStart, pageCompanies.length);

  if (!data.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = "Įmonių dar nėra.";
    list.appendChild(empty);
    return;
  }

  pageCompanies.forEach(company => {
    const li = document.createElement("li");
    li.className = "work-item company-item";
    li.dataset.companyId = company.id;

    const name = escapeHtml(company.name || "Įmonė nenurodyta");
    const id = escapeHtml(company.id || "ID nenurodytas");
    const address = escapeHtml(company.address || "Adresas nenurodytas");
    const phone = escapeHtml(company.phone || "Telefonas nenurodytas");
    const email = escapeHtml(company.email || "El. paštas nenurodytas");

    li.innerHTML = `
      <div>
        <p class="work-title">
          <span class="status-dot sent"></span>
          ${name}
        </p>
        <div class="work-meta">
          <span class="pill">ID: ${id}</span>
          <span class="pill">${address}</span>
          <span class="pill">${phone}</span>
          <span class="pill">${email}</span>
        </div>
      </div>
      <div class="form-actions company-actions">
        <a class="button button-secondary" href="company.html?id=${company.id}">Atidaryti</a>
      </div>
    `;

    list.appendChild(li);
  });
}

function renderCompaniesPagination(totalCompanies, totalPages, pageStart, pageCount) {
  const from = totalCompanies ? pageStart + 1 : 0;
  const to = pageStart + pageCount;

  document.getElementById("companiesPageSummary").textContent = `${from}-${to} iš ${totalCompanies} įmonių`;
  document.getElementById("companiesPageIndicator").textContent = `${currentCompaniesPage} / ${totalPages}`;
  document.getElementById("previousCompaniesPage").disabled = currentCompaniesPage <= 1;
  document.getElementById("nextCompaniesPage").disabled = currentCompaniesPage >= totalPages;
}

function resetCompaniesPageAndRender() {
  currentCompaniesPage = 1;
  renderCompanies();
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

async function createCompany(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const message = document.getElementById("companyMessage");
  const payload = getCompanyPayload(form);

  message.textContent = "";

  const res = await apiFetch("/companies", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const error = await res.json();
    message.textContent = error.message || "Nepavyko sukurti įmonės.";
    return;
  }

  form.reset();
  message.textContent = "Įmonė sukurta.";
  await loadCompanies();
}

document.getElementById("companyForm").addEventListener("submit", createCompany);
document.getElementById("companySearch").addEventListener("input", resetCompaniesPageAndRender);
document.getElementById("companyContactFilter").addEventListener("change", resetCompaniesPageAndRender);
document.getElementById("previousCompaniesPage").addEventListener("click", () => {
  currentCompaniesPage = Math.max(1, currentCompaniesPage - 1);
  renderCompanies();
});
document.getElementById("nextCompaniesPage").addEventListener("click", () => {
  currentCompaniesPage += 1;
  renderCompanies();
});
loadCompanies();
