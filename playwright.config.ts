import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

// Load e2e/.env.e2e (git-ignored) into process.env so credentials never go on the
// command line or into shell history. Real env vars still win.
const envFile = "e2e/.env.e2e";
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const baseURL = process.env.E2E_BASE_URL ?? "https://daledger-dev.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  // Tests mutate one shared live backend, so run them one at a time and let each
  // assert on a *delta* (read a balance, act, re-read). No parallelism.
  fullyParallel: false,
  workers: 1,
  retries: 2, // live app on a free tier: absorb cold-start / network flakes
  timeout: 90_000,
  expect: { timeout: 15_000 }, // live network + Convex live queries
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    navigationTimeout: 60_000, // a cold Vercel + Convex start can be slow
    actionTimeout: 20_000,
    ...devices["Pixel 7"], // phone-first, like the real users
  },
  projects: [
    // Logs in once and saves the session; every other test reuses it.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { storageState: "e2e/.auth/officer.json" },
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
