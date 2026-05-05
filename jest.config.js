module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/tests/**/*.test.js"],
  reporters: [
    "default",
    [
      "jest-html-reporters",
      {
        publicPath: "./test-results",
        filename: "test-report.html",
        pageTitle: "Planiniu darbu sistemos testavimo ataskaita"
      }
    ]
  ]
};
