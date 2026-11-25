const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Arch } = require("builder-util");
const optimizePackagedWallpapers = require("./optimize-packaged-wallpapers.cjs");

module.exports = async function preparePackagedResources(context) {
	await optimizePackagedWallpapers(context);
	const mediaTools = process.env.LEADCUT_WINDOWS_MEDIA_TOOLS_DIR;
	if (!mediaTools || context.electronPlatformName !== "win32" || context.arch !== Arch.x64) return;

	const manifest = await fs.readFile(path.join(mediaTools, "SHA256SUMS.txt"), "utf8");
	const payload = manifest.trim().split(/\r?\n/).map(line => {
		const match = /^([a-f0-9]{64})\s+([a-z0-9-]+\.(?:dll|exe))$/i.exec(line);
		if (!match) throw new Error(`Invalid Windows media tools manifest entry: ${line}`);
		return { digest: match[1].toLowerCase(), filename: match[2] };
	});
	const filenames = new Set(payload.map(({ filename }) => filename));
	if (!filenames.has("ffmpeg.exe") || !filenames.has("ffprobe.exe") || filenames.size !== payload.length) {
		throw new Error("The Windows media tools manifest must list both command-line tools and contain unique files");
	}

	const resources = path.join(context.appOutDir, "resources");
	const destination = path.join(resources, "media-tools");
	await fs.mkdir(destination, { recursive: true });
	for (const { digest, filename } of payload) {
		const buffer = await fs.readFile(path.join(mediaTools, filename));
		if (createHash("sha256").update(buffer).digest("hex") !== digest) {
			throw new Error(`Windows media tool checksum does not match: ${filename}`);
		}
		await fs.writeFile(path.join(destination, filename), buffer);
	}
	await fs.cp(path.join(mediaTools, "licenses"), path.join(destination, "licenses"), { recursive: true });

	const unpackedModules = path.join(resources, "app.asar.unpacked", "node_modules");
	await fs.rm(path.join(unpackedModules, "ffmpeg-static", "ffmpeg.exe"), { force: true });
	await fs.rm(path.join(unpackedModules, "ffprobe-static", "bin", "win32", "x64", "ffprobe.exe"), { force: true });
};
