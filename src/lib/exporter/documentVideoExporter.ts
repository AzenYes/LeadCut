import type { ModernVideoExporter } from "./modernVideoExporter";
import type { ExportResult } from "./types";

const exportMethods = [
	"cancelExportAudioPcm",
	"closeExportAudioPcmReader",
	"closeExportStream",
	"discardExportedTemp",
	"encodeExportAudioAac",
	"finishExportAudioAppend",
	"getAppVersion",
	"getAssetBasePath",
	"getExportHardwareInfo",
	"getLocalMediaUrl",
	"muxExportedVideoAudio",
	"muxExportedVideoAudioFromPath",
	"nativeStaticLayoutExport",
	"nativeStaticLayoutExportCancel",
	"nativeVideoExportCancel",
	"nativeVideoExportEndVideoInput",
	"nativeVideoExportFinish",
	"nativeVideoExportStart",
	"nativeVideoExportWriteFrames",
	"nativeVideoExportWriteWav",
	"onNativeStaticLayoutExportProgress",
	"openExportAacStream",
	"openExportAudioPcmReader",
	"openExportStream",
	"prepareExportAudioPcm",
	"prepareExportAudioSource",
	"readExportAudioPcmWindow",
	"probeNativeVideoMetadata",
	"readLocalFile",
	"resolveNativeBundledImagePath",
	"startExportAudioAppend",
	"writeAppLog",
	"writeExportAudioAppend",
	"writeExportStreamChunk",
] as const satisfies readonly (keyof Window["electronAPI"])[];

type ExportApi = Pick<Window["electronAPI"], (typeof exportMethods)[number]>;
type ExporterConfig = ConstructorParameters<typeof ModernVideoExporter>[0];
type DocumentExporter = Pick<ModernVideoExporter, "cancel" | "export">;
type CreateDocumentExporter = (config: ExporterConfig, exportApi: ExportApi) => DocumentExporter;

export interface DocumentExportWindow extends Window {
	createDocumentExporter?: CreateDocumentExporter;
}

function loadExportDocument(frame: HTMLIFrameElement, signal: AbortSignal) {
	return new Promise<CreateDocumentExporter>((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("Export document failed to start in time"));
		}, 8000);

		function cleanup() {
			clearTimeout(timeout);
			signal.removeEventListener("abort", onAbort);
			frame.removeEventListener("load", onLoad);
		}

		function onAbort() {
			cleanup();
			reject(signal.reason);
		}

		function onLoad() {
			cleanup();
			try {
				const create = (frame.contentWindow as DocumentExportWindow | null)?.createDocumentExporter;
				if (!create) throw new Error("Export document did not expose its entry point");
				resolve(create);
			} catch (error) {
				reject(error);
			}
		}

		signal.addEventListener("abort", onAbort, { once: true });
		frame.addEventListener("load", onLoad, { once: true });
		document.body.appendChild(frame);
	});
}

export class DocumentVideoExporter {
	private readonly controller = new AbortController();
	private exporter?: DocumentExporter;

	constructor(private readonly config: ExporterConfig) {}

	cancel(): void {
		this.controller.abort();
		this.exporter?.cancel();
	}

	async export(): Promise<ExportResult> {
		const { signal } = this.controller;
		const cancelled = { success: false, error: "Export cancelled" };
		if (signal.aborted) return cancelled;

		const frame = document.createElement("iframe");
		frame.setAttribute("sandbox", "allow-same-origin allow-scripts");
		frame.setAttribute("aria-hidden", "true");
		frame.tabIndex = -1;
		frame.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0";
		frame.src = "/export-frame.html";

		try {
			try {
				const create = await loadExportDocument(frame, signal);
				if (signal.aborted) return cancelled;
				const exportApi = Object.freeze(Object.fromEntries(
					exportMethods.map(method => [method, window.electronAPI[method]]),
				)) as ExportApi;
				this.exporter = create(this.config, exportApi);
			} catch (error) {
				if (signal.aborted) return cancelled;
				console.warn("[Export] Could not initialize the export document", error);
				frame.remove();
				const { ModernVideoExporter } = await import("./modernVideoExporter");
				if (signal.aborted) return cancelled;
				// The editor may already have a WebGL batch shader cached with different limits.
				const fallbackConfig = /^linux/i.test(navigator.platform)
					? { ...this.config, preferredRenderBackend: "webgl" as const }
					: this.config;
				this.exporter = new ModernVideoExporter(fallbackConfig);
			}

			// The exporter owns stream cleanup. Release its document after that cleanup completes.
			return await this.exporter.export();
		} finally {
			this.exporter = undefined;
			frame.remove();
		}
	}
}
