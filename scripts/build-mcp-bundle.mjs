import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const service = path.join(root, "services", "leadcut-mcp");
if (!existsSync(path.join(service, "node_modules", "@modelcontextprotocol", "sdk", "package.json"))) {
	execFileSync(process.execPath, [process.env.npm_execpath, "ci", "--ignore-scripts", "--prefer-offline"], {
		cwd: service,
		stdio: "inherit",
		windowsHide: true,
	});
}
await build({
	absWorkingDir: root,
	entryPoints: ["services/leadcut-mcp/src/index.ts"],
	outfile: ".tmp/leadcut-mcp-bundle/index.cjs",
	bundle: true,
	platform: "node",
	target: "node22",
	format: "cjs",
	define: { "import.meta.url": "__leadcutModuleUrl" },
	banner: { js: "const __leadcutModuleUrl = require('node:url').pathToFileURL(__filename).href;" },
});
