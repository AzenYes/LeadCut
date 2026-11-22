import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { editorLockPath } from "./editorLock";
import { trashLibraryProjects } from "./trashProjects";
it("rejects paths outside the project library before touching files", async () => {
	const trash = vi.fn();
	await expect(
		trashLibraryProjects(["/private/tmp/a.leadcut", "/private/tmp/private.txt"], {
			list: async () => ({ entries: [{ path: "/private/tmp/a.leadcut" }] }),
			trash,
			thumbnailPath: (p) => p + ".png",
		}),
	).rejects.toThrow("not in the library");
	expect(trash).not.toHaveBeenCalled();
});

it("includes an editor lock among the project's sidecars sent to the trash", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-project-trash-"));
	const project = path.join(directory, "demo.leadcut");
	const mark = editorLockPath(project);
	try {
		await fs.writeFile(project, "project");
		await fs.writeFile(mark, "lock marker");
		const trash = vi.fn(async (file: string) => fs.unlink(file));
		await expect(trashLibraryProjects([project], {
			list: async () => ({ entries: [{ path: project }] }),
			trash,
			thumbnailPath: file => `${file}.png`,
		})).resolves.toEqual({ deleted: [project], errors: [] });
		expect(trash.mock.calls.map(([file]) => file)).toEqual([project, mark]);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});
it("trashes only selected project files, deduplicates paths, and reports partial failures", async () => {
	const trash = vi.fn(async (p: string) => {
		if (p.endsWith("b.leadcut")) throw Error("locked");
	});
	const result = await trashLibraryProjects(
		["/private/tmp/a.leadcut", "/private/tmp/a.leadcut", "/private/tmp/b.leadcut"],
		{
			list: async () => ({
				entries: [{ path: "/private/tmp/a.leadcut" }, { path: "/private/tmp/b.leadcut" }],
			}),
			trash,
			thumbnailPath: (p) => p + ".missing.png",
		},
	);
	expect(result.deleted).toEqual([path.resolve("/private/tmp/a.leadcut")]);
	expect(result.errors).toEqual(["Could not trash b.leadcut"]);
	expect(trash.mock.calls.map(([p]) => p)).toEqual([
		path.resolve("/private/tmp/a.leadcut"),
		path.resolve("/private/tmp/b.leadcut"),
	]);
});
