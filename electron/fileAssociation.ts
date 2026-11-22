import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { win32 as path } from "node:path";
import { promisify } from "node:util";
import { UPSTREAM_PROJECT_FILE_EXTENSION } from "../src/lib/projectFileExtensions";

const run = promisify(execFile);
const classes = "HKCU\\Software\\Classes";
const progId = "LeadCut.Project";
const thumbnailHandler = "{E357FCCD-A995-4576-B01F-234630154E96}";
const provider = "{D5A734BF-6859-4714-93AE-5987592B82CC}";
const providerName = "LeadCut Project Thumbnail Provider";
const approved = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Approved";

type RegistryValue = {
	key: string;
	name?: string;
	type: "REG_SZ" | "REG_NONE" | "REG_DWORD";
	data: string;
};

export function expectedProjectAssociation(executable: string): RegistryValue[] {
	const extension = classes + "\\.leadcut";
	const project = classes + "\\" + progId;
	const clsid = classes + "\\CLSID\\" + provider;
	const resources = path.join(path.dirname(executable), "resources");
	const dll = path.join(resources, "LeadCutThumbnail.dll");
	return [
		{ key: extension, type: "REG_SZ", data: progId },
		{ key: extension + "\\OpenWithProgids", name: progId, type: "REG_NONE", data: "" },
		{ key: project, type: "REG_SZ", data: "LeadCut 工程" },
		{ key: project, name: "Treatment", type: "REG_DWORD", data: "0x0" },
		{ key: project + "\\shell", type: "REG_SZ", data: "open" },
		{ key: project + "\\shell\\open", type: "REG_SZ", data: "Open with LeadCut" },
		{ key: project + "\\shell\\open\\command", type: "REG_SZ", data: '"' + executable + '" "%1"' },
		{ key: project + "\\DefaultIcon", type: "REG_SZ", data: '"' + path.join(resources, "leadcut-project.ico") + '",0' },
		{ key: clsid, type: "REG_SZ", data: providerName },
		{ key: clsid + "\\InprocServer32", type: "REG_SZ", data: dll },
		{ key: clsid + "\\InprocServer32", name: "ThreadingModel", type: "REG_SZ", data: "Both" },
		{ key: extension + "\\ShellEx\\" + thumbnailHandler, type: "REG_SZ", data: provider },
		{ key: project + "\\ShellEx\\" + thumbnailHandler, type: "REG_SZ", data: provider },
		{ key: approved, name: provider, type: "REG_SZ", data: providerName },
	];
}

type RegistryAddress = Pick<RegistryValue, "key" | "name">;
type ReadRegistry = (addresses: RegistryAddress[]) => Promise<Array<{ type: string | null; data: string }>>;
type RunRegistry = (args: string[]) => Promise<void>;
const systemDirectory = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
const powershell = path.join(systemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
const runRegistry: RunRegistry = async args => {
	await run(path.join(systemDirectory, "reg.exe"), [...args, "/reg:64"], { windowsHide: true, timeout: 5000 });
};

// reg.exe redirects query output in the system code page, which can corrupt
// an installation path in another language. Read typed values in one UTF-8 batch.
export const readProjectRegistryValues: ReadRegistry = async addresses => {
	const script = [
		"$ErrorActionPreference = 'Stop'",
		"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
		"$hive = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser', 'Registry64')",
		"$results = @(foreach ($address in (ConvertFrom-Json $env:LEADCUT_ASSOCIATION_QUERY)) {",
		"  $key = $hive.OpenSubKey($address.key.Substring(5))",
		"  $name = [string]$address.name",
		"  try {",
		"    if (-not $key -or $key.GetValueNames() -notcontains $name) {",
		"      [pscustomobject]@{ type = $null; data = '' }",
		"      continue",
		"    }",
		"    $type = switch ($key.GetValueKind($name).ToString()) {",
		"      'String' { 'REG_SZ' } 'DWord' { 'REG_DWORD' } 'None' { 'REG_NONE' } default { 'OTHER' }",
		"    }",
		"    $data = if ($type -eq 'REG_DWORD') { '0x{0:x}' -f $key.GetValue($name) }",
		"      elseif ($type -eq 'REG_SZ') { $key.GetValue($name) } else { '' }",
		"    [pscustomobject]@{ type = $type; data = [string]$data }",
		"  } finally { if ($key) { $key.Dispose() } }",
		"})",
		"$hive.Dispose()",
		"ConvertTo-Json -InputObject $results -Compress",
	].join("\n");
	const { stdout } = await run(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
		windowsHide: true, timeout: 10000,
		env: { ...process.env, LEADCUT_ASSOCIATION_QUERY: JSON.stringify(addresses) },
	});
	const values: Awaited<ReturnType<ReadRegistry>> = JSON.parse(stdout);
	if (values.length !== addresses.length) throw new Error("Incomplete Windows registry response");
	return values;
};

export async function repairWindowsProjectAssociation(
	executable: string,
	read = readProjectRegistryValues,
	registry = runRegistry,
): Promise<boolean> {
	const expected = expectedProjectAssociation(executable);
	const legacy = classes + "\\." + UPSTREAM_PROJECT_FILE_EXTENSION;
	const legacyEntries = [
		{ key: legacy, name: undefined, ownedData: progId },
		{ key: legacy + "\\OpenWithProgids", name: progId, ownedData: undefined },
		{ key: legacy + "\\ShellEx\\" + thumbnailHandler, name: undefined, ownedData: provider },
	];
	const values = await read([...expected, ...legacyEntries].map(({ key, name }) => ({ key, name })));
	let changed = false;
	for (const [index, { key, name, type, data }] of expected.entries()) {
		const actual = values[index];
		if (actual.type === type && (type === "REG_NONE" || actual.data === data)) continue;
		await registry([
			"add", key, ...(name === undefined ? ["/ve"] : ["/v", name]),
			"/t", type, ...(type === "REG_NONE" ? [] : ["/d", data]), "/f",
		]);
		changed = true;
	}
	for (const [index, { key, name, ownedData }] of legacyEntries.entries()) {
		const actual = values[index + expected.length];
		if (!actual.type || (ownedData !== undefined && actual.data.toLowerCase() !== ownedData.toLowerCase())) continue;
		await registry(["delete", key, ...(name === undefined ? ["/ve"] : ["/v", name]), "/f"]);
		changed = true;
	}
	return changed;
}

export async function repairInstalledProjectAssociation(executable: string) {
	// An unpacked build is useful for testing and should not take over Explorer associations.
	try {
		await access(path.join(path.dirname(executable), "Uninstall LeadCut.exe"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	if (!(await repairWindowsProjectAssociation(executable))) return;
	const notify = [
		'Add-Type -TypeDefinition @"',
		"using System; using System.Runtime.InteropServices;",
		"public static class LeadCutShell {",
		'  [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint id, uint flags, IntPtr one, IntPtr two);',
		"}",
		'"@',
		"[LeadCutShell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)",
	].join("\n");
	await run(powershell, [
		"-NoProfile", "-NonInteractive", "-Command", notify,
	], { windowsHide: true, timeout: 10000 });
}
