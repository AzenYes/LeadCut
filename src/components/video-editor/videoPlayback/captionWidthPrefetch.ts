export function premeasureCaptionWidths({ sizes, texts, font, widths }: {
	sizes: readonly number[];
	texts: readonly string[];
	font: (size: number) => string;
	widths: Map<number, Float64Array>;
}) {
	if (typeof requestIdleCallback !== "function" || !document.fonts) return;
	const context = document.createElement("canvas").getContext("2d");
	if (!context) return;
	const fonts = document.fonts;
	let idleId: number | undefined;
	let sizeIndex = 0;
	let textIndex = 0;
	let appliedSize = Number.NaN;
	let measured = new Float64Array(texts.length);
	let disposed = false;
	const fill = (deadline: IdleDeadline) => {
		idleId = undefined;
		// Check the remaining idle budget between small batches of measurements.
		const sliceEnd = performance.now() + 2;
		while (sizeIndex < sizes.length && deadline.timeRemaining() >= 0.5 && performance.now() < sliceEnd) {
			const size = sizes[sizeIndex];
			if (appliedSize !== size) {
				context.font = font(size);
				appliedSize = size;
			}
			const until = Math.min(textIndex + 32, texts.length);
			while (textIndex < until) {
				measured[textIndex] = context.measureText(texts[textIndex]).width;
				textIndex++;
			}
			if (textIndex === texts.length) {
				widths.set(size, measured);
				sizeIndex++;
				textIndex = 0;
				measured = new Float64Array(texts.length);
			}
		}
		if (sizeIndex < sizes.length) idleId = requestIdleCallback(fill);
	};
	const pause = () => {
		if (idleId !== undefined) cancelIdleCallback(idleId);
		idleId = undefined;
		sizeIndex = 0;
		textIndex = 0;
		appliedSize = Number.NaN;
		widths.clear();
	};
	const resume = () => {
		if (!disposed && idleId === undefined && sizeIndex < sizes.length && fonts.status === "loaded") {
			idleId = requestIdleCallback(fill);
		}
	};
	fonts.addEventListener("loading", pause);
	fonts.addEventListener("loadingdone", resume);
	fonts.addEventListener("loadingerror", resume);
	void fonts.ready.then(resume);
	return () => {
		disposed = true;
		pause();
		fonts.removeEventListener("loading", pause);
		fonts.removeEventListener("loadingdone", resume);
		fonts.removeEventListener("loadingerror", resume);
	};
}
