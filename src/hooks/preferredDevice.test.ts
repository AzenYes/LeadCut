import { describe, expect, it } from "vitest";
import { resolvePreferredDevice } from "./preferredDevice";

const devices = [
	{ deviceId: "one", label: "Camera A" },
	{ deviceId: "two", label: "Camera B" },
];

describe("resolvePreferredDevice", () => {
	it("prefers the saved ID over a device bearing the old label", () => {
		expect(resolvePreferredDevice(devices, { id: "two", label: "Camera A" }))
			.toEqual({ deviceId: "two", matchedBy: "id" });
	});
	it("finds the same device by label after its ID changes", () => {
		expect(resolvePreferredDevice(devices, { id: "unknown", label: "Camera B" }))
			.toEqual({ deviceId: "two", matchedBy: "label" });
	});
	it("falls back to the system default when the saved hardware is unavailable", () => {
		const preference = { id: "unknown", label: "Camera C" };
		for (const inputs of [devices, []]) {
			expect(resolvePreferredDevice(inputs, preference))
				.toEqual({ deviceId: "default", matchedBy: "none" });
		}
	});
	it("honors an explicit system default even when there is no device named default", () => {
		expect(resolvePreferredDevice(devices, { id: "default" }))
			.toEqual({ deviceId: "default", matchedBy: "id" });
	});
});
