import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const roots = [
	"electron", "src", "scripts", "services/leadcut-mcp/src", "index.html", "electron-builder.json5",
	"build/installer.nsh", "package.json", "vite.config.ts", "playwright.config.ts",
];

const allowed = new Map<string, string>([
	["electron-builder.json5", "Packages the upstream CUDA helper under its existing binary name"],
	["index.html", "Reads a legacy theme before renderer migration"],
	["package.json", "Upstream project URL"],
	["build/installer.nsh", "Cleans file associations written by an earlier LeadCut version"],
	["electron/appIdentity.ts", "Documents profile isolation from the upstream application"],
	["electron/envCompat.ts", "Reads legacy environment variables"],
	["electron/ipc/export/native-video.ts", "Uses the legacy helper as fallback and passes old names to CUDA"],
	["electron/ipc/paths/binaries.ts", "Migrates legacy helper filenames"],
	["electron/ipc/recording/interruptedRecording.ts", "Recovers files from journals written by the prior version"],
	["electron/ipc/recording/library.ts", "Recognizes old reversible trash staging folders"],
	["electron/ipc/recording/recordingFileNames.ts", "Reads old recording manifests and imported sources"],
	["electron/native/bin/win32-x64/helpers-manifest.json", "Preserves the bundled CUDA helper name"],
	["electron/native/gpu-export-probe/CMakeLists.txt", "Retains the native source and artifact fingerprint"],
	["electron/native/gpu-export-probe/src/main.cpp", "Retains the native source and artifact fingerprint"],
	["electron/native/nvidia-cuda-compositor/CMakeLists.txt", "Retains the CUDA build contract"],
	["electron/native/nvidia-cuda-compositor/run-mp4-pipeline.mjs", "Retains the bundled CUDA filename and environment contract"],
	["electron/native/nvidia-cuda-compositor/src/main.cu", "Retains the CUDA build contract"],
	["electron/native/ScreenCaptureKitRecorder.swift", "Retains diagnostic identifiers of the prebuilt macOS recorder"],
	["scripts/benchmark-leadcut-editor.mjs", "Measures a legacy installation with its supported profile and extension"],
	["scripts/build-nvidia-cuda-compositor.mjs", "Finds and validates the unchanged CUDA helper"],
	["scripts/package-leadcut-source.py", "Includes upstream attribution in source archives"],
	["scripts/smoke-leadcut-export.mjs", "Supports native export on an older installed benchmark build"],
	["scripts/smoke-packaged-binaries.mjs", "Verifies the unchanged CUDA helper is packaged"],
	["services/leadcut-mcp/src/media.ts", "Credits the upstream caption segmentation behavior"],
	["services/leadcut-mcp/src/paths.ts", "Recognizes legacy project files and user-data override"],
	["src/components/video-editor/projectPersistence.ts", "Migrates the legacy easing value"],
	["src/components/video-editor/videoPlayback/motionSmoothing.ts", "Preserves upstream licensing notice"],
	["src/lib/projectFileExtensions.ts", "Recognizes legacy project extensions"],
	["src/lib/storageKeys.ts", "Contains legacy settings keys for migration"],
	...["de", "en", "es", "fr", "it", "ko", "nl", "pt-BR", "ru", "zh-CN", "zh-TW"].map(locale =>
		[`src/i18n/locales/${locale}/settings.json`, "Preserves upstream attribution in About"] as [string, string]
	),
]);

const ignoredDirectories = new Set(["build", "node_modules", "tests", "__pycache__"]);
const textExtension = /\.(?:[cm]?[jt]sx?|json5?|css|scss|html|svg|md|txt|cmake|cpp|cu|h|hpp|c|swift|py|ps1|nsh|sh|yml|yaml)$/i;

function sourceFiles(relativePath: string): string[] {
	if (!fs.statSync(relativePath).isDirectory()) {
		return textExtension.test(relativePath) && !/\.test\.[^.]+$/i.test(relativePath)
			? [relativePath] : [];
	}
	return fs.readdirSync(relativePath, { withFileTypes: true }).flatMap(entry =>
		entry.isSymbolicLink() || ignoredDirectories.has(entry.name)
			? [] : sourceFiles(path.posix.join(relativePath, entry.name)),
	);
}

it("uses LeadCut naming outside upstream attribution and explicit compatibility paths", () => {
	const unexpected = roots.flatMap(sourceFiles).filter(file =>
		!allowed.has(file) && /recordly/i.test(fs.readFileSync(file, "utf8")),
	);
	expect(unexpected).toEqual([]);
});
