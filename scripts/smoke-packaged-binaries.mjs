import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { listPackage, statFile } from "@electron/asar";

const projectRoot = process.cwd();
const releaseRoot = path.resolve(process.argv[2] ?? "release");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const productName = packageJson.productName ?? packageJson.name ?? "LeadCut";
const packageName = packageJson.name ?? "leadcut";

function relativePath(filePath) {
	return path.relative(projectRoot, filePath).replaceAll("\\", "/");
}

function fail(message) {
	throw new Error(`[packaged-smoke] ${message}`);
}

function verifyApplicationArchive(unpackedRoot) {
	if (process.platform !== "win32") return;
	const archive = path.join(path.dirname(unpackedRoot), "app.asar");
	const maxBytes = 24 * 1024 * 1024;
	const size = statSync(archive).size;
	const largestFiles = listPackage(archive).map(filename => {
		const name = filename.replace(/^[/\\]/, "");
		return { name, entry: statFile(archive, name, false) };
	}).filter(({ entry }) => !entry.unpacked && typeof entry.size === "number")
		.sort((left, right) => right.entry.size - left.entry.size)
		.slice(0, 20);
	console.log(`[packaged-smoke] app.asar: ${size} bytes (budget ${maxBytes})`);
	for (const { name, entry } of largestFiles) console.log(`  ${entry.size}\t${name}`);
	if (size > maxBytes) fail("app.asar exceeded its Windows size budget");
}

function assertFile(filePath, label, { executable = false } = {}) {
	if (!existsSync(filePath)) {
		fail(`${label} is missing at ${relativePath(filePath)}`);
	}

	if (!statSync(filePath).isFile()) {
		fail(`${label} is not a file at ${relativePath(filePath)}`);
	}

	if (executable && process.platform !== "win32") {
		try {
			accessSync(filePath, constants.X_OK);
		} catch {
			fail(`${label} is not executable at ${relativePath(filePath)}`);
		}
	}

	console.log(`[packaged-smoke] ${label}: ${relativePath(filePath)}`);
}

function findDirectoriesByName(rootDir, directoryName, maxDepth = 8) {
	if (!existsSync(rootDir)) {
		return [];
	}

	const matches = [];
	const queue = [{ dir: rootDir, depth: 0 }];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || current.depth > maxDepth) {
			continue;
		}

		for (const entry of readdirSync(current.dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}

			const childDir = path.join(current.dir, entry.name);
			if (entry.name === directoryName) {
				matches.push(childDir);
				continue;
			}

			queue.push({ dir: childDir, depth: current.depth + 1 });
		}
	}

	return matches;
}

function findAppBundleDir(startDir) {
	let current = startDir;
	while (current !== path.dirname(current)) {
		if (current.endsWith(".app")) {
			return current;
		}
		current = path.dirname(current);
	}

	return null;
}

