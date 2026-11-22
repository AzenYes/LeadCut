import { describe, expect, it } from "vitest";
import { advanceDiscardConfirmation } from "./discardConfirm";

describe("discard recording confirmation", () => {
	it("arms on the first press without discarding the recording", () => {
		expect(advanceDiscardConfirmation(null, 1000)).toEqual({
			shouldDiscard: false,
			deadlineMs: 4000,
		});
	});

	it("discards on the second press inside the confirmation window", () => {
		expect(advanceDiscardConfirmation(4000, 3999)).toEqual({
			shouldDiscard: true,
			deadlineMs: null,
		});
	});

	it("starts a new confirmation window once the previous one expires", () => {
		expect(advanceDiscardConfirmation(4000, 4000)).toEqual({
			shouldDiscard: false,
			deadlineMs: 7000,
		});
	});
});
