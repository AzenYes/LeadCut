import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { KEYSTROKE_PRESETS_STORAGE_KEY } from "@/lib/storageKeys";
import { CaptionFontPicker } from "../CaptionFontPicker";
import type { KeystrokeOverlaySettings, KeystrokeOverlayStyle } from "../types";
import { normalizeKeystrokeOverlay } from "./keystrokeModel";
import type { useRecordingKeystrokes } from "./useRecordingKeystrokes";

type Preset = { name: string; style: KeystrokeOverlayStyle };
const numeric = [
	["x", "Horizontal position (%)", 0, 100, 1], ["y", "Vertical position (%)", 0, 100, 1],
	["fontSize", "Font size", 12, 120, 1], ["cornerRadius", "Corner radius", 0, 64, 1],
	["opacity", "Opacity", 0, 1, 0.05], ["durationMs", "Display time (ms)", 250, 5000, 50],
	["fadeMs", "Fade time (ms)", 0, 2500, 10],
] as const;
const control = "w-full rounded-md border border-foreground/15 bg-foreground/5 px-2 py-1.5 text-sm text-foreground";

function readPresets(): Preset[] {
	const stored = loadAppSetting<unknown>(KEYSTROKE_PRESETS_STORAGE_KEY);
	if (!Array.isArray(stored)) return [];
	return stored.flatMap(value => value && typeof value.name === "string" && value.name.trim() && value.style
		? [{ name: value.name, style: normalizeKeystrokeOverlay({ style: value.style }).style }] : []);
}

export function KeystrokeStylePanel({ settings, onChange, recording }: {
	settings: KeystrokeOverlaySettings;
	onChange: (settings: KeystrokeOverlaySettings) => void;
	recording: Pick<ReturnType<typeof useRecordingKeystrokes>, "mode" | "pressCount" | "ready" | "failed">;
}) {
	const t = useScopedT("editor");
	const [presets, setPresets] = useState(readPresets);
	const [name, setName] = useState("");
	const { style } = settings;
	const captureMessage = recording.failed ? "captureFailed"
		: recording.pressCount === 0 ? "captureEmpty"
			: recording.mode === "all" ? "captureAll"
				: recording.mode === "shortcuts" ? "captureShortcuts" : "captureUnknown";
	const patch = (next: Partial<KeystrokeOverlayStyle>) => onChange(normalizeKeystrokeOverlay({
		...settings, style: { ...style, ...next },
	}));
	const positions = [
		{ x: 14, y: 13, label: t("keystrokes.topLeft", "Top left") },
		{ x: 50, y: 13, label: t("keystrokes.topCenter", "Top center") },
		{ x: 86, y: 13, label: t("keystrokes.topRight", "Top right") },
		{ x: 14, y: 87, label: t("keystrokes.bottomLeft", "Bottom left") },
		{ x: 50, y: 87, label: t("keystrokes.bottomCenter", "Bottom center") },
		{ x: 86, y: 87, label: t("keystrokes.bottomRight", "Bottom right") },
	];
	const selectedPosition = positions.findIndex(position => position.x === style.x && position.y === style.y);
	const save = () => {
		const title = name.trim();
		if (!title) return;
		const next = [...presets.filter(preset => preset.name !== title), { name: title, style }];
		if (saveAppSetting(KEYSTROKE_PRESETS_STORAGE_KEY, next)) {
			setPresets(next);
			setName("");
		}
	};
	return (
		<section className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm" aria-label={t("keystrokes.title", "Keystroke display")}>
			{recording.ready && (
				<div className="text-xs text-muted-foreground" role="status">
					<p>{t(`keystrokes.${captureMessage}`, undefined, { count: recording.pressCount })}</p>
					{captureMessage === "captureShortcuts" && <p className="mt-1">{t("keystrokes.captureShortcutsHint")}</p>}
				</div>
			)}
			<label className="flex items-center justify-between gap-2">
				{t("keystrokes.enabled", "Show keystrokes")}
				<input type="checkbox" checked={settings.enabled} onChange={event => onChange({ ...settings, enabled: event.target.checked })} />
			</label>
			<label className="block space-y-1">
				<span>{t("keystrokes.filter")}</span>
				<select className={control} value={settings.filter} onChange={event => {
					onChange({ ...settings, filter: event.target.value === "shortcuts" ? "shortcuts" : "all" });
				}}>
					<option value="all">{t("keystrokes.filterAll")}</option>
					<option value="shortcuts">{t("keystrokes.filterShortcuts")}</option>
				</select>
			</label>
			<label className="block space-y-1">
				<span>{t("keystrokes.position", "Position")}</span>
				<select className={control} value={selectedPosition} onChange={event => {
					const position = positions[Number(event.target.value)];
					if (position) patch({ x: position.x, y: position.y });
				}}>
					<option value={-1} disabled>{t("keystrokes.custom", "Custom")}</option>
					{positions.map((position, index) => <option key={position.label} value={index}>{position.label}</option>)}
				</select>
			</label>
			<div className="grid grid-cols-2 gap-3">
				{numeric.map(([field, fallback, min, max, step]) => (
					<label className="min-w-0 space-y-1" key={field}>
						<span>{t(`keystrokes.${field}`, fallback)}</span>
						<input key={style[field]} className={control} type="number" min={min} max={max} step={step}
							defaultValue={style[field]} onBlur={event => {
								const value = event.currentTarget.valueAsNumber;
								if (Number.isFinite(value) && value !== style[field]) patch({ [field]: value });
							}} />
					</label>
				))}
				{(["textColor", "backgroundColor"] as const).map(field => (
					<label className="space-y-1" key={field}>
						<span>{t(`keystrokes.${field}`, field === "textColor" ? "Text color" : "Background color")}</span>
						<input className={control} type="color" value={style[field]} onChange={event => patch({ [field]: event.target.value })} />
					</label>
				))}
			</div>
			<CaptionFontPicker label={t("keystrokes.font", "Font family")} value={style.fontFamily}
				onChange={fontFamily => patch({ fontFamily })} />
			<label className="block space-y-1">
				<span>{t("keystrokes.presets", "Style presets")}</span>
				<select className={control} value="" onChange={event => {
					const preset = presets.find(item => item.name === event.target.value);
					if (preset) patch(preset.style);
				}}>
					<option value="" disabled>{t("keystrokes.choosePreset", "Choose a preset")}</option>
					{presets.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
				</select>
			</label>
			<div className="flex gap-2">
				<input className={control} aria-label={t("keystrokes.presetName", "Preset name")} value={name}
					maxLength={48} onChange={event => setName(event.target.value)} />
				<Button type="button" size="sm" onClick={save} disabled={!name.trim()}>{t("keystrokes.savePreset", "Save preset")}</Button>
			</div>
		</section>
	);
}
