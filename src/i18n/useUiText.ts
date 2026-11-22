import { useCallback } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { translateUiForLocale } from "./uiText";

export function useUiText() {
	const { locale } = useI18n();
	return useCallback(
		(key: string, variables?: Record<string, string | number>) =>
			translateUiForLocale(locale, key, variables),
		[locale],
	);
}
