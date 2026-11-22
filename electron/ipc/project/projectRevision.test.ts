import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { computeProjectRevision } from "./projectRevision";

it("matches the MCP SHA-256 revision for the original project file text", () => {
	const text = '\uFEFF{ "label": "阿真" }\r\n';
	expect(computeProjectRevision(text)).toBe(createHash("sha256").update(text).digest("hex"));
	expect(computeProjectRevision(text.trim())).not.toBe(computeProjectRevision(text));
});
