import { afterEach, describe, expect, it, vi } from "vitest";
import { useAudioPreviewSync } from "./useAudioPreviewSync";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";

const harness = vi.hoisted(() => ({
	effects: [] as (() => void | (() => void))[],
	refs: [] as { current: unknown }[],
	index: 0,
	loaded: vi.fn(),
}));
vi.mock("react", () => ({
	useCallback: (callback: unknown) => callback,
	useMemo: (factory: () => unknown) => factory(),
	useEffect: (effect: () => void) => harness.effects.push(effect),
	useRef: (value: unknown) => {
		const index = harness.index++;
		harness.refs[index] ??= { current: value };
		return harness.refs[index];
	},
	useState: () => [0, harness.loaded],
}));
vi.mock("@/lib/exporter/localMediaSource", () => ({
	resolveMediaElementSource: vi.fn(async () => ({ src: "file:///audio.wav", revoke: vi.fn() })),
}));

afterEach(() => {
	vi.unstubAllGlobals();
	harness.effects = [];
	harness.refs = [];
	harness.index = 0;
	harness.loaded.mockClear();
});

it("finishes an authored audio load when source discovery rerenders the same track", async () => {
	const audio = { src: "", volume: 1, paused: true, pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined) };
	vi.stubGlobal("Audio", function () { return audio; });
	let finish!: (value: { src: string; revoke: () => void }) => void;
	vi.mocked(resolveMediaElementSource).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
	const input = {
		audioRegions: [{ id: "showcase", audioPath: "/showcase.m4a", startMs: 9650, endMs: 142027, volume: 1 }],
		previewVolume: 1, isPlaying: false, currentTime: 0, timelineTime: 0, duration: 1400,
		sourcePlaybackRate: 1, previewSourceAudioFallbackPaths: [] as string[], sourceAudioFallbackStartDelayMsByPath: {},
		sourceAudioResourceVersion: 0, isCurrentClipMuted: false, getSourceTrackPreviewGain: () => 1, onSourceFallbackLoadError: vi.fn(),
	};
	useAudioPreviewSync(input);
	const cleanup = harness.effects[0]();
	if (typeof cleanup === "function") cleanup();
	// Same audio object/path, but effect dependencies changed while IPC was pending.
	harness.effects = []; harness.index = 0;
	useAudioPreviewSync({ ...input, previewVolume: 0.8, previewSourceAudioFallbackPaths: ["/recording.mic.wav"] });
	harness.effects[0]();
	finish({ src: "http://localhost/showcase.m4a", revoke: vi.fn() });
	await Promise.resolve();
	expect(audio.src).toBe("http://localhost/showcase.m4a");
	expect(audio.volume).toBe(0.8);
});

describe("source preview playback ownership", () => {
	it.each([
		{
			name: "sub-second offset",
			muted: false,
			playing: true,
			rate: 1,
			time: 0.5,
			delay: 0,
			plays: true,
		},
		{
			name: "playing clip",
			muted: false,
			playing: true,
			rate: 1,
			time: 1,
			delay: 0,
			plays: true,
		},
		{
			name: "gap or muted clip",
			muted: true,
			playing: true,
			rate: 1,
			time: 1,
			delay: 0,
			plays: false,
		},
		{
			name: "paused clip",
			muted: false,
			playing: false,
			rate: 1,
			time: 1,
			delay: 0,
			plays: false,
		},
		{
			name: "unsupported rate clamped to supported playback",
			muted: false,
			playing: true,
			rate: 20,
			time: 1,
			delay: 0,
			plays: true,
		},
		{
			name: "before audio start",
			muted: false,
			playing: true,
			rate: 1,
			time: 0,
			delay: 1000,
			plays: false,
		},
		{
			name: "media end",
			muted: false,
			playing: true,
			rate: 1,
			time: 10,
			delay: 0,
			plays: false,
		},
		{
			name: "microphone in-point",
			kind: "mic",
			muted: false,
			playing: true,
			rate: 1,
			time: 5.4,
			delay: 1140,
			plays: true,
		},
		{
			name: "before microphone start",
			kind: "mic",
			muted: false,
			playing: true,
			rate: 1,
			time: 0.5,
			delay: 1140,
			plays: false,
		},
	])("checks $name after a late source load", async ({
		kind = "system",
		muted,
		playing,
		rate,
		time,
		delay,
		plays,
	}) => {
		let playbackRate = 1;
		const audio = {
			src: "",
			dataset: {},
			duration: 10,
			currentTime: 0,
			get playbackRate() { return playbackRate; },
			set playbackRate(value: number) {
				if (value > 16) throw new DOMException("Unsupported playback rate", "NotSupportedError");
				playbackRate = value;
			},
			paused: true,
			volume: 1,
			load: vi.fn(),
			pause: vi.fn(),
			play: vi.fn().mockResolvedValue(undefined),
		};
		vi.stubGlobal("Audio", function () {
			return audio;
		});
		vi.stubGlobal(
			"AudioContext",
			class {
				state = "running";
				destination = {};
				createGain() {
					return { gain: { value: 1 }, connect: vi.fn() };
				}
			},
		);
		// Execute mocked effects explicitly so the asynchronous load can finish between syncs.
		const sourcePath = `/audio.${kind}.wav`;
		useAudioPreviewSync({
			audioRegions: [],
			previewVolume: 1,
			isPlaying: playing,
			currentTime: time,
			timelineTime: time,
			duration: 10,
			sourcePlaybackRate: rate,
			previewSourceAudioFallbackPaths: [sourcePath],
			sourceAudioFallbackStartDelayMsByPath: { [sourcePath]: delay },
			sourceAudioResourceVersion: 0,
			isCurrentClipMuted: muted,
			getSourceTrackPreviewGain: () => 1,
			onSourceFallbackLoadError: vi.fn(),
		});
		for (const effect of harness.effects) effect();
		await Promise.resolve();
		expect(harness.loaded).toHaveBeenCalledOnce();
		expect(audio.play).not.toHaveBeenCalled();
		harness.effects.at(-1)?.();
		await Promise.resolve();
		expect(audio.play).toHaveBeenCalledTimes(plays ? 1 : 0);
		if (plays) expect(audio.currentTime).toBeCloseTo(time - delay / 1000);
	});
});
