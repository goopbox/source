import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const appOrigin = "http://127.0.0.1:8080";

test("boots and renders the editor", async ({ page }, testInfo) => {
  const errors = [];

  page.on("pageerror", (error) => errors.push(`page error: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === appOrigin) {
      errors.push(`request failed: ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (new URL(response.url()).origin === appOrigin && response.status() >= 400) {
      errors.push(`response ${response.status()}: ${response.url()}`);
    }
  });

  const response = await page.goto("/", { waitUntil: "networkidle" });
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle("GoopBox");
  await expect(page.locator("#app .app")).toBeVisible();
  await expect(page.locator(".playButton")).toBeVisible();
  await expect(page.locator(".pattern-area")).toBeVisible();
  await expect(page.locator(".track-area")).toBeVisible();
  const loadedFonts = await page.evaluate(async () => {
    const fonts = await document.fonts.load('16px "B612"');
    await document.fonts.ready;
    return fonts.map(({ family, status }) => ({
      family: family.replaceAll('"', ""),
      status,
    }));
  });
  expect(loadedFonts).toContainEqual({ family: "B612", status: "loaded" });
  expect(errors).toEqual([]);

  await mkdir(".artifacts", { recursive: true });
  await page.screenshot({
    path: `.artifacts/smoke-${testInfo.project.name}.png`,
    animations: "disabled",
    fullPage: true,
  });
});
