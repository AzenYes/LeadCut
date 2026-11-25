import { randomInt } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";


/** Use the private port range, away from ports reserved for other services. */
export async function listenForBrowserOnLoopback(server: Server, pickPort = () => randomInt(49_152, 65_536)) {
	for (let attempt = 0; attempt < 8; attempt++) {
		const port = pickPort();
		const listening = once(server, "listening");
		server.listen(port, "127.0.0.1");
		try {
			await listening;
			return `http://127.0.0.1:${port}`;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EADDRINUSE" && code !== "EACCES") throw error;
		}
	}
	throw new Error("Could not allocate a private loopback port");
}