function findFirstExistingFile(candidates) {
	return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function assertPackagedAppExecutable(unpackedRoot) {
	const resourcesDir = path.dirname(unpackedRoot);

	if (process.platform === "darwin") {
		const appBundleDir = findAppBundleDir(resourcesDir);
		if (!appBundleDir) {
			fail(`macOS app bundle not found for ${relativePath(unpackedRoot)}`);
		}

		const executablePath = findFirstExistingFile([
			path.join(appBundleDir, "Contents", "MacOS", productName),
			path.join(appBundleDir, "Contents", "MacOS", packageName),
		]);
		assertFile(
			executablePath ?? path.join(appBundleDir, "Contents", "MacOS", productName),
			"packaged app executable",
			{ executable: true },
		);
		return;
	}

	const appDir = path.dirname(resourcesDir);
	const executableCandidates =
		process.platform === "win32"
			? [
					path.join(appDir, `${productName}.exe`),
					path.join(appDir, `${packageName}.exe`),
				]
			: [
					path.join(appDir, packageName),
					path.join(appDir, productName),
					path.join(appDir, productName.toLowerCase()),
				];

	const executablePath = findFirstExistingFile(executableCandidates);
	assertFile(executablePath ?? executableCandidates[0], "packaged app executable", {
		executable: true,
	});
}

function getNativeArchTag(platform = process.platform, arch = process.arch) {
	if (platform === "darwin") {
		return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	}

	if (platform === "win32") {
		return arch === "arm64" ? "win32-arm64" : "win32-x64";
	}

	if (platform === "linux") {
		return arch === "arm64" ? "linux-arm64" : "linux-x64";
	}

	return `${platform}-${arch}`;
}

function getRequiredArchTags() {
	const configured = process.env.PACKAGED_SMOKE_ARCH_TAGS?.trim();
	if (!configured) {
		return [getNativeArchTag()];
	}

	return [
		...new Set(
			configured
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	];
}

function getExpectedNativeHelperFiles(archTag) {
	if (archTag.startsWith("win32-")) {
		const helpers = [
			{ name: "wgc-capture.exe", label: "Windows capture helper", executable: true },
			{
				name: "cursor-monitor.exe",
				label: "Windows cursor monitor helper",
				executable: true,
			},
			{
				name: "leadcut-gpu-export.exe",
				label: "Windows GPU export helper",
				executable: true,
			},
			{ name: "helpers-manifest.json", label: "Windows helper manifest" },
			{ name: "leadcut-local-font-catalog.exe", label: "Windows local font catalog", executable: true },
			{ name: "whisper-cli.exe", label: "Whisper CLI runtime", executable: true },
			{ name: "whisper-runtime.json", label: "Whisper runtime manifest" },
		];
		if (archTag === "win32-x64") {
			helpers.push({
				name: "recordly-nvidia-cuda-compositor.exe",
				label: "NVIDIA CUDA compositor helper",
				executable: true,
			});
		}
		return helpers;
	}

	if (archTag.startsWith("darwin-")) {
		return [
			{
				name: "leadcut-screencapturekit-helper",
				label: "ScreenCaptureKit helper",
				executable: true,
			},
			{ name: "leadcut-window-list", label: "Window list helper", executable: true },
			{ name: "leadcut-system-cursors", label: "System cursor helper", executable: true },
			{
				name: "leadcut-native-cursor-monitor",
				label: "Native cursor monitor helper",
				executable: true,
			},
			{ name: "whisper-cli", label: "Whisper CLI runtime", executable: true },
			{ name: "whisper-runtime.json", label: "Whisper runtime manifest" },
		];
	}

	if (archTag.startsWith("linux-")) {
		return [
			{ name: "whisper-cli", label: "Whisper CLI runtime", executable: true },
			{ name: "whisper-runtime.json", label: "Whisper runtime manifest" },
		];
	}

	return [];
}

function verifyMediaBinaries(unpackedRoot) {
	const extension = process.platform === "win32" ? ".exe" : "";
	const mediaTools = path.join(path.dirname(unpackedRoot), "media-tools");
	const sharedRuntime = process.platform === "win32" && existsSync(mediaTools);
	const binaries = sharedRuntime ? [
		["ffmpeg", path.join(mediaTools, "ffmpeg.exe")],
		["ffprobe", path.join(mediaTools, "ffprobe.exe")],
	] : [
		["ffmpeg", path.join(unpackedRoot, "node_modules", "ffmpeg-static", `ffmpeg${extension}`)],
		["ffprobe", path.join(unpackedRoot, "node_modules", "ffprobe-static", "bin", process.platform, process.arch, `ffprobe${extension}`)],
	];
	for (const [name, executable] of binaries) {
		assertFile(executable, `packaged ${name} binary`, { executable: true });
		const output = execFileSync(executable, ["-version"], {
			encoding: "utf8",
			timeout: 15000,
			windowsHide: true,
		});
		if (!output.startsWith(`${name} version`)) {
			fail(`${name} version smoke returned unexpected output from ${relativePath(executable)}`);
		}
		console.log(output.split(/\r?\n/, 1)[0]);
	}
	if (sharedRuntime) {
		const executable = path.join(mediaTools, "ffmpeg.exe");
		const required = {
			encoders: ["libx264", "h264_nvenc", "h264_qsv", "h264_amf", "h264_mf", "aac", "gif", "png"],
			decoders: ["libdav1d", "h264", "hevc", "vp9", "opus", "png"],
			filters: ["scale_cuda", "overlay_cuda", "hwupload_cuda", "amix", "palettegen", "paletteuse"],
		};
		for (const [flag, names] of Object.entries(required)) {
			const output = execFileSync(executable, ["-hide_banner", `-${flag}`], {
				encoding: "utf8", timeout: 15000, windowsHide: true,
			});
			const options = new Set(output.split(/\r?\n/).map(line => line.trim().split(/\s+/, 3)[1]));
			for (const name of names) {
				if (!options.has(name)) fail(`packaged FFmpeg -${flag} is missing ${name}`);
			}
		}
	}
}

function verifyNativeHelpers(unpackedRoot) {
	const nativeBinRoot = path.join(unpackedRoot, "electron", "native", "bin");
	if (!existsSync(nativeBinRoot)) {
		fail(`native helper bin directory is missing at ${relativePath(nativeBinRoot)}`);
	}

	for (const archTag of getRequiredArchTags()) {
		const archDir = path.join(nativeBinRoot, archTag);
		if (!existsSync(archDir)) {
			fail(`native helper arch directory is missing at ${relativePath(archDir)}`);
		}

		const expectedFiles = getExpectedNativeHelperFiles(archTag);
		if (expectedFiles.length === 0) {
			fail(`no packaged helper expectations are defined for ${archTag}`);
		}

		for (const expectedFile of expectedFiles) {
			const executable = path.join(archDir, expectedFile.name);
			assertFile(
				executable,
				`${expectedFile.label} (${archTag})`,
				{
					executable: expectedFile.executable,
				},
			);
			if (archTag === `${process.platform}-${process.arch}` && /^whisper-cli(?:\.exe)?$/.test(expectedFile.name)) {
				execFileSync(executable, ["--help"], { timeout: 15000, windowsHide: true, stdio: "pipe" });
			}
		}
		if (archTag === "win32-x64") {
			assertFile(
				path.join(
					unpackedRoot,
					"electron",
					"native",
					"nvidia-cuda-compositor",
					"run-mp4-pipeline.mjs",
				),
				"NVIDIA CUDA MP4 export script",
			);
		}
	}
}

const unpackedRoots = findDirectoriesByName(releaseRoot, "app.asar.unpacked");

if (unpackedRoots.length === 0) {
	fail("no packaged app.asar.unpacked directory found under release/");
}

console.log(
	`[packaged-smoke] verifying ${unpackedRoots.length} packaged app root(s) for ${process.platform}/${process.arch}`,
);

for (const unpackedRoot of unpackedRoots) {
	console.log(`[packaged-smoke] root: ${relativePath(unpackedRoot)}`);
	assertPackagedAppExecutable(unpackedRoot);
	verifyApplicationArchive(unpackedRoot);
	verifyMediaBinaries(unpackedRoot);
	verifyNativeHelpers(unpackedRoot);
}

console.log("[packaged-smoke] packaged binary path smoke passed");
