import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useScopedT } from "@/contexts/I18nContext";
import {
	captionPresetStyle,
	AZHEN_PR_CAPTION_PRESET,
	loadCaptionPresets,
	saveCaptionPresets,
	type CaptionPreset,
} from "./captionPresets";
import type { AutoCaptionSettings } from "./types";

export function CaptionPresetControls({
	settings,
	onChange,
}: {
	settings: AutoCaptionSettings;
	onChange: (partial: Partial<AutoCaptionSettings>) => void;
}) {
	const t = useScopedT("settings");
	const [presets, setPresets] = useState(loadCaptionPresets);
	const [name, setName] = useState("");
	const allPresets = [
		AZHEN_PR_CAPTION_PRESET,
		...presets.filter((preset) => preset.id !== AZHEN_PR_CAPTION_PRESET.id),
	];
	const currentStyle = captionPresetStyle(settings);
	const active = allPresets.find((preset) =>
		Object.entries(preset.style).every(
			([key, value]) => currentStyle[key as keyof typeof currentStyle] === value,
		),
	);
	const presetName = (preset: CaptionPreset) =>
		preset.id === AZHEN_PR_CAPTION_PRESET.id
			? t("captions.azhenPrPreset", "Azhen PR subtitles")
			: preset.name;
	const persist = (next: CaptionPreset[]) => {
		if (!saveCaptionPresets(next)) {
			toast.error(t("captions.presetSaveFailed", "Could not save subtitle presets."));
			return false;
		}
		setPresets(next);
		return true;
	};
	return (
		<div className="space-y-2" data-caption-presets>
			<p className="text-sm font-medium">{t("captions.savedPresets", "Subtitle presets")}</p>
			{allPresets.length > 0 && (
				<div className="flex items-center gap-2">
					<Select
						aria-label={t("captions.savedPresets", "Subtitle presets")}
						value={active?.id ?? ""}
						onValueChange={(id) => {
							const preset = allPresets.find((item) => item.id === id);
							if (preset) onChange(preset.style);
						}}
					>
						<SelectTrigger className="h-9 min-w-0 flex-1 text-sm">
							<SelectValue
								className="min-w-0 truncate"
								placeholder={t("captions.choosePreset", "Choose subtitle preset")}
							/>
						</SelectTrigger>
						<SelectContent>
							{allPresets.map((preset) => (
								<SelectItem key={preset.id} value={preset.id}>
									{presetName(preset)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{active && active.id !== AZHEN_PR_CAPTION_PRESET.id && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-label={t(
								"captions.deletePreset",
								"Delete subtitle preset {{name}}",
								{ name: active.name },
							)}
							onClick={() =>
								persist(presets.filter((preset) => preset.id !== active.id))
							}
						>
							{t("captions.deletePresetButton", "Delete")}
						</Button>
					)}
				</div>
			)}
			{active?.id === AZHEN_PR_CAPTION_PRESET.id && (
				<p className="text-xs text-muted-foreground">
					{t(
						"captions.azhenPrHint",
						"IBM Plex Sans SC Medium · white text · black outline · soft shadow",
					)}
				</p>
			)}
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					const normalizedName = name.trim().replace(/\s+/g, " ");
					if (!normalizedName) {
						toast.error(
							t("captions.presetNameRequired", "Enter a subtitle preset name."),
						);
						return;
					}
					if (
						presets.some(
							(preset) =>
								preset.name.toLocaleLowerCase() ===
								normalizedName.toLocaleLowerCase(),
						)
					) {
						toast.error(
							t(
								"captions.presetDuplicate",
								"A subtitle preset with that name already exists.",
							),
						);
						return;
					}
					if (
						persist([
							{
								id: crypto.randomUUID(),
								name: normalizedName,
								style: captionPresetStyle(settings),
							},
							...presets,
						])
					) {
						setName("");
						toast.success(t("captions.presetSaved", "Subtitle preset saved."));
					}
				}}
			>
				<Input
					value={name}
					onChange={(event) => setName(event.target.value)}
					className="h-9 min-w-0 flex-1 text-sm"
					aria-label={t("captions.presetName", "Subtitle preset name")}
					placeholder={t("captions.presetName", "Subtitle preset name")}
				/>
				<Button type="submit" size="sm">
					{t("captions.savePreset", "Save preset")}
				</Button>
			</form>
		</div>
	);
}
