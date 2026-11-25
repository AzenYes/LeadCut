import { describe, expect, it } from "vitest";
import { translateUiForLocale } from "../src/i18n/uiText";
import { EXPERIMENTAL_UPDATE_DESCRIPTION_KEY, getNewerStableRelease, getUpdateChannelConfiguration } from "./updateChannel";

describe("getUpdateChannelConfiguration", () => {
	it("keeps regular clients on stable metadata", () => {
		expect(getUpdateChannelConfiguration(false)).toEqual({
			channel: "latest",
			allowPrerelease: false,
			allowDowngrade: false,
		});
	});

	it("uses beta metadata only after the client opts in", () => {
		expect(getUpdateChannelConfiguration(true)).toEqual({
			channel: "beta",
			allowPrerelease: true,
			allowDowngrade: false,
		});
	});

	it("uses the approved experimental update description", () => {
		expect(translateUiForLocale("en", EXPERIMENTAL_UPDATE_DESCRIPTION_KEY)).toBe(
			"You've opted into experimental updates so you have the choice to test the latest update of LeadCut before it's widely available.",
		);
	});
});

describe("getNewerStableRelease", () => {
	it.each([
		["v0.1.10", "0.1.2", "0.1.10"],
		["v0.1.2", "0.1.2-rc.1", "0.1.2"],
		["v0.1.2", "0.1.2+build.1", null],
		["v0.1.2", "0.1.3", null],
	])("compares published %s with installed %s", (tag, current, expected) => {
		expect(getNewerStableRelease(tag, current)).toBe(expected);
	});

	it("rejects missing or non-stable release tags", () => {
		expect(() => getNewerStableRelease(undefined, "0.1.2")).toThrow();
		expect(() => getNewerStableRelease("v0.1.3-rc.1", "0.1.2")).toThrow();
	});
});
