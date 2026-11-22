export type WebcamStreamLease = {
	stream: MediaStream;
	release: () => void;
};

type WebcamSource = {
	users: number;
	stream: Promise<MediaStream>;
};

/** Preview and recording share one device capture at recording resolution. */
export function createWebcamStreamPool(
	getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream> = (constraints) =>
		navigator.mediaDevices.getUserMedia(constraints),
) {
	const sources = new Map<string, WebcamSource>();

	return async (deviceId?: string): Promise<WebcamStreamLease> => {
		const key = deviceId || "default";
		let source = sources.get(key);
		if (!source) {
			source = {
				users: 0,
				stream: getUserMedia({
					video: {
						...(deviceId ? { deviceId: { exact: deviceId } } : {}),
						width: { ideal: 1280 },
						height: { ideal: 720 },
						frameRate: { ideal: 30, max: 30 },
					},
					audio: false,
				}),
			};
			sources.set(key, source);
		}
		source.users += 1;
		const entry = source;
		let sourceStream: MediaStream;
		try {
			sourceStream = await entry.stream;
		} catch (error) {
			entry.users -= 1;
			if (sources.get(key) === entry) sources.delete(key);
			throw error;
		}

		const releaseSource = () => {
			entry.users -= 1;
			if (entry.users === 0) {
				sourceStream.getTracks().forEach((track) => track.stop());
				if (sources.get(key) === entry) sources.delete(key);
			}
		};
		if (!sourceStream.getVideoTracks().some((track) => track.readyState === "live")) {
			releaseSource();
			if (sources.get(key) === entry) sources.delete(key);
			throw new Error(
				"The webcam video source has ended. Reconnect the camera and try again.",
			);
		}

		// Cloned tracks share the source but can be stopped independently.
		let stream: MediaStream;
		try {
			stream = sourceStream.clone();
		} catch (error) {
			releaseSource();
			throw error;
		}
		let released = false;
		return {
			stream,
			release: () => {
				if (released) return;
				released = true;
				stream.getTracks().forEach((track) => track.stop());
				releaseSource();
			},
		};
	};
}

export const acquireWebcamStream = createWebcamStreamPool();
