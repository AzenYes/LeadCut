import fs from "node:fs";
import path from "node:path";

const templateRoot = path.resolve("node_modules/app-builder-lib/templates/nsis");
const original = fs.readFileSync(path.join(templateRoot, "multiUser.nsh"), "utf8");
const unsafeStart = original.indexOf("      System::Store S");
const unsafeEnd = original.indexOf("      System::Store L", unsafeStart);
const alreadySafe = original.includes("KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p");
if (!alreadySafe && (unsafeStart < 0 || unsafeEnd < unsafeStart)) {
	throw new Error("NSIS template changed; review whether the path-copy backport is still needed.");
}
const safeCopy = `      # Bounded path copy from electron-builder #9769 (MIT).
      # https://github.com/electron-userland/electron-builder/commit/a356198ec7c54c7795659342bff36d9a5162cd93
      Push $1
      Push $2
      StrCpy $2 0
      System::Call 'SHELL32::SHGetKnownFolderPath(g "\${FOLDERID_UserProgramFiles}", i \${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'
      \${If} $1 == 0
        System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i \${NSIS_MAX_STRLEN})p'
      \${EndIf}
      \${If} $2 != 0
        System::Call 'OLE32::CoTaskMemFree(p r2)'
      \${EndIf}
      Pop $2
      Pop $1`;
const patched = alreadySafe ? original : original.slice(0, unsafeStart) + safeCopy + original.slice(unsafeEnd + "      System::Store L".length);
const outputRoot = path.resolve("build/nsis");
fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, "multiUser.nsh"), patched);
fs.copyFileSync("node_modules/electron-builder/LICENSE", path.join(outputRoot, "LICENSE.electron-builder.txt"));
// NSIS searches the toolchain's built-in include directory before added project
// include directories. Apply the same narrow fix to its actual compile input.
fs.writeFileSync(path.join(templateRoot, "multiUser.nsh"), patched);
console.log("Prepared NSIS template with bounded per-user directory copy.");
