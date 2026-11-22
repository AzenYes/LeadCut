import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDiagnosticsBundle, latestRecordingDiagnostics } from "./diagnosticsBundle";
import { LAST_EXPORT_FAILURE_FILE } from "./logger";

vi.mock("electron", () => ({ app: {}, dialog: {}, screen: {}, shell: {} }));
vi.mock("./appPaths", () => ({ USER_DATA_PATH: os.tmpdir() }));
vi.mock("./ipc/utils", () => ({ getRecordingsDir: vi.fn() }));
vi.mock("./uiI18n", () => ({ uiText: (key: string) => key }));

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-diagnostics-")); });
afterEach(() => fs.rm(directory, { recursive: true, force: true }));

it("collects rolling logs, environment, the latest recording diagnostics and the last export failure", async () => {
	const logs = path.join(directory, "logs");
	const recordings = path.join(directory, "Recordings");
	const older = path.join(recordings, "older.recording-diagnostics.json");
	const current = path.join(recordings, "current.recording-diagnostics.json");
	await fs.mkdir(path.join(logs, "native"), { recursive: true });
	await fs.mkdir(recordings);
	await fs.writeFile(path.join(logs, "leadcut.log"), `Opened ${os.homedir()}/take.mp4`);
	await fs.writeFile(path.join(logs, "leadcut.log.1"), "prior log");
	await fs.writeFile(path.join(logs, "native", "helper.log"), "helper log");
	await fs.writeFile(path.join(logs, LAST_EXPORT_FAILURE_FILE), '{"message":"cannot encode"}');
	await fs.writeFile(path.join(directory, "updater.log"), "update checked");
	await fs.writeFile(older, '{"status":"older"}');
	await fs.utimes(older, new Date(0), new Date(0));
	await fs.writeFile(current, '{"status":"current"}');
	await fs.writeFile(path.join(recordings, "private-caption.txt"), "excluded");
	const latest = await latestRecordingDiagnostics(recordings);
	expect(latest).toBe(current);

	const environment = { version: "1.0.0", gpu: { active: true }, displays: [{ id: 7 }] };
	const bundle = await createDiagnosticsBundle({
		userDataPath: directory, destinationDirectory: directory, environment, recordingDiagnosticsPath: latest,
	});
	expect(path.basename(bundle)).toMatch(/^LeadCut-诊断-/);
	expect((await fs.readdir(bundle)).sort()).toEqual(
		["current.recording-diagnostics.json", LAST_EXPORT_FAILURE_FILE, "logs", "updater.log", "环境.json"].sort(),
	);
	await expect(fs.readFile(path.join(bundle, "logs", "leadcut.log"), "utf8")).resolves.toBe("Opened ~/take.mp4");
	await expect(fs.readFile(path.join(bundle, "logs", "native", "helper.log"), "utf8")).resolves.toBe("helper log");
	await expect(fs.readFile(path.join(bundle, LAST_EXPORT_FAILURE_FILE), "utf8")).resolves.toBe('{"message":"cannot encode"}');
	expect(JSON.parse(await fs.readFile(path.join(bundle, "环境.json"), "utf8"))).toEqual(environment);
});

it("avoids overwriting existing output and works with absent log or recording folders", async () => {
	const now = new Date("2026-11-19T08:00:00.000Z");
	const args = { now, userDataPath: directory, destinationDirectory: directory, environment: {} };
	expect(await latestRecordingDiagnostics(path.join(directory, "not-mounted"))).toBeNull();
	const first = await createDiagnosticsBundle(args);
	const second = await createDiagnosticsBundle(args);
	expect(second).toBe(`${first}-2`);
	await expect(fs.readdir(path.join(second, "logs"))).resolves.toEqual([]);
});

it("excludes its output from the collection when the destination is inside the logs", async () => {
	const logs = path.join(directory, "logs");
	const destinationDirectory = path.join(logs, "output");
	await fs.mkdir(destinationDirectory, { recursive: true });
	const bundle = await createDiagnosticsBundle({ userDataPath: directory, destinationDirectory, environment: {} });
	await expect(fs.readdir(path.join(bundle, "logs", "output"))).resolves.toEqual([]);
});
