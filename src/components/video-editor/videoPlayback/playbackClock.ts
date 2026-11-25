import { createObservableValue } from "@/lib/observableValue";

export function createPlaybackClock() {
	const { get, set, subscribe } = createObservableValue(0);
	return { getTime: get, setTime: set, subscribe };
}

export type PlaybackClock = ReturnType<typeof createPlaybackClock>;
