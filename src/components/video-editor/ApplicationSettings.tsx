import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, ChoiceItem } from "@/components/ui/choice-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { useTheme } from "@/contexts/ThemeContext";
import { SUPPORTED_LOCALES, type AppLocale } from "@/i18n/config";
import { useUiText } from "@/i18n/useUiText";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import { SettingsRow } from "./SettingsRow";
import { SettingsCategory } from "./SettingsSections";

const APP_LANGUAGE_LABELS: Record<AppLocale, string> = {
	en: "English",
	es: "Español (traducción parcial)",
	fr: "Français (traduction partielle)",
	de: "Deutsch (teilweise übersetzt)",
	it: "Italiano (traduzione parziale)",
	nl: "Nederlands (gedeeltelijk vertaald)",
	ko: "한국어 (부분 번역)",
	"pt-BR": "Português (tradução parcial)",
	"zh-CN": "简体中文",
	"zh-TW": "繁體中文（部分翻譯）",
};

export function ApplicationSettings({
	onShowOnboarding,
	onAutoZoomsChange,
	beforeOpenShortcuts,
}: {
	onShowOnboarding: () => void;
	onAutoZoomsChange: (enabled: boolean) => void;
	beforeOpenShortcuts?: () => void;
}) {
	const { t, locale, setLocale } = useI18n();
	const settings = useScopedT("settings");
	const text = useUiText();
	const { preference, setPreference } = useTheme();
	const { openConfig } = useShortcuts();
	const [defaults, setDefaults] = useState(loadEditorPreferences);
	const [saving, setSaving] = useState(false);
	const updateDefault = async (property: "autoApplyFreshRecordingAutoZooms" | "connectZooms", enabled: boolean) => {
		setSaving(true);
		if (await saveEditorPreferences({ [property]: enabled }, { flush: true })) {
			setDefaults(current => ({ ...current, [property]: enabled }));
			if (property === "autoApplyFreshRecordingAutoZooms") onAutoZoomsChange(enabled);
		} else {
			toast.error(text("recordingAppearanceDefaultFailed"));
		}
		setSaving(false);
	};
	return (
		<>
			<SettingsCategory category="general">
				<SettingsRow title={settings("general.onboarding")}>
					<Button variant="secondary" size="sm" onClick={onShowOnboarding}>
						{settings("general.showOnboarding")}
					</Button>
				</SettingsRow>
				<SettingsRow title={t("editor.theme.appearance")} stacked>
					<ChoiceGroup aria-label={t("editor.theme.appearance")} value={preference} size="sm"
						onValueChange={value => {
							if (value === "light" || value === "dark" || value === "system") setPreference(value);
						}}>
						<ChoiceItem value="light">{t("editor.theme.light")}</ChoiceItem>
						<ChoiceItem value="dark">{t("editor.theme.dark")}</ChoiceItem>
						<ChoiceItem value="system">{t("editor.theme.system")}</ChoiceItem>
					</ChoiceGroup>
				</SettingsRow>
				<SettingsRow title={t("common.app.language")} stacked>
					<Select value={locale} onValueChange={value => setLocale(value as AppLocale)}>
						<SelectTrigger className="h-9 w-full text-sm"><SelectValue /></SelectTrigger>
						<SelectContent>
							{SUPPORTED_LOCALES.map(language => (
								<SelectItem key={language} value={language}>{APP_LANGUAGE_LABELS[language]}</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow title={t("editor.keyboardShortcuts.title")}>
					<Button variant="secondary" size="sm" onClick={() => { beforeOpenShortcuts?.(); openConfig(); }}>
						{t("editor.keyboardShortcuts.customize")}
					</Button>
				</SettingsRow>
			</SettingsCategory>
			<SettingsCategory category="motion">
				<p className="text-xs text-muted-foreground">{text("settingsScopeNewRecordings")}</p>
				<SettingsRow title={settings("effects.autoApplyFreshRecordingZooms")} description={settings("effects.autoApplyFreshRecordingZoomsDescription")}>
					<Switch aria-label={settings("effects.autoApplyFreshRecordingZooms")}
						checked={defaults.autoApplyFreshRecordingAutoZooms} disabled={saving}
						onCheckedChange={value => void updateDefault("autoApplyFreshRecordingAutoZooms", value)} />
				</SettingsRow>
				<SettingsRow title={settings("effects.connectZooms")} description={settings("effects.connectZoomsDescription")}>
					<Switch aria-label={settings("effects.connectZooms")}
						checked={defaults.connectZooms} disabled={saving}
						onCheckedChange={value => void updateDefault("connectZooms", value)} />
				</SettingsRow>
			</SettingsCategory>
		</>
	);
}
