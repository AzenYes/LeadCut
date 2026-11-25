import { LOCALE_STORAGE_KEY } from "../lib/storageKeys";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { I18nProvider as AriaI18nProvider } from "react-aria";
import {
	type AppLocale,
	DEFAULT_LOCALE,
	I18N_NAMESPACES,
	type I18nNamespace,
	SUPPORTED_LOCALES,
} from "@/i18n/config";
import enCommon from "@/i18n/locales/en/common.json";
import enDialogs from "@/i18n/locales/en/dialogs.json";
import enEditor from "@/i18n/locales/en/editor.json";
import enLaunch from "@/i18n/locales/en/launch.json";
import enSettings from "@/i18n/locales/en/settings.json";
import enShortcuts from "@/i18n/locales/en/shortcuts.json";
import enTimeline from "@/i18n/locales/en/timeline.json";
import zhCNCommon from "@/i18n/locales/zh-CN/common.json";
import zhCNDialogs from "@/i18n/locales/zh-CN/dialogs.json";
import zhCNEditor from "@/i18n/locales/zh-CN/editor.json";
import zhCNLaunch from "@/i18n/locales/zh-CN/launch.json";
import zhCNSettings from "@/i18n/locales/zh-CN/settings.json";
import zhCNShortcuts from "@/i18n/locales/zh-CN/shortcuts.json";
import zhCNTimeline from "@/i18n/locales/zh-CN/timeline.json";

type LocaleBundle = Record<I18nNamespace, Record<string, unknown>>;

const messages: Partial<Record<AppLocale, LocaleBundle>> = {
	en: {
		common: enCommon,
		launch: enLaunch,
		editor: enEditor,
		timeline: enTimeline,
		settings: enSettings,
		dialogs: enDialogs,
		shortcuts: enShortcuts,
	},
	"zh-CN": {
		common: zhCNCommon,
		launch: zhCNLaunch,
		editor: zhCNEditor,
		timeline: zhCNTimeline,
		settings: zhCNSettings,
		dialogs: zhCNDialogs,
		shortcuts: zhCNShortcuts,
	},
};

const localizedFiles = import.meta.glob<Record<string, unknown>>([
	"/src/i18n/locales/*/*.json",
	"!/src/i18n/locales/{en,zh-CN,ru}/*.json",
], { import: "default" });
const pendingBundles = new Map<AppLocale, Promise<LocaleBundle>>();

function loadLocaleBundle(locale: AppLocale): Promise<LocaleBundle> {
	const existing = messages[locale];
	if (existing) return Promise.resolve(existing);
	const pending = pendingBundles.get(locale);
	if (pending) return pending;
	const loading = Promise.all(I18N_NAMESPACES.map(async namespace => {
		const load = localizedFiles[`/src/i18n/locales/${locale}/${namespace}.json`];
		return [namespace, load ? await load() : {}] as const;
	})).then(entries => {
		const bundle = Object.fromEntries(entries) as LocaleBundle;
		messages[locale] = bundle;
		return bundle;
	}).finally(() => { pendingBundles.delete(locale); });
	pendingBundles.set(locale, loading);
	return loading;
}

interface I18nContextValue {
	locale: AppLocale;
	setLocale: (locale: AppLocale) => void;
	t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function isSupportedLocale(locale: string): locale is AppLocale {
	return SUPPORTED_LOCALES.includes(locale as AppLocale);
}

function normalizeLocale(locale: string | null | undefined): AppLocale {
	if (!locale) {
		return DEFAULT_LOCALE;
	}

	// Exact match first (e.g. "zh-CN")
	if (isSupportedLocale(locale)) return locale;

	// Canonicalize case (e.g. "zh-cn" → "zh-CN")
	const canonical = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === locale.toLowerCase());
	if (canonical) return canonical;

	// Handle extended subtags like "zh-Hans-CN" → try "zh-CN"
	const parts = locale.split("-");
	if (parts.length >= 3) {
		const langRegion = `${parts[0]}-${parts[parts.length - 1]}`;
		if (isSupportedLocale(langRegion)) {
			return langRegion;
		}
	}

	// Language-only fallback (e.g. "zh" matches "zh-CN")
	const lang = parts[0].toLowerCase();
	const byLang = SUPPORTED_LOCALES.find((l) => l.split("-")[0].toLowerCase() === lang);
	if (byLang) return byLang;

	return DEFAULT_LOCALE;
}

function getSystemLocale(): AppLocale {
	if (typeof navigator === "undefined") {
		return DEFAULT_LOCALE;
	}

	const preferredLocales = Array.isArray(navigator.languages)
		? navigator.languages
		: [navigator.language];

	for (const locale of preferredLocales) {
		if (typeof locale !== "string" || locale.trim().length === 0) {
			continue;
		}

		const normalized = normalizeLocale(locale);
		if (normalized !== DEFAULT_LOCALE || locale.toLowerCase().startsWith(DEFAULT_LOCALE)) {
			return normalized;
		}
	}

	return DEFAULT_LOCALE;
}

