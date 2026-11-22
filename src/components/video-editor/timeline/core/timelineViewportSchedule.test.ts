import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleTimelineViewportUpdate, setTimelinePreviewVideo } from "./timelineViewportSchedule";

describe("timeline viewport scheduling", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function setup(paused = false) {
		let frameCallback: VideoFrameRequestCallback | undefined;
		const owner = {
			requestAnimationFrame: vi.fn(() => 1),
			cancelAnimationFrame: vi.fn(),
			setTimeout,
			clearTimeout,
		};
		const video = {
			paused,
			seeking: false,
			requestVideoFrameCallback: vi.fn((callback: VideoFrameRequestCallback) => {
				frameCallback = callback;
				return 2;
			}),
			cancelVideoFrameCallback: vi.fn(),
		};
		const window = owner as unknown as Window;
		setTimelinePreviewVideo(window, video as unknown as HTMLVideoElement);
		return {
			window,
			owner,
			video,
			present: () => frameCallback?.(0, {} as VideoFrameCallbackMetadata),
		};
	}

	it("runs a playing viewport update after the video-frame callback and cancels the deadline", () => {
		const { window, video, present } = setup();
		const update = vi.fn();
		scheduleTimelineViewportUpdate(window, update);
		present();
		expect(update).not.toHaveBeenCalled();
		vi.advanceTimersByTime(50);
		expect(update).toHaveBeenCalledOnce();
		expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(2);
	});

	it("updates at the deadline if the video does not deliver a frame", () => {
		const { window, video } = setup();
		const update = vi.fn();
		scheduleTimelineViewportUpdate(window, update);
		vi.runAllTimers();
		expect(update).toHaveBeenCalledOnce();
		expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(2);
	});

	it("cancels pending work when the viewport is disposed", () => {
		const { window, owner, present } = setup();
		const update = vi.fn();
		const cancel = scheduleTimelineViewportUpdate(window, update);
		present();
		cancel();
		vi.runAllTimers();
		expect(update).not.toHaveBeenCalled();

		setTimelinePreviewVideo(window, null);
		scheduleTimelineViewportUpdate(window, update)();
		expect(owner.cancelAnimationFrame).toHaveBeenCalledWith(1);
	});
});
