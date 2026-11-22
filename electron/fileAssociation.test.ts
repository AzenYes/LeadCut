import { expect, it, vi } from "vitest";
import { expectedProjectAssociation, repairWindowsProjectAssociation } from "./fileAssociation";

const executable = "C:\\Program Files\\LeadCut\\LeadCut.exe";
const classes = "HKCU\\Software\\Classes";
const thumbnailProvider = "{D5A734BF-6859-4714-93AE-5987592B82CC}";
const shellThumbnail = "{E357FCCD-A995-4576-B01F-234630154E96}";
const extension = classes + "\\.leadcut";
const project = classes + "\\LeadCut.Project";

it("matches the per-user NSIS registration and quotes paths with spaces", () => {
	expect(expectedProjectAssociation(executable)).toEqual([
		{ key: extension, type: "REG_SZ", data: "LeadCut.Project" },
		{ key: extension + "\\OpenWithProgids", name: "LeadCut.Project", type: "REG_NONE", data: "" },
		{ key: project, type: "REG_SZ", data: "LeadCut 工程" },
		{ key: project, name: "Treatment", type: "REG_DWORD", data: "0x0" },
		{ key: project + "\\shell", type: "REG_SZ", data: "open" },
		{ key: project + "\\shell\\open", type: "REG_SZ", data: "Open with LeadCut" },
		{ key: project + "\\shell\\open\\command", type: "REG_SZ", data: '"C:\\Program Files\\LeadCut\\LeadCut.exe" "%1"' },
		{ key: project + "\\DefaultIcon", type: "REG_SZ", data: '"C:\\Program Files\\LeadCut\\resources\\leadcut-project.ico",0' },
		{ key: classes + "\\CLSID\\" + thumbnailProvider, type: "REG_SZ", data: "LeadCut Project Thumbnail Provider" },
		{ key: classes + "\\CLSID\\" + thumbnailProvider + "\\InprocServer32", type: "REG_SZ", data: "C:\\Program Files\\LeadCut\\resources\\LeadCutThumbnail.dll" },
		{ key: classes + "\\CLSID\\" + thumbnailProvider + "\\InprocServer32", name: "ThreadingModel", type: "REG_SZ", data: "Both" },
		{ key: extension + "\\ShellEx\\" + shellThumbnail, type: "REG_SZ", data: thumbnailProvider },
		{ key: project + "\\ShellEx\\" + shellThumbnail, type: "REG_SZ", data: thumbnailProvider },
		{ key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Approved",
			name: thumbnailProvider, type: "REG_SZ", data: "LeadCut Project Thumbnail Provider" },
	]);
});

function fakeRegistry(
	missingKey?: string,
	legacyDefault?: string,
	oldCommand?: string,
) {
	const registry = expectedProjectAssociation(executable).filter(value => value.key !== missingKey);
	const openCommand = registry.find(value => value.key === project + "\\shell\\open\\command");
	if (oldCommand && openCommand) openCommand.data = oldCommand;
	if (legacyDefault) registry.push({ key: classes + "\\.recordly", type: "REG_SZ", data: legacyDefault });

	const read = vi.fn(async (addresses: { key: string; name?: string }[]) => addresses.map(({ key, name }) => {
		const value = registry.find(value => value.key === key && value.name === name);
		return { type: value?.type ?? null, data: value?.data ?? "" };
	}));
	const write = vi.fn(async (_args: string[]) => {});
	return { read, write };
}
const writes = (registry: ReturnType<typeof fakeRegistry>) => registry.write.mock.calls.flat();

it("only reads when all current values already match", async () => {
	const registry = fakeRegistry();
	await expect(repairWindowsProjectAssociation(executable, registry.read, registry.write)).resolves.toBe(false);
	expect(writes(registry)).toEqual([]);
});

it("writes only the missing extension default", async () => {
	const registry = fakeRegistry(extension);
	await expect(repairWindowsProjectAssociation(executable, registry.read, registry.write)).resolves.toBe(true);
	expect(writes(registry)).toEqual([["add", extension, "/ve", "/t", "REG_SZ", "/d", "LeadCut.Project", "/f"]]);
});

it("repairs a stale executable path and preserves another app's legacy association", async () => {
	const commandKey = project + "\\shell\\open\\command";
	const registry = fakeRegistry(undefined, "Recordly.Project", "\"D:\\Old\\LeadCut.exe\" \"%1\"");
	await expect(repairWindowsProjectAssociation(executable, registry.read, registry.write)).resolves.toBe(true);
	expect(writes(registry)).toEqual([["add", commandKey, "/ve", "/t", "REG_SZ", "/d", '"' + executable + '" "%1"', "/f"]]);
});

it("deletes a legacy extension default owned by LeadCut", async () => {
	const registry = fakeRegistry(undefined, "LeadCut.Project");
	await expect(repairWindowsProjectAssociation(executable, registry.read, registry.write)).resolves.toBe(true);
	expect(writes(registry)).toEqual([["delete", classes + "\\.recordly", "/ve", "/f"]]);
});
