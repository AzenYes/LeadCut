import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ file: "", write: vi.fn() }));
vi.mock("./ipc/utils", () => ({ parseJsonWithByteOrderMark: JSON.parse }));
vi.mock("./logger", () => ({ appLog: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
	const module = await importOriginal<typeof import("node:fs/promises")>();
	return { ...module, default: { ...module.default, writeFile: fixture.write } };
});

let directory: string;
let store: typeof import("./appSettingsStore");
let writeFile: typeof fs.writeFile;
const diskSettings = () => JSON.parse(readFileSync(fixture.file, "utf8"));

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-app-settings-test-"));
	fixture.file = path.join(directory, "app-settings.json");
	writeFile = (await vi.importActual<typeof fs>("node:fs/promises")).writeFile;
	fixture.write.mockReset().mockImplementation(writeFile);
	vi.resetModules();
	vi.doMock("./ipc/constants", () => ({ APP_SETTINGS_FILE: fixture.file }));
	vi.useFakeTimers();
	store = await import("./appSettingsStore");
});

afterEach(async () => {
	store.flushAppSettingsSync();
	vi.useRealTimers();
	await fs.rm(directory, { recursive: true, force: true, maxRetries: 4 });
});

it("reads lazily, merges ten updates into one staged disk write, and reads the latest value immediately", async () => {
	writeFileSync(fixture.file, '{"untouched":true}');
	for (let i = 1; i <= 10; i++) store.writeAppSetting("slider", i);
	expect(store.readAppSetting("slider")).toBe(10);
	expect(diskSettings()).toEqual({ untouched: true });
	await vi.advanceTimersByTimeAsync(299);
	expect(fixture.write).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(1);
	await vi.waitFor(() => expect(diskSettings()).toEqual({ untouched: true, slider: 10 }));
	expect(fixture.write).toHaveBeenCalledTimes(1);
	expect(fixture.write.mock.calls[0][0]).toMatch(/app-settings\.json\..+\.tmp$/);
	expect(readdirSync(directory)).toEqual(["app-settings.json"]);
});

it("flushes the latest setting for a regular quit or an important change", () => {
	store.writeAppSetting("slider", 42);
	store.flushAppSettingsSync();
	expect(diskSettings()).toEqual({ slider: 42 });
	store.writeAppSetting("preset", "standard", { flush: true });
	expect(diskSettings()).toEqual({ slider: 42, preset: "standard" });
	expect(fixture.write).not.toHaveBeenCalled();
});

it("never lets a staged delayed write replace an immediate flush", async () => {
	let allowWrite!: () => void;
	fixture.write.mockImplementationOnce(async (...args: Parameters<typeof writeFile>) => {
		await new Promise<void>(resolve => { allowWrite = resolve; });
		await writeFile(...args);
	});
	store.writeAppSetting("slider", 1);
	await vi.advanceTimersByTimeAsync(300);
	store.writeAppSetting("slider", 2, { flush: true });
	const stagedPath = fixture.write.mock.calls[0][0];
	const stageRan = fixture.write.mock.results[0].value as Promise<void>;
	allowWrite();
	await stageRan;
	await vi.waitFor(() => expect(existsSync(stagedPath)).toBe(false));
	expect(diskSettings()).toEqual({ slider: 2 });
});

it("keeps damaged JSON in a dated archive and writes new settings independently", () => {
	const damaged = '{"truncated":';
	writeFileSync(fixture.file, damaged);
	expect(store.readAppSetting("truncated")).toBeNull();
	const archive = readdirSync(directory).find(name => name.startsWith("app-settings.损坏-"));
	expect(archive).toBeDefined();
	const archivePath = path.join(directory, archive!);
	expect(readFileSync(archivePath, "utf8")).toBe(damaged);
	store.writeAppSetting("new", true, { flush: true });
	expect(diskSettings()).toEqual({ new: true });
	expect(readFileSync(archivePath, "utf8")).toBe(damaged);
});

it("migrates legacy keys once without replacing explicit null or false values", () => {
	const legacy = { "recordly.onboarding.v1.seen": false, "recordly.theme": "dark", "leadcut.theme": null };
	writeFileSync(fixture.file, JSON.stringify(legacy));
	store.migrateLegacyAppSettingKeys();
	expect(diskSettings()).toEqual({ ...legacy, "leadcut.onboarding.v1.seen": false });
	writeFileSync(fixture.file, "{}");
	store.migrateLegacyAppSettingKeys();
	expect(store.readAppSetting("leadcut.onboarding.v1.seen")).toBe(false);
	expect(diskSettings()).toEqual({});
});
