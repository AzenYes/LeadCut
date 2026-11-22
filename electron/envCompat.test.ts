import { afterEach, expect, it, vi } from "vitest";
import { readAppEnv } from "./envCompat";

afterEach(() => vi.restoreAllMocks());

it("prefers the current environment variable, including explicitly empty values", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	expect(readAppEnv("CHECK_PREFERRED", { LEADCUT_CHECK_PREFERRED: "", RECORDLY_CHECK_PREFERRED: "old" })).toBe("");
	expect(warn).not.toHaveBeenCalled();
});

it("reads a legacy value and warns once per variable", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	const env = { RECORDLY_CHECK_LEGACY: "old" };
	expect(readAppEnv("CHECK_LEGACY", env)).toBe("old");
	expect(readAppEnv("CHECK_LEGACY", env)).toBe("old");
	expect(warn).toHaveBeenCalledExactlyOnceWith("[LeadCut] RECORDLY_CHECK_LEGACY is deprecated. Use LEADCUT_CHECK_LEGACY.");
});

it("leaves unset variables undefined", () => {
	expect(readAppEnv("CHECK_UNSET", {})).toBeUndefined();
});
