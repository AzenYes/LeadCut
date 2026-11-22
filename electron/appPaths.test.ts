import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const appMock = vi.hoisted(() => ({
	getPath: vi.fn((key: string) => key === "appData" ? "C:/Test/AppData" : "C:/Test/AppData/LeadCut"),
	setName: vi.fn(), setPath: vi.fn(),
}));
vi.mock("electron", () => ({ app: appMock }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.resetModules(); });

describe("independent edition data paths", () => {
	it("uses an explicit isolated profile for MCP native export", async () => {
		vi.stubEnv("LEADCUT_USER_DATA_DIR", "C:/Test/isolated-export");
		await import("./appPaths");
		const folder = path.resolve("C:/Test/isolated-export");
		expect(appMock.setPath).toHaveBeenCalledWith("userData", folder);
		expect(appMock.setPath).toHaveBeenCalledWith("sessionData", path.join(folder, "session"));
	});
	it("isolates packaged settings and recordings from official Recordly", async () => {
		vi.stubEnv("VITE_DEV_SERVER_URL", "");
		await import("./appPaths");
		const folder = path.join("C:/Test/AppData", "LeadCut");
		expect(appMock.setName).toHaveBeenCalledWith("LeadCut");
		expect(appMock.setPath).toHaveBeenCalledWith("userData", folder);
		expect(appMock.setPath).toHaveBeenCalledWith("sessionData", path.join(folder, "session"));
	});

	it("keeps development data separate from both installed editions", async () => {
		vi.stubEnv("VITE_DEV_SERVER_URL", "http://localhost:5173");
		await import("./appPaths");
		expect(appMock.setPath).toHaveBeenCalledWith("userData", path.join("C:/Test/AppData", "LeadCut-dev"));
	});
});
