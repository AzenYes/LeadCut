import { getCaptionFontStack } from "../captionStyle";
import type { KeystrokeOverlayStyle } from "../types";
import type { KeystrokeItem } from "./keystrokeModel";

export type KeystrokePresentation = { items: readonly KeystrokeItem[]; style: KeystrokeOverlayStyle };

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Frame = { width: number; height: number };
type VisibleKeystroke = { id: string; text: string; opacity: number; style: KeystrokeOverlayStyle };
const MAX_VISIBLE_KEYSTROKES = 3;

export function getVisibleKeystrokes(presentation: KeystrokePresentation | undefined, timeMs: number): VisibleKeystroke[] {
	if (!presentation?.items.length) return [];
	const { items, style } = presentation;
	let low = 0;
	let high = items.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (items[mid].startMs <= timeMs) low = mid + 1;
		else high = mid;
	}
	const visible: VisibleKeystroke[] = [];
	for (let index = low - 1; index >= 0 && low - index <= MAX_VISIBLE_KEYSTROKES; index--) {
		const item = items[index];
		if (item.endMs <= timeMs) continue;
		const partial = item.characterParts?.filter(part => part.atMs <= timeMs).map(part => part.text).join("");
		const fade = style.fadeMs > 0 ? Math.min(1, (timeMs - item.startMs) / style.fadeMs, (item.endMs - timeMs) / style.fadeMs) : 1;
		visible.unshift({
			id: item.id,
			text: partial === undefined ? item.label : partial.trim() ? partial : "Space",
			opacity: style.opacity * fade,
			style,
		});
	}
	return visible;
}

export function getKeystrokeFont(style: KeystrokeOverlayStyle, frame: Frame) {
	const scale = Math.min(frame.height / 1080, frame.width / 720);
	return { scale, size: style.fontSize * scale, family: getCaptionFontStack(style) };
}

export function getKeystrokeLayout(style: KeystrokeOverlayStyle, frame: Frame, textWidth: number, index = 0, count = 1) {
	const { scale, size } = getKeystrokeFont(style, frame);
	const margin = 8 * scale;
	const padX = size * 0.55;
	const width = Math.min(frame.width - 2 * margin, textWidth + 2 * padX);
	const height = Math.min(frame.height - 2 * margin, size * 1.62);
	const x = Math.max(margin, Math.min(frame.width - margin - width, frame.width * style.x / 100 - width / 2));
	const step = height + 6 * scale;
	const newestY = Math.max(margin + (count - 1) * step, Math.min(frame.height - margin - height, frame.height * style.y / 100 - height / 2));
	const y = newestY - (count - index - 1) * step;
	return { x, y, width, height, padX, fontSize: size, radius: Math.min(height / 2, style.cornerRadius * scale) };
}

function drawKeystroke(context: Context, frame: Frame, visible: VisibleKeystroke, index: number, count: number) {
	const { style, text, opacity } = visible;
	const font = getKeystrokeFont(style, frame);
	context.save();
	context.font = `600 ${font.size}px ${font.family}`;
	const layout = getKeystrokeLayout(style, frame, context.measureText(text).width, index, count);
	context.globalAlpha = opacity;
	context.fillStyle = style.backgroundColor;
	context.beginPath();
	context.roundRect(layout.x, layout.y, layout.width, layout.height, layout.radius);
	context.fill();
	context.fillStyle = style.textColor;
	context.textBaseline = "middle";
	context.textAlign = "center";
	context.fillText(text, layout.x + layout.width / 2, layout.y + layout.height / 2, Math.max(1, layout.width - layout.padX * 2));
	context.restore();
	return layout;
}

export function drawKeystrokes(context: Context, frame: Frame, visible: VisibleKeystroke[]) {
	if (frame.width <= 0 || frame.height <= 0) return [];
	return visible.map((item, index) => drawKeystroke(context, frame, item, index, visible.length));
}
