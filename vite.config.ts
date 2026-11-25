import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin as EsbuildPlugin } from "esbuild";
import { defineConfig, normalizePath, type Plugin } from "vite";
import electron from "vite-plugin-electron/simple";

const pixiModuleRoot = "/node_modules/pixi.js/lib/";
const pixiRendererPatches = new Map<string, [string, string][]>([
	["utils/browser/isWebGPUSupported.mjs", [
		// Pixi 8.14 checks device creation once per document and discards the result.
		["await adapter.requestDevice();", "const probeDevice = await adapter.requestDevice();\n      probeDevice.destroy();"],
	]],
	["rendering/batcher/shared/DefaultBatcher.mjs", [
		// A WebGL preview and a WebGPU export can have different texture limits.
		["let defaultShader = null;", "const defaultShaders = new Map();"],
		["defaultShader ?? (defaultShader = new DefaultShader(options.maxTextures));\n    this.shader = defaultShader;",
			"let shader = defaultShaders.get(options.maxTextures);\n    if (!shader) {\n      shader = new DefaultShader(options.maxTextures);\n      defaultShaders.set(options.maxTextures, shader);\n    }\n    this.shader = shader;"],
	]],
	["rendering/batcher/gpu/getTextureBatchBindGroup.mjs", [
		["return cachedGroups[uid] || generateTextureBatchBindGroup(textures, size, uid, maxTextures);",
			"const key = `${maxTextures}:${uid}`;\n  return cachedGroups[key] || generateTextureBatchBindGroup(textures, size, key, maxTextures);"],
	]],
]);

function getPixiRendererPatches(filename: string) {
	const normalized = normalizePath(filename);
	const offset = normalized.lastIndexOf(pixiModuleRoot);
	return offset < 0 ? undefined : pixiRendererPatches.get(normalized.slice(offset + pixiModuleRoot.length));
}

function applyPixiRendererPatches(source: string, filename: string, patches: [string, string][]): string {
	for (const [original, replacement] of patches) {
		if (!source.includes(original)) throw new Error(`Review the LeadCut patch for ${path.basename(filename)} after updating pixi.js`);
		source = source.replace(original, replacement);
	}
	return source;
}

function pixiRendererCompatibility(): Plugin {
	return {
		name: "leadcut-pixi-renderer-compatibility",
		enforce: "pre",
		transform(source, id) {
			const patches = getPixiRendererPatches(id);
			if (patches) return applyPixiRendererPatches(source, id, patches);
		},
	};
}

const prebundlePixiRendererCompatibility: EsbuildPlugin = {
	name: "leadcut-pixi-renderer-compatibility",
	setup(build) {
		build.onLoad({ filter: /(?:isWebGPUSupported|DefaultBatcher|getTextureBatchBindGroup)\.mjs$/ }, async ({ path: filename }) => {
			const patches = getPixiRendererPatches(filename);
			if (!patches) return;
			return {
				contents: applyPixiRendererPatches(await readFile(filename, "utf8"), filename, patches),
				loader: "js",
				resolveDir: path.dirname(filename),
			};
		});
	},
};

function electronMainCjsOutputPlugin(): Plugin {
	return {
		name: "leadcut-electron-main-cjs-output",
		enforce: "post",
		config(config) {
			// Vite mergeConfig concatenates lib.formats with the plugin's ESM default.
			config.build ??= {};
			const build = config.build;
			const lib = build.lib;
			if (lib && typeof lib === "object") {
				lib.formats = ["cjs"];
				lib.fileName = (_format, entryName) => `${entryName}.cjs`;
			}

			build.rollupOptions ??= {};
			const rollupOptions = build.rollupOptions;
			const cjsOutput = {
				format: "cjs" as const,
				inlineDynamicImports: true,
				entryFileNames: "[name].cjs",
				chunkFileNames: "[name]-[hash].cjs",
			};

			rollupOptions.output = Array.isArray(rollupOptions.output)
				? rollupOptions.output.map((output) => ({ ...output, ...cjsOutput }))
				: { ...(rollupOptions.output ?? {}), ...cjsOutput };
		},
	};
}

function electronMainCjsGuardPlugin(): Plugin {
	return {
		name: "leadcut-electron-main-cjs-guard",
		closeBundle() {
			const scriptPath = path.resolve(__dirname, "scripts/smoke-electron-main-cjs.mjs");
			const result = spawnSync(process.execPath, [scriptPath], {
				cwd: __dirname,
				encoding: "utf8",
			});

			if (result.status !== 0) {
				const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
				throw new Error(
					`Electron main CJS smoke failed after Vite build.${details ? `\n${details}` : ""}`,
				);
			}
		},
	};
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
	server: {
		watch: process.env.LEADCUT_RENDERER_ONLY === "1"
			? null
			: { ignored: ["**/electron/native/**", "**/release/**", "**/dist/**", "**/dist-electron/**", "**/test-results/**", "**/playwright-report/**", "**/.tmp/**", "**/.code/**"] },
	},
	plugins: [
		react(),
		pixiRendererCompatibility(),
		...(mode === "ui" || process.env.LEADCUT_RENDERER_ONLY === "1"
			? []
			: [
					electron({
						main: {
							// Shortcut of `build.lib.entry`.
							entry: "electron/main.ts",
							vite: {
								build: {
									lib: {
										entry: "electron/main.ts",
										formats: ["cjs"],
										fileName: (_format, entryName) => `${entryName}.cjs`,
									},
									rollupOptions: {
										external: ["ffmpeg-static", "uiohook-napi"],
										output: {
											format: "cjs",
											inlineDynamicImports: true,
											entryFileNames: "[name].cjs",
											chunkFileNames: "[name]-[hash].cjs",
										},
									},
								},
								plugins: [
									electronMainCjsOutputPlugin(),
									electronMainCjsGuardPlugin(),
								],
							},
						},
						preload: {
							// Shortcut of `build.rollupOptions.input`.
							// Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
							input: path.join(__dirname, "electron/preload.ts"),
							vite: {
								build: {
									rollupOptions: {
										output: { format: "cjs", entryFileNames: "[name].cjs" },
									},
								},
							},
						},
						// Polyfill the Electron and Node.js API for the renderer process.
						// If you want to use Node.js in the renderer process, enable `nodeIntegration` in the main process.
						// See https://github.com/electron-vite/vite-plugin-electron-renderer
						renderer:
							process.env.NODE_ENV === "test"
								? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
									undefined
								: {},
					}),
				]),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	optimizeDeps: {
		entries: ["index.html"],
		esbuildOptions: { plugins: [prebundlePixiRendererCompatibility] },
		// React Aria imports this CommonJS shim through its ESM collection modules.
		include: ["use-sync-external-store/shim"],
		exclude: [
			"react-icons/bs",
			"react-icons/fa",
			"react-icons/fa6",
			"react-icons/fi",
			"react-icons/md",
			"react-icons/rx",
		],
	},
	build: {
		target: "esnext",
		minify: "terser",
		terserOptions: {
			compress: {
				drop_console: true,
				drop_debugger: true,
				pure_funcs: ["console.log", "console.debug"],
			},
		},
		rollupOptions: {
			input: {
				app: path.resolve(__dirname, "index.html"),
				exportFrame: path.resolve(__dirname, "export-frame.html"),
			},
			output: {
				manualChunks: {
					"react-vendor": ["react", "react-dom"],
					"video-processing": ["mediabunny", "mp4box", "@fix-webm-duration/fix"],
				},
			},
		},
		chunkSizeWarningLimit: 1000,
	},
}));
