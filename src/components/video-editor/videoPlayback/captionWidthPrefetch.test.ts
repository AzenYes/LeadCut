import { afterEach, expect, it, vi } from "vitest";
import { premeasureCaptionWidths } from "./captionWidthPrefetch";

afterEach(() => vi.unstubAllGlobals());

it("publishes complete measurements and invalidates them when fonts change", async () => {
	const fonts = Object.assign(new EventTarget(), { status: "loaded", ready: Promise.resolve() });
	let fontRevision = 1;
	const context = {
		font: "",
		measureText(text: string) {
			return { width: fontRevision * text.length * Number.parseInt(context.font, 10) };
		},
	};
	vi.stubGlobal("document", { fonts, createElement: () => ({ getContext: () => context }) });
	vi.stubGlobal("performance", { now: () => 0 });
	const pending = new Map<number, IdleRequestCallback>();
	let nextId = 0;
	vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
		const id = nextId++;
		pending.set(id, callback);
		return id;
	});
	vi.stubGlobal("cancelIdleCallback", (id: number) => pending.delete(id));
	const step = (timeRemaining: () => number) => {
		const [id, callback] = [...pending][0];
		pending.delete(id);
		callback({ didTimeout: false, timeRemaining });
	};
	const widths = new Map<number, Float64Array>();
	const texts = Array.from({ length: 40 }, (_, index) => `word${index}`);
	const cleanup = premeasureCaptionWidths({ sizes: [14, 15], texts, font: size => `${size}px serif`, widths });
	await fonts.ready;
	let batches = 0;
	step(() => (batches++ === 0 ? 1 : 0));
	expect(widths.size).toBe(0);
	step(() => 10);
	expect(widths.get(14)?.[0]).toBe(70);
	expect(widths.get(15)?.[39]).toBe(90);
	expect(pending.size).toBe(0);

	fonts.status = "loading";
	fonts.dispatchEvent(new Event("loading"));
	expect(widths.size).toBe(0);
	fontRevision = 2;
	fonts.status = "loaded";
	fonts.dispatchEvent(new Event("loadingdone"));
	step(() => 10);
	expect(widths.get(14)?.[0]).toBe(140);

	fonts.dispatchEvent(new Event("loading"));
	fonts.dispatchEvent(new Event("loadingdone"));
	expect(pending.size).toBe(1);
	cleanup?.();
	expect(pending.size).toBe(0);
	fonts.dispatchEvent(new Event("loadingdone"));
	expect(pending.size).toBe(0);
});
