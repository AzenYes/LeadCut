import { app } from "electron";
import { EventEmitter } from "node:events";
import { localizeUiMessage, translateUiForLocale } from "../src/i18n/uiText";

export const nativeUiEvents = new EventEmitter();
let nativeLocale: string | undefined;

export function setNativeUiLocale(locale: string) {
	if (nativeLocale === locale) return;
	nativeLocale = locale;
	nativeUiEvents.emit("locale-changed");
}

export function getNativeUiLocale(): string {
	return nativeLocale ?? app?.getLocale?.() ?? "en";
}

export function uiText(key: string, variables?: Record<string, string | number>): string {
	return translateUiForLocale(getNativeUiLocale(), key, variables);
}

export function localizeNativeUiMessage(message: string): string {
	return localizeUiMessage(message, getNativeUiLocale());
}
