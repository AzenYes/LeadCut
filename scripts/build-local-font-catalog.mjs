import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

if (process.platform !== "win32") process.exit(0);

const root = process.cwd();
const source = path.join(root, "electron/native/local-font-catalog");
const vswhere = path.join(
	process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
	"Microsoft Visual Studio/Installer/vswhere.exe",
);
const [install] = JSON.parse(
	execFileSync(
		vswhere,
		[
			"-latest",
			"-products",
			"*",
			"-requires",
			"Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
			"-format",
			"json",
			"-utf8",
		],
		{ encoding: "utf8" },
	),
);
const version = install?.installationVersion.split(".")[0];
const generator = { 17: "Visual Studio 17 2022", 18: "Visual Studio 18 2026" }[version];
if (!generator)
	throw new Error("Visual Studio 2022 or 2026 is required for the local font catalog.");
const cmake = path.join(
	install.installationPath,
	"Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe",
);
if (!existsSync(cmake))
	throw new Error("Install the Visual Studio C++ CMake tools to build the local font catalog.");

const arm64 = process.arch === "arm64";
const build = path.join(source, "build", `vs${version}-${arm64 ? "arm64" : "x64"}`);
execFileSync(cmake, ["-S", source, "-B", build, "-G", generator, "-A", arm64 ? "ARM64" : "x64"], {
	stdio: "inherit",
});
execFileSync(cmake, ["--build", build, "--config", "Release"], { stdio: "inherit" });
const output = path.join(root, "electron/native/bin", arm64 ? "win32-arm64" : "win32-x64");
mkdirSync(output, { recursive: true });
const binary = "leadcut-local-font-catalog.exe";
copyFileSync(path.join(build, "Release", binary), path.join(output, binary));
