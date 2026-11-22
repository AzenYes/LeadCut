import { expect, it } from "vitest";
import { scrubberTimeAtPosition } from "./previewScrubberTime";

it("maps the track to sequence time and clamps at both endpoints", () => {
	expect(scrubberTimeAtPosition(150, 300, 90)).toBe(45);
	expect(scrubberTimeAtPosition(-5, 300, 90)).toBe(0);
	expect(scrubberTimeAtPosition(310, 300, 90)).toBe(90);
	expect(scrubberTimeAtPosition(150, 0, 90)).toBe(0);
});
