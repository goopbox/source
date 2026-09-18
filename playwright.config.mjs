import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "browser-smoke.spec.mjs",
  workers: 1,
  outputDir: ".artifacts/playwright",
  reporter: "line",
  timeout: 15_000,
  expect: { timeout: 5000 },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  use: {
    baseURL: "http://127.0.0.1:8080",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
