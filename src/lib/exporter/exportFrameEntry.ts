import "@/index.css";
import type { DocumentExportWindow } from "./documentVideoExporter";
import { ModernVideoExporter } from "./modernVideoExporter";

if (
	window.parent === window ||
	window.parent.location.origin !== window.location.origin ||
	new URL(window.parent.location.href).searchParams.get("windowType") !== "editor" ||
	"electronAPI" in window
) {
	throw new Error("The export document must run within the LeadCut editor");
}

(window as DocumentExportWindow).createDocumentExporter = (config, exportApi) => {
	Object.defineProperty(window, "electronAPI", { value: exportApi });
	const useGpuFramePipeline = /^win/i.test(navigator.platform) && config.frameRate >= 60 && config.width * config.height >= 3840 * 2160;
	return new ModernVideoExporter({ ...config, useGpuFramePipeline });
};
