import { LIVE_ANNOTATION_FADE_MS, type LiveAnnotationShape } from "./liveAnnotationModel";

export function drawLiveAnnotation(ctx: CanvasRenderingContext2D, shape: LiveAnnotationShape, now: number) {
	const [start] = shape.points;
	if (!start) return;
	const end = shape.points[shape.points.length - 1];
	const width = end.x - start.x, height = end.y - start.y;
	const fade = shape.fadeAt === undefined ? 1 : Math.max(0, Math.min(1, 1 - (now - shape.fadeAt) / LIVE_ANNOTATION_FADE_MS));
	if (fade === 0) return;
	ctx.save();
	ctx.globalAlpha = fade * (shape.tool === "highlighter" ? 0.3 : 1);
	ctx.strokeStyle = shape.color;
	ctx.fillStyle = shape.color;
	ctx.lineWidth = shape.tool === "highlighter" ? shape.weight * 3 : shape.weight;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.beginPath();
	if (shape.tool === "text") {
		ctx.font = `600 ${Math.max(14, shape.weight * 5)}px system-ui`;
		ctx.textBaseline = "top";
		ctx.fillText(shape.text ?? "", start.x, start.y);
	} else if (shape.tool === "rectangle") {
		ctx.strokeRect(start.x, start.y, width, height);
	} else if (shape.tool === "ellipse") {
		ctx.ellipse(start.x + width / 2, start.y + height / 2, Math.abs(width) / 2, Math.abs(height) / 2, 0, 0, Math.PI * 2);
		ctx.stroke();
	} else if (shape.points.length === 1 || (width === 0 && height === 0 && shape.points.length === 2)) {
		ctx.arc(start.x, start.y, ctx.lineWidth / 2, 0, Math.PI * 2);
		ctx.fill();
	} else {
		ctx.moveTo(start.x, start.y);
		for (const point of shape.points.slice(1)) ctx.lineTo(point.x, point.y);
		if (shape.tool === "arrow") {
			const angle = Math.atan2(height, width);
			const head = Math.min(Math.max(12, shape.weight * 3), Math.hypot(width, height) * 0.65);
			for (const direction of [-1, 1]) {
				const wing = angle + direction * Math.PI / 6;
				ctx.moveTo(end.x, end.y);
				ctx.lineTo(end.x - head * Math.cos(wing), end.y - head * Math.sin(wing));
			}
		}
		ctx.stroke();
	}
	ctx.restore();
}
