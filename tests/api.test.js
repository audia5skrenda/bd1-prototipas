const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bd1-prototipas-test-"));

process.env.DATA_DIR = testDataDir;
process.env.EMAIL_HOST = "";
process.env.EMAIL_USER = "";
process.env.EMAIL_PASSWORD = "ivesk_slaptazodi_cia";
process.env.EMAIL_POLL_SECONDS = "60";

const { app, db, parseTemplateText, isValidWorkPayload } = require("../bd1-prototipas/server");

afterAll(() => {
  db.close();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

describe("Autentifikacija", () => {
  test("vartotojas prisijungia su teisingais duomenimis", async () => {
    const response = await request(app)
      .post("/login")
      .send({ name: "Admin", password: "admin" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      name: "Admin",
      role: "admin"
    });
    expect(response.body.password).toBeUndefined();
  });

  test("vartotojas neprisijungia su neteisingu slaptazodziu", async () => {
    const response = await request(app)
      .post("/login")
      .send({ name: "Admin", password: "neteisingas" });

    expect(response.status).toBe(401);
    expect(response.body.message).toContain("Neteisingas");
  });
});

describe("Imoniu valdymas", () => {
  test("administratorius sukuria imone", async () => {
    const response = await request(app)
      .post("/companies")
      .set("x-user-role", "admin")
      .send({
        name: "UAB Testine Imone",
        address: "Vilnius, Testu g. 1",
        phone: "+37060000000",
        email: "test@example.com"
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: "UAB Testine Imone",
      address: "Vilnius, Testu g. 1"
    });
  });

  test("paprastas vartotojas negali sukurti imones", async () => {
    const response = await request(app)
      .post("/companies")
      .set("x-user-role", "user")
      .send({
        name: "UAB Be Teisiu",
        address: "Kaunas"
      });

    expect(response.status).toBe(403);
  });

  test("grazinamas imoniu sarasas", async () => {
    const response = await request(app).get("/companies");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.some(company => company.name === "UAB Testine Imone")).toBe(true);
  });
});

describe("Planiniai darbai", () => {
  let companyId;
  let workId;

  beforeAll(async () => {
    const companiesResponse = await request(app).get("/companies");
    companyId = companiesResponse.body.find(company => company.name === "UAB Testine Imone").id;
  });

  test("sukuriamas planinis darbas", async () => {
    const response = await request(app)
      .post("/works")
      .send({
        companyId,
        date: "2026-05-10",
        time: "12:00-13:00",
        duration: "60 min",
        description: "Testiniai tinklo darbai",
        title: "Planiniai darbai"
      });

    expect(response.status).toBe(200);
    expect(response.body.id).toBeDefined();
    expect(response.body.company).toBe("UAB Testine Imone");
    expect(response.body.status).toBe("Naujas");

    workId = response.body.id;
  });

  test("grazinamas planiniu darbu sarasas", async () => {
    const response = await request(app).get("/works");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.some(work => work.id === workId)).toBe(true);
  });

  test("grazinama konkretaus planinio darbo informacija", async () => {
    const response = await request(app).get(`/works/${workId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: workId,
      date: "2026-05-10",
      time: "12:00-13:00"
    });
  });

  test("neegzistuojancio darbo siuntimas grazina klaida", async () => {
    const response = await request(app).post("/send-email/999999999");

    expect(response.status).toBe(404);
  });
});

describe("El. pasto apdorojimas", () => {
  test("is sabloninio teksto atpazistami planinio darbo duomenys", async () => {
    const text = [
      "Imones ID: 1",
      "Data: 2026-05-10",
      "Laikas: 12:00",
      "Trukme: 60 min",
      "Aprasymas: Testiniai darbai"
    ].join("\n");

    const parsed = parseTemplateText(text);

    expect(parsed.date).toBe("2026-05-10");
    expect(parsed.time).toBe("12:00-13:00");
    expect(parsed.description).toBe("Testiniai darbai");
  });

  test("nepilnas planinio darbo sablonas laikomas netinkamu", () => {
    const parsed = parseTemplateText("Aprasymas: Truksta datos ir imones");

    expect(isValidWorkPayload(parsed)).toBe(false);
  });

  test("el. laisku sarasas grazina konfiguracijos klaida, kai pastas nesukonfiguruotas", async () => {
    const response = await request(app).get("/emails?limit=1");

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Nepavyko gauti email");
  });

  test("el. laiskas gali buti atmestas", async () => {
    const response = await request(app).post("/reject-email/12345");

    expect(response.status).toBe(200);
    expect(response.body.message).toContain("atmestas");
  });
});
