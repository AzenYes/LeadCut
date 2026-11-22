import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppLogger, LAST_EXPORT_FAILURE_FILE } from "./logger";

vi.mock("./appPaths", () => ({ USER_DATA_PATH: os.tmpdir() }));

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-logger-")); });
afterEach(() => fs.rm(directory, { recursive: true, force: true }));

async function lines(file = "leadcut.log") {
	const raw = await fs.readFile(path.join(directory, file), "utf8");
	return raw.trim().split("\n").map(line => JSON.parse(line));
}

it("keeps error stacks and redacts both path separators in log details", async () => {
	const logger = createAppLogger(directory, { home: "C:/Users/Log Test" });
	logger.log("warn", "project", "Could not open C:/Users/Log Test/take", ["C:\\Users\\Log Test\\Projects"]);
	logger.log("error", "export", "Could not encode", new Error("Failed in C:/Users/Log Test/clip"));
	await logger.flush();
	const records = await lines();
	expect(records[0]).toMatchObject({ level: "warn", scope: "project", message: "Could not open ~/take" });
	expect(records[0].detail).toContain("~");
	expect(records[0].detail).not.toContain("Log Test");
	expect(records[1].detail).toMatch(/Error: Failed in ~\/clip[\s\S]+\bat\b/);
	expect((await lines(LAST_EXPORT_FAILURE_FILE))[0]).toMatchObject({ scope: "export", message: "Could not encode" });
});

it("rotates to three generations and does not delete the latest export error", async () => {
	const logger = createAppLogger(directory, { maxBytes: 235 });
	logger.log("error", "export", "Save failed");
	for (let index = 0; index < 12; index++) logger.log("info", "capture", `event-${index}`, "x".repeat(140));
	await logger.flush();
	expect((await fs.readdir(directory)).sort()).toEqual([LAST_EXPORT_FAILURE_FILE, "leadcut.log", "leadcut.log.1", "leadcut.log.2"]);
	expect((await lines())[0]).toMatchObject({ message: "event-11" });
	expect((await lines("leadcut.log.1"))[0]).toMatchObject({ message: "event-10" });
	expect((await lines(LAST_EXPORT_FAILURE_FILE))[0]).toMatchObject({ message: "Save failed" });
});

it("synchronously completes the active append and queued lines once", async () => {
	const logger = createAppLogger(directory);
	logger.log("info", "startup", "first");
	await Promise.resolve();
	logger.log("warn", "startup", "second");
	logger.flushSync();
	expect((await lines()).map(record => record.message)).toEqual(["first", "second"]);
	await logger.flush();
	logger.log("info", "startup", "third");
	await logger.flush();
	expect((await lines()).map(record => record.message)).toEqual(["first", "second", "third"]);
});

it("never throws if the log directory is unavailable", async () => {
	const blocked = path.join(directory, "file");
	await fs.writeFile(blocked, "not a directory");
	const logger = createAppLogger(blocked);
	expect(() => logger.log("error", "startup", "disk blocked")).not.toThrow();
	await expect(logger.flush()).resolves.toBeUndefined();
	logger.log("error", "startup", "still blocked");
	expect(() => logger.flushSync()).not.toThrow();
});
