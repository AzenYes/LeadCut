import { ModernVideoExporter } from "./modernVideoExporter";

type VideoExporterConfig = ConstructorParameters<typeof ModernVideoExporter>[0];

export class VideoExporter extends ModernVideoExporter {
	constructor(config: VideoExporterConfig) {
		super({
			...config,
			backendPreference: "webcodecs",
			preferredRenderBackend: "webgl",
			experimentalNativeExport: false,
			experimentalNvidiaCudaExport: false,
		});
	}
}
