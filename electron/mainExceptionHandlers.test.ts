import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppLogger } from "./logger";
import { createMainExceptionHandlers } from "./mainExceptionHandlers";

vi.mock("./appPaths", () => ({ USER_DATA_PATH: os.tmpdir() }));

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-main-errors-")); });
afterEach(() => fs.rm(directory, { recursive: true, force: true }));

it("persists exceptions and rejections with stack traces before opening one error dialog", async () => {
	const logger = createAppLogger(directory);
	const notify = vi.fn(async () => {});
	const handlers = createMainExceptionHandlers({ log: logger.log, flush: logger.flushSync, notify });
	handlers.onUncaughtException(new Error("native first"));
	handlers.onUncaughtException(new Error("native second"));
	handlers.onUnhandledRejection(new Error("promise failed"));

	const log = await fs.readFile(path.join(directory, "leadcut.log"), "utf8");
	const records = log.trim().split("\n").map(line => JSON.parse(line));
	expect(records).toHaveLength(3);
	expect(records[0]).toMatchObject({ scope: "main-exception", message: "Uncaught main-process exception (uncaughtException)." });
	expect(records[0].detail).toMatch(/Error: native first[\s\S]+\bat\b/);
	expect(records[1].detail).toMatch(/Error: native second[\s\S]+\bat\b/);
	expect(records[2]).toMatchObject({ scope: "main-exception", message: "Unhandled main-process rejection." });
	expect(records[2].detail).toMatch(/Error: promise failed[\s\S]+\bat\b/);
	expect(notify).toHaveBeenCalledTimes(1);
});
