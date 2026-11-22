export type DevicePreference = { id?: string; label?: string };

export type DeviceMatch = {
	deviceId: string;
	matchedBy: "id" | "label" | "none";
};

export function resolvePreferredDevice(
	devices: readonly Pick<MediaDeviceInfo, "deviceId" | "label">[],
	preference: DevicePreference,
): DeviceMatch {
	if (preference.id === "default") return { deviceId: "default", matchedBy: "id" };
	const byId = preference.id && devices.find(device => device.deviceId === preference.id);
	if (byId) return { deviceId: byId.deviceId, matchedBy: "id" };
	const byLabel = preference.label && devices.find(device =>
		device.deviceId && device.deviceId !== "default" && device.label === preference.label,
	);
	if (byLabel) return { deviceId: byLabel.deviceId, matchedBy: "label" };
	return { deviceId: "default", matchedBy: "none" };
}
