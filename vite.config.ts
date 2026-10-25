import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    // Playwright writes its report/screenshots into the repo during a run; without
    // this, vite's HMR reloads the page mid-test and E2E runs flake (cascading
    // timeouts as each failure writes a screenshot → reload → more failures).
    watch: { ignored: ["**/playwright-report/**", "**/test-results/**", "**/e2e/.auth/**"] },
  },
});
