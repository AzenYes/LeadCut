import { useCallback, useEffect, useRef, useState } from "react";
import { type DeviceMatch, type DevicePreference, resolvePreferredDevice } from "./preferredDevice";
import { acquireWebcamStream } from "./webcamStream";

export function usePreferredCaptureDevice(
	kind: "audioinput" | "videoinput",
	enabled: boolean,
	locked: boolean,
	persist: (preference: DevicePreference) => void,
) {
	const [rawDevices, setDevices] = useState<MediaDeviceInfo[]>();
	const [preference, setPreference] = useState<DevicePreference>({});
	const [selection, setSelection] = useState<DeviceMatch>({ deviceId: "default", matchedBy: "none" });
	const manuallySelected = useRef(false);
	const requestedLabels = useRef(false);

	useEffect(() => {
		const media = navigator.mediaDevices;
		if (!enabled || !media?.enumerateDevices) return;
		let active = true;
		let request = 0;
		const enumerate = async () => (await media.enumerateDevices()).filter(device =>
			device.kind === kind && device.deviceId !== "default",
		);
		const load = async () => {
			const current = ++request;
			let release: (() => void) | undefined;
			try {
				let inputs = await enumerate();
				if (active && current === request && !locked && !requestedLabels.current &&
					inputs.length && inputs.every(device => !device.label.trim())) {
					requestedLabels.current = true;
					try {
						if (kind === "videoinput") {
							release = (await acquireWebcamStream()).release;
						} else {
							const stream = await media.getUserMedia({ audio: true });
							release = () => stream.getTracks().forEach(track => track.stop());
						}
						inputs = await enumerate();
					} catch {
						// IDs can still be usable without device labels.
					}
				}
				if (active && current === request) setDevices(inputs.filter(device => device.deviceId));
			} catch (error) {
				if (active && current === request) console.warn("Unable to enumerate recording devices", error);
			} finally {
				release?.();
			}
		};
		void load();
		media.addEventListener("devicechange", load);
		return () => {
			active = false;
			media.removeEventListener("devicechange", load);
		};
	}, [enabled, kind, locked]);

	useEffect(() => {
		if (!enabled || locked || !rawDevices) return;
		const match = resolvePreferredDevice(rawDevices, preference);
		if (manuallySelected.current && preference.id !== "default") {
			// Once a manually selected device is unavailable, keep the fallback until
			// the user makes another choice or starts a new session.
			if (selection.deviceId === "default") return;
			if (match.matchedBy !== "id") {
				setSelection({ deviceId: "default", matchedBy: "none" });
				return;
			}
		}
		if (match.deviceId !== selection.deviceId || match.matchedBy !== selection.matchedBy) {
			setSelection(match);
		}
		if (match.matchedBy === "label") {
			const updated = { ...preference, id: match.deviceId };
			setPreference(updated);
			persist(updated);
		}
	}, [enabled, locked, persist, preference, rawDevices, selection]);

	const restorePreference = useCallback((saved: DevicePreference) => {
		if (!manuallySelected.current) setPreference(saved);
	}, []);

	const selectDevice = (id: string) => {
		manuallySelected.current = true;
		const selected = { id, label: rawDevices?.find(device => device.deviceId === id)?.label || undefined };
		setPreference(selected);
		setSelection({ deviceId: id, matchedBy: "id" });
		persist(selected);
	};

	const devices = (rawDevices ?? []).map((device, index) => ({
		deviceId: device.deviceId,
		label: device.label || (kind === "audioinput" ? `Microphone ${index + 1}` : `Camera ${index + 1}`),
		groupId: device.groupId,
	}));
	const missingDevice = rawDevices !== undefined && selection.matchedBy === "none" &&
		Boolean((preference.id && preference.id !== "default") || preference.label);
	return {
		devices, selectDevice, restorePreference, missingDevice, missingLabel: preference.label,
		selectedDeviceId: selection.deviceId, matchedBy: selection.matchedBy,
	};
}
