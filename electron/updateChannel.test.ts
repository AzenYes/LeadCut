import { describe, expect, it } from "vitest";
import { translateUiForLocale } from "../src/i18n/uiText";
import { EXPERIMENTAL_UPDATE_DESCRIPTION_KEY, getUpdateChannelConfiguration } from "./updateChannel";

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
