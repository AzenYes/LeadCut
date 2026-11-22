import type { DevicePreference } from "./preferredDevice";
import { usePreferredCaptureDevice } from "./usePreferredCaptureDevice";

export function useVideoDevices(enabled: boolean, locked: boolean, persist: (preference: DevicePreference) => void) {
	return usePreferredCaptureDevice("videoinput", enabled, locked, persist);
}
