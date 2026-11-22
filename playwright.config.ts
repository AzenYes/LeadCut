import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./tests/ui",
	workers: process.platform === "win32" ? 2 : undefined,
	timeout: 30000,
	use: {
		baseURL: "http://127.0.0.1:5178",
		viewport: { width: 1440, height: 1000 },
		trace: "retain-on-failure",
	},
	webServer: {
		env: { LEADCUT_RENDERER_ONLY: "1" },
		command: "npx vite --host 127.0.0.1 --port 5178 --strictPort",
		url: "http://127.0.0.1:5178",
		reuseExistingServer: !process.env.CI,
	},
});
