import { DefaultBatcher, getTextureBatchBindGroup, Texture } from "pixi.js";

export function inspectPixiTextureLimits() {
	return [32, 16, 32].map((maxTextures) => {
		const batcher = new DefaultBatcher({ maxTextures });
		const bindings = batcher.shader.gpuProgram?.gpuLayout.flat().filter((binding) => binding.texture).length;
		const group = getTextureBatchBindGroup([Texture.WHITE.source], 1, maxTextures);
		return { bindings, resources: Object.keys(group.resources).length };
	});
}
