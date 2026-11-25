import { CanvasSource, Container, Rectangle, Sprite, Texture } from "pixi.js";
import {
	chapterProgressStatus,
	type ChapterProgress,
} from "@/components/video-editor/chapterProgress";
import {
	drawKeystrokes,
	getKeystrokeFont,
	getKeystrokeLayout,
	getVisibleKeystrokes,
	type KeystrokePresentation,
} from "@/components/video-editor/keystrokes/keystrokeLayout";
import { drawChapterProgress } from "./chapterRenderer";

type Frame = { width: number; height: number };
type Bounds = Frame & { x: number; y: number };
type Overlay = { sprite: Sprite; context: CanvasRenderingContext2D; key?: string };

export class ScreenOverlaySprites {
	private container = new Container();
	private chapter: { data: ChapterProgress; played: Sprite; unplayed: Sprite } | undefined;
	private keystrokes: Overlay | undefined;
	private measurement = document.createElement("canvas").getContext("2d");

	constructor(
		stage: Container,
		private frame: Frame,
	) {
		stage.addChild(this.container);
	}

	setVisible(visible: boolean): void {
		this.container.visible = visible;
	}

	update(
		chapter: ChapterProgress | undefined,
		keystrokes: KeystrokePresentation | undefined,
		time: number,
	): void {
		this.setVisible(true);
		this.updateChapter(chapter, time);
		this.updateKeystrokes(keystrokes, time);
	}

	destroy(): void {
		this.container.destroy({ children: true, texture: true, textureSource: true });
		this.chapter = undefined;
		this.keystrokes = undefined;
	}

	private updateChapter(chapter: ChapterProgress | undefined, time: number): void {
		if (!chapter || chapterProgressStatus(chapter) !== "ready") {
			if (this.chapter) {
				this.chapter.played.visible = false;
				this.chapter.unplayed.visible = false;
			}
			return;
		}

		const { width, height } = this.frame;
		if (this.chapter?.data !== chapter) {
			this.chapter?.played.destroy({ texture: true, textureSource: true });
			this.chapter?.unplayed.destroy({ texture: true, textureSource: true });
			const stripHeight = Math.min(
				height,
				Math.ceil((chapter.style.height * width) / 3840) + 2,
			);
			const top = height - stripHeight;
			const renderStrip = (timeMs: number, childIndex: number) => {
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = stripHeight;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("Export chapter texture canvas is unavailable");
				context.translate(0, -top);
				drawChapterProgress(context, chapter, width, height, timeMs);
				const sprite = new Sprite(
					new Texture({
						source: new CanvasSource({ resource: canvas }),
						frame: new Rectangle(0, 0, width, stripHeight),
						dynamic: true,
					}),
				);
				sprite.y = top;
				this.container.addChildAt(sprite, childIndex);
				return sprite;
			};
			this.chapter = {
				data: chapter,
				unplayed: renderStrip(0, 0),
				played: renderStrip(chapter.durationMs, 1),
			};
		}

		const playedWidth = width * Math.max(0, Math.min(1, time / chapter.durationMs));
		this.setChapterSlice(this.chapter.played, 0, playedWidth);
		this.setChapterSlice(this.chapter.unplayed, playedWidth, width - playedWidth);
	}

	private setChapterSlice(sprite: Sprite, left: number, width: number): void {
		sprite.visible = width > 0;
		if (!sprite.visible) return;
		const { texture } = sprite;
		if (texture.frame.x === left && texture.frame.width === width) return;
		texture.frame.x = left;
		texture.frame.width = width;
		texture.update();
		sprite.x = left;
	}

	private updateKeystrokes(keystrokes: KeystrokePresentation | undefined, time: number): void {
		const visible = getVisibleKeystrokes(keystrokes, time);
		if (visible.length === 0) {
			if (this.keystrokes) this.keystrokes.sprite.visible = false;
			return;
		}
		const key = JSON.stringify(visible.map((item) => [item.id, item.text, item.opacity]));
		if (this.keystrokes?.key === key) {
			this.keystrokes.sprite.visible = true;
			return;
		}
		const { width, height } = this.frame;
		let left = width;
		let top = height;
		let right = 0;
		let bottom = 0;
		const measurement = this.measurement;
		if (!measurement) throw new Error("Export keystroke measurement canvas is unavailable");
		visible.forEach(({ style, text }, index) => {
			const font = getKeystrokeFont(style, this.frame);
			measurement.font = `600 ${font.size}px ${font.family}`;
			const layout = getKeystrokeLayout(
				style,
				this.frame,
				measurement.measureText(text).width,
				index,
				visible.length,
			);
			left = Math.min(left, layout.x);
			top = Math.min(top, layout.y);
			right = Math.max(right, layout.x + layout.width);
			bottom = Math.max(bottom, layout.y + layout.height);
		});
		const x = Math.max(0, Math.floor(left) - 2);
		const y = Math.max(0, Math.floor(top) - 2);
		const bounds = {
			x,
			y,
			width: Math.max(1, Math.min(width, Math.ceil(right) + 2) - x),
			height: Math.max(1, Math.min(height, Math.ceil(bottom) + 2) - y),
		};
		this.keystrokes = this.draw(
			this.keystrokes,
			bounds,
			key,
			(context) => drawKeystrokes(context, this.frame, visible),
			this.chapter ? 2 : 0,
		);
	}

	private draw(
		overlay: Overlay | undefined,
		bounds: Bounds,
		key: string,
		render: (context: CanvasRenderingContext2D) => void,
		index: number,
	): Overlay {
		const { x, y, width, height } = bounds;
		if (
			!overlay ||
			overlay.context.canvas.width !== width ||
			overlay.context.canvas.height !== height
		) {
			overlay?.sprite.destroy({ texture: true, textureSource: true });
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Export overlay texture canvas is unavailable");
			const sprite = new Sprite(Texture.from(canvas));
			this.container.addChildAt(sprite, index);
			overlay = { context, sprite };
		}
		const { context, sprite } = overlay;
		sprite.position.set(x, y);
		sprite.visible = true;
		context.clearRect(0, 0, width, height);
		context.save();
		context.translate(-x, -y);
		render(context);
		context.restore();
		sprite.texture.source.update();
		overlay.key = key;
		return overlay;
	}
}
