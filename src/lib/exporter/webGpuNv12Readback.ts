const RGB_TO_NV12 = `
@group(0) @binding(0) var source : texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> nv12 : array<u32>;

fn yuv(at : vec2<i32>) -> vec3<f32> {
	let rgb = textureLoad(source, at, 0).rgb;
	let luma = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
	return vec3<f32>(16.0 + 219.0 * luma, 128.0 + 224.0 * (rgb.b - luma) / 1.8556,
		128.0 + 224.0 * (rgb.r - luma) / 1.5748);
}

fn byte(value : f32) -> u32 {
	return u32(clamp(round(value), 0.0, 255.0));
}

fn pack(samples : vec4<f32>) -> u32 {
	return byte(samples.x) | (byte(samples.y) << 8u) | (byte(samples.z) << 16u) | (byte(samples.w) << 24u);
}

@compute @workgroup_size(8, 8)
fn convert(@builtin(global_invocation_id) id : vec3<u32>) {
	let size = textureDimensions(source, 0);
	let x = id.x * 4u;
	let y = id.y * 2u;
	if (x >= size.x || y >= size.y) { return; }
	let origin = vec2<i32>(i32(x), i32(y));
	let a = yuv(origin);
	let b = yuv(origin + vec2<i32>(1, 0));
	let c = yuv(origin + vec2<i32>(2, 0));
	let d = yuv(origin + vec2<i32>(3, 0));
	let e = yuv(origin + vec2<i32>(0, 1));
	let f = yuv(origin + vec2<i32>(1, 1));
	let g = yuv(origin + vec2<i32>(2, 1));
	let h = yuv(origin + vec2<i32>(3, 1));
	let leftChroma = (a.yz + b.yz + e.yz + f.yz) * 0.25;
	let rightChroma = (c.yz + d.yz + g.yz + h.yz) * 0.25;
	let stride = size.x / 4u;
	nv12[y * stride + id.x] = pack(vec4<f32>(a.x, b.x, c.x, d.x));
	nv12[(y + 1u) * stride + id.x] = pack(vec4<f32>(e.x, f.x, g.x, h.x));
	nv12[(size.y + id.y) * stride + id.x] = pack(vec4<f32>(leftChroma, rightChroma));
}
`;

export class GpuFramePipelineError extends Error {
	constructor(message: string, readonly cause?: unknown) {
		super(message);
		this.name = "GpuFramePipelineError";
	}
}

export class WebGpuNv12Readback {
	private readonly available: GPUBuffer[];
	private readonly layout: GPUBindGroupLayout;
	private ready: { buffer: GPUBuffer; completion: Promise<void> } | null = null;
	private destroyed = false;

	private constructor(
		private readonly device: GPUDevice,
		private readonly width: number,
		private readonly height: number,
		private readonly pipeline: GPUComputePipeline,
		private readonly converted: GPUBuffer,
		private readonly readbacks: GPUBuffer[],
	) {
		this.available = [...readbacks];
		this.layout = pipeline.getBindGroupLayout(0);
	}

	static async create(device: GPUDevice, width: number, height: number): Promise<WebGpuNv12Readback | null> {
		const size = width * height * 1.5;
		if (width < 3840 || width % 4 || height % 2 ||
			size > Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize)) return null;
		const buffers: GPUBuffer[] = [];
		try {
			const pipeline = await device.createComputePipelineAsync({
				layout: "auto",
				compute: { module: device.createShaderModule({ code: RGB_TO_NV12 }), entryPoint: "convert" },
			});
			const converted = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
			buffers.push(converted);
			for (let slot = 0; slot < 2; slot++) {
				buffers.push(device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
			}
			return new WebGpuNv12Readback(device, width, height, pipeline, converted, buffers.slice(1));
		} catch {
			for (const buffer of buffers) buffer.destroy();
			return null;
		}
	}

	begin(texture: GPUTexture): void {
		if (this.destroyed || texture.width !== this.width || texture.height !== this.height ||
			!(texture.usage & GPUTextureUsage.TEXTURE_BINDING)) return;
		if (this.ready) throw new GpuFramePipelineError("A pending export frame was not collected");
		const buffer = this.available.pop();
		if (!buffer) throw new GpuFramePipelineError("All export readback buffers were busy");
		try {
			const bindGroup = this.device.createBindGroup({ layout: this.layout, entries: [
				{ binding: 0, resource: texture.createView() },
				{ binding: 1, resource: { buffer: this.converted } },
			] });
			const commands = this.device.createCommandEncoder();
			const pass = commands.beginComputePass({ label: "NV12 conversion" });
			pass.setPipeline(this.pipeline);
			pass.setBindGroup(0, bindGroup);
			pass.dispatchWorkgroups(Math.ceil(this.width / 32), Math.ceil(this.height / 16));
			pass.end();
			commands.copyBufferToBuffer(this.converted, 0, buffer, 0, buffer.size);
			this.device.queue.submit([commands.finish()]);
			const completion = buffer.mapAsync(GPUMapMode.READ).catch(error => {
				if (this.destroyed || buffer.mapState !== "unmapped") throw error;
				// The slot still holds this frame's GPU copy until the reader releases it.
				return buffer.mapAsync(GPUMapMode.READ);
			});
			void completion.catch(() => undefined);
			this.ready = { buffer, completion };
		} catch (cause) {
			this.available.push(buffer);
			throw new GpuFramePipelineError("Could not start GPU export frame conversion", cause);
		}
	}

	takeFrame(timestamp: number, duration: number): Promise<VideoFrame> | undefined {
		if (!this.ready) return undefined;
		const { buffer, completion } = this.ready;
		this.ready = null;
		return completion.then(() => {
			if (this.destroyed) throw new GpuFramePipelineError("GPU export readback was closed");
			try {
				return new VideoFrame(new Uint8Array(buffer.getMappedRange()), {
					format: "NV12", codedWidth: this.width, codedHeight: this.height, timestamp, duration,
					colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false },
				});
			} catch (cause) {
				throw new GpuFramePipelineError("Could not read back the converted export frame", cause);
			} finally {
				buffer.unmap();
				this.available.push(buffer);
			}
		}, cause => {
			if (!this.destroyed) this.available.push(buffer);
			throw new GpuFramePipelineError("GPU export frame readback failed", cause);
		});
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.ready = null;
		this.converted.destroy();
		for (const buffer of this.readbacks) buffer.destroy();
		this.available.length = 0;
	}
}
