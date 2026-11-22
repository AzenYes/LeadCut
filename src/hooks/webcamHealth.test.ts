import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchWebcamTrack } from "./webcamHealth";

describe("webcam source health", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("reports a disconnected device immediately", () => {
		const track = new EventTarget() as MediaStreamTrack;
		const interrupted = vi.fn();
		const dispose = watchWebcamTrack(track, interrupted);
		track.dispatchEvent(new Event("ended"));
		expect(interrupted).toHaveBeenCalledOnce();
		dispose();
	});

	it("tolerates brief mute events but reports persistent loss of frames", () => {
		const track = new EventTarget() as MediaStreamTrack;
		const interrupted = vi.fn();
		const dispose = watchWebcamTrack(track, interrupted);
		track.dispatchEvent(new Event("mute"));
		vi.advanceTimersByTime(4000);
		track.dispatchEvent(new Event("unmute"));
		vi.advanceTimersByTime(5000);
		expect(interrupted).not.toHaveBeenCalled();
		track.dispatchEvent(new Event("mute"));
		vi.advanceTimersByTime(5000);
		expect(interrupted).toHaveBeenCalledOnce();
		dispose();
	});

	it("removes pending warnings and listeners when recording stops normally", () => {
		const track = new EventTarget() as MediaStreamTrack;
		const interrupted = vi.fn();
		const dispose = watchWebcamTrack(track, interrupted);
		track.dispatchEvent(new Event("mute"));
		dispose();
		vi.advanceTimersByTime(6000);
		track.dispatchEvent(new Event("ended"));
		expect(interrupted).not.toHaveBeenCalled();
	});
});
