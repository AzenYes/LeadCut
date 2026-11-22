import { Button } from "@/components/ui/button";
import { ColorControl } from "@/components/ui/color-picker";
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useScopedT } from "@/contexts/I18nContext";
import { SliderControl } from "./SliderControl";
import type { AutoCaptionSettings } from "./types";
import { CaptionFontPicker } from "./CaptionFontPicker";
import { CaptionPresetControls } from "./CaptionPresetControls";

export const CAPTION_STYLE_PRESETS: Record<string, Partial<AutoCaptionSettings>> = {
	plain: {
		fontWeight: "normal",
		strokeWidth: 0,
		shadowEnabled: false,
		backgroundOpacity: 0,
		animationStyle: "none",
	},
	outlined: {
		fontWeight: "bold",
		textColor: "#FFFFFF",
		strokeWidth: 2,
		strokePosition: "center",
		strokeColor: "#000000",
		shadowEnabled: false,
		backgroundOpacity: 0,
		animationStyle: "none",
	},
	shadow: {
		fontWeight: "bold",
		strokeWidth: 0,
		shadowEnabled: true,
		shadowColor: "#000000",
		shadowOpacity: 0.7,
		shadowBlur: 5,
		shadowOffsetX: 0,
		shadowOffsetY: 3,
		backgroundOpacity: 0,
		animationStyle: "none",
	},
	panel: { strokeWidth: 0, shadowEnabled: false, backgroundOpacity: 0.9, textColor: "#FFFFFF" },
};

export function CaptionAppearanceControls({
	settings,
	onChange,
}: {
	settings: AutoCaptionSettings;
	onChange: (partial: Partial<AutoCaptionSettings>) => void;
}) {
	const t = useScopedT("settings");
	const label = (key: string, fallback: string) => t(`captions.${key}`, fallback);
	return (
		<div className="flex flex-col gap-3" data-caption-appearance>
			<CaptionPresetControls settings={settings} onChange={onChange} />
			<div
				className="flex flex-wrap gap-1.5"
				aria-label={label("stylePresets", "Subtitle style")}
			>
				{Object.entries(CAPTION_STYLE_PRESETS).map(([id, preset]) => (
					<Button key={id} size="sm" variant="secondary" onClick={() => onChange(preset)}>
						{label(`preset${id[0].toUpperCase()}${id.slice(1)}`, id)}
					</Button>
				))}
			</div>
			<CaptionFontPicker
				value={settings.fontFamily}
				onChange={(fontFamily) => onChange({ fontFamily })}
			/>
			<div className="flex items-center justify-between">
				<span className="text-sm">{label("fontWeight", "Font weight")}</span>
				<Select
					aria-label={label("fontWeight", "Font weight")}
					value={settings.fontWeight}
					onValueChange={(fontWeight) =>
						onChange({ fontWeight: fontWeight as AutoCaptionSettings["fontWeight"] })
					}
				>
					<SelectTrigger className="h-9 w-36 text-sm">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="normal">{label("weightNormal", "Regular")}</SelectItem>
						<SelectItem value="medium">{label("weightMedium", "Medium")}</SelectItem>
						<SelectItem value="bold">{label("bold", "Bold")}</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<SliderControl
				label={label("strokeWidth", "Outline width")}
				value={settings.strokeWidth}
				min={0}
				max={12}
				step={0.5}
				onChange={(strokeWidth) => onChange({ strokeWidth })}
				formatValue={(v) => `${v}px`}
			/>
			{settings.strokeWidth > 0 && (
				<div className="flex items-center justify-between">
					<span className="text-sm">{label("strokePosition", "Outline position")}</span>
					<Select
						aria-label={label("strokePosition", "Outline position")}
						value={settings.strokePosition ?? "center"}
						onValueChange={(strokePosition) =>
							onChange({
								strokePosition:
									strokePosition as AutoCaptionSettings["strokePosition"],
							})
						}
					>
						<SelectTrigger className="h-9 w-36 text-sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="center">
								{label("strokeCenter", "Center")}
							</SelectItem>
							<SelectItem value="outside">
								{label("strokeOutside", "Outside")}
							</SelectItem>
						</SelectContent>
					</Select>
				</div>
			)}
			{settings.strokeWidth > 0 && (
				<ColorControl
					compact
					label={label("strokeColor", "Outline color")}
					value={settings.strokeColor}
					onChange={(strokeColor) => onChange({ strokeColor })}
				/>
			)}
			<div className="flex items-center justify-between">
				<span className="text-sm">{label("shadowEnabled", "Drop shadow")}</span>
				<Switch
					aria-label={label("shadowEnabled", "Drop shadow")}
					checked={settings.shadowEnabled}
					onCheckedChange={(shadowEnabled) => onChange({ shadowEnabled })}
				/>
			</div>
			{settings.shadowEnabled && (
				<>
					<ColorControl
						compact
						label={label("shadowColor", "Shadow color")}
						value={settings.shadowColor}
						onChange={(shadowColor) => onChange({ shadowColor })}
					/>
					<SliderControl
						label={label("shadowOpacity", "Shadow opacity")}
						value={settings.shadowOpacity}
						min={0}
						max={1}
						step={0.05}
						onChange={(shadowOpacity) => onChange({ shadowOpacity })}
						formatValue={(v) => `${Math.round(v * 100)}%`}
					/>
					<SliderControl
						label={label("shadowBlur", "Shadow blur")}
						value={settings.shadowBlur}
						min={0}
						max={30}
						step={1}
						onChange={(shadowBlur) => onChange({ shadowBlur })}
						formatValue={(v) => `${v}px`}
					/>
					<SliderControl
						label={label("shadowOffsetX", "Shadow X offset")}
						value={settings.shadowOffsetX}
						min={-30}
						max={30}
						step={1}
						onChange={(shadowOffsetX) => onChange({ shadowOffsetX })}
						formatValue={(v) => `${Number(v.toFixed(2))}px`}
					/>
					<SliderControl
						label={label("shadowOffsetY", "Shadow Y offset")}
						value={settings.shadowOffsetY}
						min={-30}
						max={30}
						step={1}
						onChange={(shadowOffsetY) => onChange({ shadowOffsetY })}
						formatValue={(v) => `${Number(v.toFixed(2))}px`}
					/>
				</>
			)}
		</div>
	);
}
