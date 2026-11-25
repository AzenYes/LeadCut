import { ipcMain, type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { isTrustedApplicationDocumentUrl } from "./permissionPolicy";

let applicationDocuments: () => readonly string[] = () => [];

export function configureTrustedIpcDocuments(getUrls: () => readonly string[]) {
	applicationDocuments = getUrls;
}

export function isTrustedIpcSender(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">) {
	const { sender, senderFrame } = event;
	if (!senderFrame || sender.isDestroyed() || senderFrame !== sender.mainFrame) return false;
	const documents = applicationDocuments();
	return isTrustedApplicationDocumentUrl(senderFrame.url, documents) &&
		isTrustedApplicationDocumentUrl(sender.getURL(), documents);
}

export function handleTrustedIpc(...[channel, listener]: Parameters<IpcMain["handle"]>) {
	ipcMain.handle(channel, (event, ...args) => {
		if (!isTrustedIpcSender(event)) throw new Error("Untrusted application IPC sender");
		return listener(event, ...args);
	});
}

export function onTrustedIpc<Args extends unknown[]>(
	channel: string,
	listener: (event: IpcMainEvent, ...args: Args) => void,
) {
	const wrapped = (event: IpcMainEvent, ...args: Args) => {
		if (!isTrustedIpcSender(event)) {
			event.returnValue = null;
			return;
		}
		listener(event, ...args);
	};
	ipcMain.on(channel, wrapped);
	return () => { ipcMain.removeListener(channel, wrapped); };
}
