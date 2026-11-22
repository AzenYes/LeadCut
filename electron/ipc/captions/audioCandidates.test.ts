import { expect, it } from "vitest";
import { getCaptionCompanionAudioCandidates } from "./audioCandidates";

it("keeps audio candidate identifiers stable for microphone delay and source merging", () => {
	const candidates = getCaptionCompanionAudioCandidates([
		{ micPath: "/mic.wav", systemPath: "/system.wav", usablePaths: ["/mic.wav", "/system.wav"] },
	] as Parameters<typeof getCaptionCompanionAudioCandidates>[0]);
	expect(candidates).toEqual([
		{ path: "/mic.wav", label: "microphone audio sidecar" },
		{ path: "/system.wav", label: "system audio sidecar" },
	]);
});
