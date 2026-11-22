import type { DevicePreference } from "./preferredDevice";
import { usePreferredCaptureDevice } from "./usePreferredCaptureDevice";

export function useMicrophoneDevices(enabled: boolean, locked: boolean, persist: (preference: DevicePreference) => void) {
	return usePreferredCaptureDevice("audioinput", enabled, locked, persist);
}
