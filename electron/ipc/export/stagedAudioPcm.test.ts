import { describe, expect, it } from "vitest";
import { getStagedAudioPcmWindow } from "./stagedAudioPcm";

describe("PCM staging windows", () => {
	it("selects decoded samples without seeking on packet timestamps", () => {
		expect(getStagedAudioPcmWindow({ startSec: 120.001, endSec: 151.002 }, 48_000, 600)).toEqual({
			firstFrame: 5_760_048,
			endFrame: 7_248_096,
			filter: "atrim=start_sample=5760048:end_sample=7248096",
		});
	});

	it("preserves decoded padding when the selected range reaches the end", () => {
		expect(getStagedAudioPcmWindow({ startSec: 540, endSec: 601 }, 48_000, 600)?.filter)
			.toBe("atrim=start_sample=25920000");
	});

	it("keeps full staging when nearly all of the source is in use or the bounds are invalid", () => {
		expect(getStagedAudioPcmWindow({ startSec: 2, endSec: 598 }, 48_000, 600)).toBeNull();
		expect(getStagedAudioPcmWindow({ startSec: -1, endSec: 3 }, 48_000, 600)).toBeNull();
		expect(getStagedAudioPcmWindow({ startSec: 32, endSec: Infinity }, 48_000, 600)).toBeNull();
	});
});
