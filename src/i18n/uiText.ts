import { LOCALE_STORAGE_KEY } from "../lib/storageKeys";
import enCommon from "./locales/en/common.json" with { type: "json" };
import zhCommon from "./locales/zh-CN/common.json" with { type: "json" };

type Variables = Record<string, string | number>;

export function getUiLocale(): string {
	if (typeof window !== "undefined") {
		try {
			const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
			if (stored) return stored;
		} catch { /* Use the system language when storage is unavailable. */ }
	}
	return typeof window !== "undefined" && typeof navigator !== "undefined"
		? navigator.language : "en";
}

export function translateUiForLocale(locale: string, key: string, variables?: Variables): string {
	const english = (enCommon as unknown as { interface: Record<string, string> }).interface;
	const chinese = (zhCommon as unknown as { interface: Record<string, string> }).interface;
	const source = /^zh(?!-(?:tw|hk|hant))/i.test(locale) ? chinese : english;
	const message = source?.[key] ?? english?.[key] ?? key;
	return message.replace(/\{\{\s*(\w+)\s*\}\}/g, (placeholder, name: string) =>
		variables?.[name] === undefined ? placeholder : String(variables[name]),
	);
}

/** For event handlers, timeline models and lazy configuration labels outside React. */
export function uiText(key: string, variables?: Variables): string {
	return translateUiForLocale(getUiLocale(), key, variables);
}

/** Backend messages retain their original details if no reviewed translation exists. */
export function localizeUiMessage(message: string, locale = getUiLocale()): string {
	if (!/^zh(?!-(?:tw|hk|hant))/i.test(locale)) return message;
	const english = (enCommon as unknown as { interface: Record<string, string> }).interface;
	for (const [key, value] of Object.entries(english ?? {})) {
		if (value === message) return translateUiForLocale(locale, key);
	}
	return message;
}
