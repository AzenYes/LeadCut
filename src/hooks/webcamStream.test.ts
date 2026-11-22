import { describe, expect, it, vi } from "vitest";
import { createWebcamStreamPool } from "./webcamStream";

function mockStream() {
	const track = {
		readyState: "live",
		stop: vi.fn(() => {
			track.readyState = "ended";
		}),
	};
	const clones: ReturnType<typeof mockStream>[] = [];
	const stream = {
		getTracks: () => [track],
		getVideoTracks: () => [track],
		clone: () => {
			const clone = mockStream();
			clones.push(clone);
			return clone.stream;
		},
	} as unknown as MediaStream;
	return { stream, track, clones };
}

describe("shared webcam capture", () => {
	it("opens the device once for concurrent preview and recording requests", async () => {
		const source = mockStream();
		let resolve!: (stream: MediaStream) => void;
		const getUserMedia = vi.fn(
			() =>
				new Promise<MediaStream>((r) => {
					resolve = r;
				}),
		);
		const acquire = createWebcamStreamPool(getUserMedia);
		const previewPending = acquire("camera");
		const recordingPending = acquire("camera");
		expect(getUserMedia).toHaveBeenCalledTimes(1);
		resolve(source.stream);
		const [preview, recording] = await Promise.all([previewPending, recordingPending]);
		expect(preview.stream).not.toBe(recording.stream);
		preview.release();
		expect(source.track.stop).not.toHaveBeenCalled();
		expect(recording.stream.getVideoTracks()[0].readyState).toBe("live");
		preview.release();
		recording.release();
		expect(source.track.stop).toHaveBeenCalledTimes(1);
		expect(source.clones.every((clone) => clone.track.readyState === "ended")).toBe(true);
	});

	it("keeps recording alive when the preview is hidden and shown again", async () => {
		const source = mockStream();
		const getUserMedia = vi.fn(async () => source.stream);
		const acquire = createWebcamStreamPool(getUserMedia);
		const preview = await acquire("camera");
		const recording = await acquire("camera");
		preview.release();
		const nextPreview = await acquire("camera");
		expect(getUserMedia).toHaveBeenCalledTimes(1);
		recording.release();
		expect(nextPreview.stream.getVideoTracks()[0].readyState).toBe("live");
		nextPreview.release();
		expect(source.track.stop).toHaveBeenCalledTimes(1);
	});

	it("reopens after all consumers release and retries a failed acquisition", async () => {
		const getUserMedia = vi
			.fn()
			.mockRejectedValueOnce(new Error("Device busy"))
			.mockImplementation(async () => mockStream().stream);
		const acquire = createWebcamStreamPool(getUserMedia);
		await expect(acquire("camera")).rejects.toThrow("Device busy");
		const first = await acquire("camera");
		first.release();
		const next = await acquire("camera");
		expect(next.stream).not.toBe(first.stream);
		expect(getUserMedia).toHaveBeenCalledTimes(3);
		next.release();
	});

	it("rejects ended sources instead of returning a dead recording track", async () => {
		const source = mockStream();
		const getUserMedia = vi.fn(async () => source.stream);
		const acquire = createWebcamStreamPool(getUserMedia);
		const preview = await acquire("camera");
		source.track.readyState = "ended";
		await expect(acquire("camera")).rejects.toThrow("video source has ended");
		preview.release();
		getUserMedia.mockImplementation(async () => mockStream().stream);
		const recording = await acquire("camera");
		expect(recording.stream.getVideoTracks()[0].readyState).toBe("live");
		recording.release();
	});
});
