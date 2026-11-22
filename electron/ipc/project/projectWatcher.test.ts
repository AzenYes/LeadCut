import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { computeProjectRevision } from "./projectRevision";
import { checkProjectWatcherNow, startProjectWatcher, stopProjectWatcher } from "./projectWatcher";

let directory: string;
let project: string;
const initial = '{"revision":"initial"}';
const edited = '{"revision":"edited"}';

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-project-watch-"));
	project = path.join(directory, "watch.recordly");
	await fs.writeFile(project, initial);
});

afterEach(async () => {
	stopProjectWatcher();
	await fs.rm(directory, { recursive: true, force: true });
});

it("reports an external edit once even after another focus check", async () => {
	const changed = vi.fn();
	startProjectWatcher(project, () => computeProjectRevision(initial), changed);
	await fs.writeFile(project, edited);
	await vi.waitFor(() => expect(changed).toHaveBeenCalledWith({
		path: project, diskRevision: computeProjectRevision(edited),
	}), { timeout: 2000 });
	await checkProjectWatcherNow();
	expect(changed).toHaveBeenCalledOnce();
});

it("ignores writes of the generation already loaded by the editor", async () => {
	const changed = vi.fn();
	let revision = computeProjectRevision(initial);
	startProjectWatcher(project, () => revision, changed);
	revision = computeProjectRevision(edited);
	await fs.writeFile(project, edited);
	await setTimeout(500);
	await checkProjectWatcherNow();
	expect(changed).not.toHaveBeenCalled();
});

it("sees writes made through atomic replacement", async () => {
	const changed = vi.fn();
	startProjectWatcher(project, () => computeProjectRevision(initial), changed);
	const temporary = path.join(directory, "external.tmp");
	await fs.writeFile(temporary, edited);
	await fs.rename(temporary, project);
	await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce(), { timeout: 2000 });
	expect(changed).toHaveBeenCalledWith({ path: project, diskRevision: computeProjectRevision(edited) });
});

it("drops pending events when the project is released", async () => {
	const changed = vi.fn();
	startProjectWatcher(project, () => computeProjectRevision(initial), changed);
	await fs.writeFile(project, edited);
	stopProjectWatcher();
	await setTimeout(500);
	expect(changed).not.toHaveBeenCalled();
});
