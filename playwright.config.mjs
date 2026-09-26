import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:4173",
    launchOptions: process.env.GK_CHROMIUM
      ? { executablePath: process.env.GK_CHROMIUM }
      : {},
  },
  webServer: {
    command: "python3 -m http.server 4173 --directory dist/browser",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
