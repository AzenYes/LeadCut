import { expect, test } from "@playwright/test";

for (const deviceAvailable of [true, false]) {
	test(`WebGPU support probe releases its temporary device (available=${deviceAvailable})`, async ({ page }) => {
		test.setTimeout(60_000);
		await page.route("**/webgpu-probe-test", route => route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><title>WebGPU capability probe</title>",
		}));
		await page.goto("/webgpu-probe-test");

		const result = await page.evaluate(async available => {
			let requests = 0;
			let destroyed = 0;
			Object.defineProperty(navigator, "gpu", {
				value: {
					requestAdapter: async () => ({
						requestDevice: async () => {
							requests += 1;
							if (!available) throw new Error("WebGPU device unavailable");
							return { destroy: () => { destroyed += 1; } };
						},
					}),
				},
			});
			const { isWebGPUSupported } = await import("/tests/ui/fixtures/webgpuProbe.ts");
			return {
				first: await isWebGPUSupported(),
				cached: await isWebGPUSupported(),
				requests,
				destroyed,
			};
		}, deviceAvailable);

		expect(result).toEqual({
			first: deviceAvailable,
			cached: deviceAvailable,
			requests: 1,
			destroyed: deviceAvailable ? 1 : 0,
		});
	});
}
