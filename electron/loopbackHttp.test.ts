import { randomInt } from "node:crypto";
import { createServer, get } from "node:http";
import { expect, it } from "vitest";
import { listenForBrowserOnLoopback } from "./loopbackHttp";

it("tries another private loopback port when the first is in use", async () => {
	const occupied = createServer();
	const server = createServer((_request, response) => response.end("ready"));
	try {
		const occupiedOrigin = await listenForBrowserOnLoopback(occupied);
		const occupiedPort = Number(new URL(occupiedOrigin).port);
		let attempts = 0;
		const origin = await listenForBrowserOnLoopback(server, () => ++attempts === 1 ? occupiedPort : randomInt(49_152, 65_536));
		const port = Number(new URL(origin).port);
		expect(attempts).toBeGreaterThan(1);
		expect(port).not.toBe(occupiedPort);
		expect(port).toBeGreaterThanOrEqual(49_152);
		expect(port).toBeLessThanOrEqual(65_535);
		const code = await new Promise<number | undefined>((resolve, reject) => {
			get(origin, response => { response.resume(); resolve(response.statusCode); }).once("error", reject);
		});
		expect(code).toBe(200);
	} finally {
		for (const listener of [server, occupied]) {
			if (listener.listening) await new Promise<void>(resolve => { listener.close(() => resolve()); });
		}
	}
});
