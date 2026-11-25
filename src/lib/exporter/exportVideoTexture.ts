import { Texture, TextureSource, type WebGPURenderer } from "pixi.js";

const SAMPLE_VIDEO = `
@group(0) @binding(0) var video: texture_external;
@group(0) @binding(1) var linearSampler: sampler;

struct VertexOut {
	@builtin(position) position: vec4f,
	@location(0) uv: vec2f,
}

@vertex fn vertex(@builtin(vertex_index) index: u32) -> VertexOut {
	let position = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[index];
	return VertexOut(vec4f(position, 0, 1), vec2f((position.x + 1) * 0.5, (1 - position.y) * 0.5));
}

@fragment fn fragment(input: VertexOut) -> @location(0) vec4f {
	return textureSampleBaseClampToEdge(video, linearSampler, input.uv);
}`;

function canSampleDirectly(frame: VideoFrame): boolean {
	const { colorSpace, visibleRect } = frame;
	return frame.format === "NV12" &&
		colorSpace.fullRange === false && colorSpace.primaries === "bt709" &&
		colorSpace.transfer === "bt709" && colorSpace.matrix === "bt709" &&
		frame.displayWidth * frame.displayHeight >= 3840 * 2160 &&
		visibleRect?.width === frame.displayWidth && visibleRect.height === frame.displayHeight &&
		!frame.rotation && !frame.flip;
}

type VideoPipeline = { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout; sampler: GPUSampler };

export class ExportVideoTexture {
	private pipeline: Promise<VideoPipeline | null> | undefined;
	private lastFrame: VideoFrame | null = null;
	private current: { texture: Texture; view: GPUTextureView } | null = null;

	constructor(private readonly renderer: WebGPURenderer) {}

	usesTexture(texture: Texture): boolean {
		return this.current?.texture === texture;
	}

	async upload(frame: VideoFrame, signal: AbortSignal): Promise<Texture | null> {
		signal.throwIfAborted();
		const { device } = this.renderer.gpu;
		if (!canSampleDirectly(frame) || typeof device.importExternalTexture !== "function") return null;
		if (this.current && this.lastFrame === frame) return this.current.texture;
		this.pipeline ??= this.createPipeline(device);
		const stage = await this.pipeline;
		signal.throwIfAborted();
		if (!stage) return null;

		const previous = this.current;
		const reuse = previous?.texture.width === frame.displayWidth && previous.texture.height === frame.displayHeight;
		const texture = reuse ? previous.texture : new Texture({ source: new TextureSource({
			width: frame.displayWidth,
			height: frame.displayHeight,
			format: "rgba8unorm",
			scaleMode: "linear",
			autoGarbageCollect: false,
			label: "export primary video",
		}) });
		try {
			const view = reuse ? previous.view : this.renderer.texture.getGpuSource(texture.source).createView();
			const bindings = device.createBindGroup({ layout: stage.layout, entries: [
				{ binding: 0, resource: device.importExternalTexture({ source: frame, colorSpace: "srgb" }) },
				{ binding: 1, resource: stage.sampler },
			] });
			const encoder = device.createCommandEncoder({ label: "export primary video" });
			const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }] });
			pass.setPipeline(stage.pipeline);
			pass.setBindGroup(0, bindings);
			pass.draw(3);
			pass.end();
			device.queue.submit([encoder.finish()]);
			this.current = { texture, view };
			this.lastFrame = frame;
			return texture;
		} catch {
			if (!reuse) texture.destroy(true);
			return null;
		}
	}

	forgetTexture(): void {
		this.current = null;
		this.lastFrame = null;
	}

	private async createPipeline(device: GPUDevice): Promise<VideoPipeline | null> {
		try {
			const shader = device.createShaderModule({ code: SAMPLE_VIDEO });
			const pipeline = await device.createRenderPipelineAsync({
				layout: "auto",
				vertex: { module: shader, entryPoint: "vertex" },
				fragment: { module: shader, entryPoint: "fragment", targets: [{ format: "rgba8unorm" }] },
			});
			return {
				pipeline,
				layout: pipeline.getBindGroupLayout(0),
				sampler: device.createSampler({ magFilter: "linear", minFilter: "linear" }),
			};
		} catch {
			return null;
		}
	}
}