function getInitialLocale(): AppLocale {
	if (typeof window === "undefined") {
		return DEFAULT_LOCALE;
	}

	const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
	if (storedLocale) {
		return normalizeLocale(storedLocale);
	}
	try {
		const nativeLocale = window.electronAPI?.getAppSetting?.(LOCALE_STORAGE_KEY);
		if (typeof nativeLocale === "string") return normalizeLocale(nativeLocale);
	} catch { /* Browser previews can run without the desktop bridge. */ }

	return getSystemLocale();
}

function getMessageValue(source: unknown, key: string): string | undefined {
	const parts = key.split(".");
	let current: unknown = source;

	for (const part of parts) {
		if (!current || typeof current !== "object" || !(part in current)) {
			return undefined;
		}

		current = (current as Record<string, unknown>)[part];
	}

	return typeof current === "string" ? current : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>) {
	if (!vars) return template;
	return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
		const value = vars[key];
		return value === undefined ? "" : String(value);
	});
}

function parseKey(key: string): { namespace: I18nNamespace; path: string } {
	const [first, ...rest] = key.split(".");
	if (I18N_NAMESPACES.includes(first as I18nNamespace) && rest.length > 0) {
		return { namespace: first as I18nNamespace, path: rest.join(".") };
	}
	return { namespace: "common", path: key };
}

function translateForLocale(
	bundle: LocaleBundle | undefined,
	key: string,
	fallback?: string,
	vars?: Record<string, string | number>,
) {
	const { namespace, path } = parseKey(key);

	const rawValue =
		getMessageValue(bundle?.[namespace], path) ??
		getMessageValue(messages[DEFAULT_LOCALE]?.[namespace], path) ??
		fallback ??
		key;

	return interpolate(rawValue, vars);
}

export function I18nProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<AppLocale>(getInitialLocale);
	const [loadedBundle, setLoadedBundle] = useState<{ locale: AppLocale; messages: LocaleBundle }>();
	const bundle = loadedBundle?.locale === locale ? loadedBundle.messages : messages[locale];

	useEffect(() => {
		if (messages[locale]) return;
		let cancelled = false;
		void loadLocaleBundle(locale).then(messages => {
			if (!cancelled) setLoadedBundle({ locale, messages });
		}).catch(error => console.warn("Could not load locale", locale, error));
		return () => { cancelled = true; };
	}, [locale]);

	const setLocale = useCallback((nextLocale: AppLocale) => {
		setLocaleState(nextLocale);
		if (typeof window !== "undefined") {
			window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
		}
	}, []);

	useEffect(() => {
		document.documentElement.lang = locale;
		window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
		try {
			const api = window.electronAPI;
			if (api?.getAppSetting?.(LOCALE_STORAGE_KEY) !== locale) {
				if (api?.setAppSettingAsync) void api.setAppSettingAsync(LOCALE_STORAGE_KEY, locale).catch(() => undefined);
				else api?.setAppSetting?.(LOCALE_STORAGE_KEY, locale);
			}
		} catch { /* Keep the selected browser language when native settings are unavailable. */ }
	}, [locale]);

	useEffect(() => {
		const synchronize = (event: StorageEvent) => {
			if (event.key === LOCALE_STORAGE_KEY && event.newValue) {
				setLocaleState(normalizeLocale(event.newValue));
			}
		};
		window.addEventListener("storage", synchronize);
		const unsubscribe = window.electronAPI?.onAppLocaleChanged?.((value) => setLocaleState(normalizeLocale(value)));
		return () => {
			window.removeEventListener("storage", synchronize);
			unsubscribe?.();
		};
	}, []);

	const t = useCallback(
		(key: string, fallback?: string, vars?: Record<string, string | number>) => {
			return translateForLocale(bundle, key, fallback, vars);
		},
		[bundle],
	);

	const value = useMemo<I18nContextValue>(
		() => ({
			locale,
			setLocale,
			t,
		}),
		[locale, setLocale, t],
	);

	return (
		<I18nContext.Provider value={value}>
			<AriaI18nProvider locale={locale}>{children}</AriaI18nProvider>
		</I18nContext.Provider>
	);
}

export function useI18n() {
	const context = useContext(I18nContext);
	if (!context) {
		throw new Error("useI18n must be used within <I18nProvider>");
	}
	return context;
}

export function useScopedT(namespace: I18nNamespace) {
	const { t } = useI18n();
	return useCallback(
		(key: string, fallback?: string, vars?: Record<string, string | number>) => {
			return t(`${namespace}.${key}`, fallback, vars);
		},
		[namespace, t],
	);
}
