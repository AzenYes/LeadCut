import { expect, it } from "vitest";
import { getProjectMediaReferences, relinkProjectMedia } from "./projectRelink";

it("relinks all media kinds and every use of a path while preserving unrelated settings", () => {
	const project = {
		videoPath: "/old/screen.mp4",
		editor: {
			webcam: { enabled: true, sourcePath: "/old/camera.mp4", timeOffsetMs: 120 },
			audioRegions: [
				{ id: "voice", audioPath: "/old/voice.wav" },
				{ id: "voice-again", audioPath: "/old/voice.wav" },
				{ id: "music", audioPath: "/present/music.mp3" },
			],
			videoRegions: [{ id: "broll", sourcePath: "/old/intro.mp4" }],
		},
	};
	const reconnected = relinkProjectMedia(project, {
		"/old/screen.mp4": "/new/screen.mp4",
		"/old/camera.mp4": "/new/camera.mp4",
		"/old/voice.wav": "/new/voice.wav",
		"/old/intro.mp4": "/new/intro.mp4",
	});
	expect(getProjectMediaReferences(reconnected).map(({ kind, path }) => [kind, path])).toEqual([
		["video", "/new/screen.mp4"], ["webcam", "/new/camera.mp4"],
		["audio", "/new/voice.wav"], ["audio", "/new/voice.wav"],
		["audio", "/present/music.mp3"], ["broll", "/new/intro.mp4"],
	]);
	expect(reconnected.editor.webcam.timeOffsetMs).toBe(120);
	expect(project.videoPath).toBe("/old/screen.mp4");
	const skipped = relinkProjectMedia(reconnected, { "/new/camera.mp4": null, "/new/voice.wav": null });
	expect(skipped.editor.webcam).toEqual({ enabled: false, sourcePath: null, timeOffsetMs: 120 });
	expect(skipped.editor.audioRegions).toEqual([{ id: "music", audioPath: "/present/music.mp3" }]);
});
