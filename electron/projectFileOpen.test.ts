import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createProjectOpenQueue, projectPathsFromCommandLine } from "./projectFileOpen";

describe("shell project paths", () => {
	it("preserves Chinese paths and spaces, ignores switches, resolves the launching directory", () => {
		const cwd = path.resolve("测试 工程");
		expect(projectPathsFromCommandLine([
			"LeadCut.exe", "--debug", "讲解 动画.RECORDLY", "--log=wrong.recordly", "a.mp4",
			"讲解 动画.RECORDLY", "另一个.recordly",
		], cwd)).toEqual([path.join(cwd, "讲解 动画.RECORDLY"), path.join(cwd, "另一个.recordly")]);
	});
	it("accepts an absolute path without rebasing it", () => {
		const file = path.resolve("项目 文件.recordly");
		expect(projectPathsFromCommandLine(["electron.exe", ".", file], path.resolve("elsewhere"))).toEqual([file]);
	});
	it("accepts all supported project extensions in one launch", () => {
		const cwd = path.resolve("工程");
		const files = ["new.leadcut", "old.RECORDLY", "earliest.openscreen"];
		expect(projectPathsFromCommandLine(["LeadCut.exe", ...files], cwd)).toEqual(
			files.map(file => path.resolve(cwd, file)),
		);
	});
});

describe("external project delivery", () => {
	it("holds a cold launch until hydration and sends warm requests in order", () => {
		const deliver = vi.fn();
		const queue = createProjectOpenQueue(deliver);
		queue.enqueue(["first.recordly"]);
		expect(deliver).not.toHaveBeenCalled();
		queue.ready(42);
		expect(deliver).toHaveBeenLastCalledWith(42, { id: 1, path: "first.recordly" });
		queue.enqueue(["second.recordly", "second.recordly"]);
		expect(deliver).toHaveBeenCalledTimes(1);
		queue.complete(9, 1);
		queue.complete(42, 99);
		expect(deliver).toHaveBeenCalledTimes(1);
		queue.complete(42, 1);
		expect(deliver).toHaveBeenLastCalledWith(42, { id: 2, path: "second.recordly" });
		queue.complete(42, 2);
		expect(queue.hasPending).toBe(false);
		queue.enqueue(["third.recordly"]);
		expect(deliver).toHaveBeenLastCalledWith(42, { id: 3, path: "third.recordly" });
	});
	it("redelivers an interrupted request after editor recreation and ignores stale acknowledgments", () => {
		const deliver = vi.fn();
		const queue = createProjectOpenQueue(deliver);
		queue.ready(1);
		queue.enqueue(["first.recordly", "second.recordly"]);
		queue.detach(99);
		queue.detach(1);
		queue.complete(1, 1);
		expect(deliver).toHaveBeenCalledTimes(1);
		queue.ready(2);
		expect(deliver).toHaveBeenLastCalledWith(2, { id: 2, path: "first.recordly" });
		queue.complete(1, 1);
		expect(deliver).toHaveBeenCalledTimes(2);
		queue.complete(2, 2);
		expect(deliver).toHaveBeenLastCalledWith(2, { id: 3, path: "second.recordly" });
	});
});
