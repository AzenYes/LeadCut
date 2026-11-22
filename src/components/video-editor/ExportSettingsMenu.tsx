import { DownloadSimple as Download, FilmSlate as Film, Image } from "@/components/ui/icons";
import { Card, Label, Description, TagGroup, Tag } from "@heroui/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import type {
	ExportEncodingMode,
	ExportFormat,
	ExportMp4FrameRate,
	ExportPipelineModel,
	ExportQuality,
	GifFrameRate,
	GifSizePreset,
} from "@/lib/exporter";
import { GIF_FRAME_RATES, GIF_SIZE_PRESETS, MP4_FRAME_RATES, MP4_RESOLUTION_TIERS } from "@/lib/exporter";
import {
	estimateMp4OutputBytes,
	getMp4ExportBitrate,
	MAX_MANUAL_MP4_BITRATE_MBPS,
	MIN_MANUAL_MP4_BITRATE_MBPS,
	normalizeManualMp4Bitrate,
} from "@/lib/exporter/exportBitrate";
import { resolveAvailableMp4Quality } from "./exportDimensions";

interface ExportSettingsMenuProps {
	exportFormat: ExportFormat;
	onExportFormatChange?: (format: ExportFormat) => void;
	exportQuality: ExportQuality;
	onExportQualityChange?: (quality: ExportQuality) => void;
	exportBitrateMbps: number | null;
	onExportBitrateMbpsChange: (value: number | null) => void;
	timelineDuration: number;
	exportEncodingMode: ExportEncodingMode;
	onExportEncodingModeChange?: (encodingMode: ExportEncodingMode) => void;
	mp4FrameRate: ExportMp4FrameRate;
	onMp4FrameRateChange?: (frameRate: ExportMp4FrameRate) => void;
	exportPipelineModel?: ExportPipelineModel;
	experimentalNvidiaCudaExport?: boolean;
	onExperimentalNvidiaCudaExportChange?: (enabled: boolean) => void;
	nvidiaCudaExportAvailable?: boolean;
	showCaptionSidecarOption?: boolean;
	includeCaptionSidecar?: boolean;
	revealAfterExport?: boolean;
	onRevealAfterExportChange?: (enabled: boolean) => void;
	onIncludeCaptionSidecarChange?: (enabled: boolean) => void;
	mp4OutputDimensions?: Record<ExportQuality, { width: number; height: number }>;
	gifFrameRate: GifFrameRate;
	onGifFrameRateChange?: (rate: GifFrameRate) => void;
	gifLoop: boolean;
	onGifLoopChange?: (loop: boolean) => void;
	gifSizePreset: GifSizePreset;
	onGifSizePresetChange?: (preset: GifSizePreset) => void;
	gifOutputDimensions: { width: number; height: number };
	onExport?: () => void;
	exportDisabled?: boolean;
	className?: string;
	hideHeading?: boolean;
	hideAction?: boolean;
	linkMode?: boolean;
}

function Choices<T extends string | number>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: ReactNode; textValue?: string; description?: string; disabled?: boolean; hint?: string }[];
	onChange?: (value: T) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Label>{label}</Label>
			<TagGroup
				aria-label={label}
				selectionMode="single"
				disallowEmptySelection
				selectedKeys={[String(value)]}
				disabledKeys={options.filter(option => option.disabled).map(option => String(option.value))}
				onSelectionChange={(keys) => {
					if (keys === "all") return;
					const selected = options.find((option) => keys.has(String(option.value)));
					if (selected) onChange?.(selected.value);
				}}
				size="lg"
			>
				<TagGroup.List className="flex gap-2">
					{options.map((option) => (
						<Tag
							key={option.value}
							id={String(option.value)}
							aria-description={option.hint}
							textValue={
								option.textValue ??
								(typeof option.label === "string"
									? option.label
									: String(option.value))
							}
							className="h-auto min-h-10 flex-1 justify-center flex-col gap-0.5 py-2"
						>
							{option.label}
							{option.description && (
								<span className="text-[10px] opacity-70" title={option.hint}>{option.description}</span>
							)}
						</Tag>
					))}
				</TagGroup.List>
			</TagGroup>
		</div>
	);
}
export function ExportSettingsMenu({
	exportFormat,
	onExportFormatChange,
	exportQuality,
	onExportQualityChange,
	exportBitrateMbps,
	onExportBitrateMbpsChange,
	timelineDuration,
	exportEncodingMode,
	onExportEncodingModeChange,
	mp4FrameRate,
	onMp4FrameRateChange,
	exportPipelineModel = "modern",
	experimentalNvidiaCudaExport = false,
	onExperimentalNvidiaCudaExportChange,
	nvidiaCudaExportAvailable = false,
	showCaptionSidecarOption = false,
	includeCaptionSidecar = false,
	revealAfterExport = false,
	onRevealAfterExportChange,
	onIncludeCaptionSidecarChange,
	mp4OutputDimensions,
	gifFrameRate,
	onGifFrameRateChange,
	gifLoop,
	onGifLoopChange,
	gifSizePreset,
	onGifSizePresetChange,
	gifOutputDimensions,
	onExport,
	exportDisabled = false,
	className,
	hideHeading = false,
	hideAction = false,
	linkMode = false,
}: ExportSettingsMenuProps) {
	const tSettings = useScopedT("settings");
	const { locale } = useI18n();
	const isLegacyModel = exportPipelineModel === "legacy";
	const source = mp4OutputDimensions?.source;
	const resolveQuality = (quality: ExportQuality) =>
		source ? resolveAvailableMp4Quality(source.width, source.height, quality) : quality;
	const availableQuality = resolveQuality(exportQuality);
	const selectedSize = mp4OutputDimensions?.[availableQuality];
	const autoBitrate = selectedSize ? getMp4ExportBitrate({
		...selectedSize, frameRate: mp4FrameRate, quality: availableQuality, encodingMode: exportEncodingMode,
	}) : 10_000_000;
	const effectiveBitrate = exportBitrateMbps === null ? autoBitrate : exportBitrateMbps * 1_000_000;
	const bytes = estimateMp4OutputBytes(effectiveBitrate, timelineDuration);
	const megabytes = (bytes / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 2 });
	const bitrateLabel = tSettings("export.manualBitrateInput", "Video bitrate (Mbps)");

	return (
		<Card className={className}>
			{!hideHeading && (
				<Card.Header>
					<Card.Title>{tSettings("export.title", "Export")}</Card.Title>
				</Card.Header>
			)}
			<Card.Content className="gap-4">
				{!linkMode && (
					<Choices
						label={tSettings("export.format", "Format")}
						value={exportFormat}
						onChange={onExportFormatChange}
						options={[
							{
								value: "mp4",
								textValue: tSettings("export.mp4"),
								label: (
									<span className="flex items-center gap-2">
										<Film />
										{tSettings("export.mp4")}
									</span>
								),
							},
							{
								value: "gif",
								textValue: tSettings("export.gif"),
								label: (
									<span className="flex items-center gap-2">
										<Image />
										{tSettings("export.gif")}
									</span>
								),
							},
						]}
					/>
				)}
				{exportFormat === "mp4" ? (
					<>
						<Choices
							label={tSettings("export.qualityTitle", "Quality")}
							value={availableQuality}
							onChange={onExportQualityChange}
							options={MP4_RESOLUTION_TIERS.map(
								(value) => ({
									value,
									label: tSettings(`export.quality.${value === "source" ? "original" : value}`),
									disabled: resolveQuality(value) !== value,
									hint: resolveQuality(value) !== value ? tSettings("export.sourceBelowTier", "Source resolution is below this tier") : undefined,
									description: mp4OutputDimensions
										? `${mp4OutputDimensions[value].width} × ${mp4OutputDimensions[value].height}`
										: undefined,
								}),
							)}
						/>
						{source && resolveQuality("2160p") === "source" && (
							<Description>{tSettings("export.sourceBelowTier", "Source resolution is below this tier")}</Description>
						)}
						{selectedSize && timelineDuration > 0 && (
							<Description data-testid="estimated-export-size">
								{tSettings("export.estimatedSize", "Approx. {{size}} MB", { size: megabytes })}
							</Description>
						)}
						<Choices
							label={tSettings("export.encodingTitle", "Encoding")}
							value={exportEncodingMode}
							onChange={onExportEncodingModeChange}
							options={(["fast", "balanced", "quality"] as const).map((value) => ({
								value,
								label: tSettings(
									`export.encoding.${value}`,
									{ fast: "Fast", balanced: "Balanced", quality: "Quality" }[
										value
									],
								),
							}))}
						/>
						<Choices
							label={tSettings("export.fpsTitle", "FPS")}
							value={mp4FrameRate}
							onChange={onMp4FrameRateChange}
							options={MP4_FRAME_RATES.map((value) => ({
								value,
								label: String(value),
							}))}
						/>
						<details className="rounded border border-border p-2 text-sm">
							<summary className="cursor-pointer">{tSettings("export.advanced", "Advanced export settings")}</summary>
							<div className="mt-2 space-y-2">
								<Choices
									label={tSettings("export.bitrateMode", "Bitrate")}
									value={exportBitrateMbps === null ? "auto" : "manual"}
									onChange={mode => onExportBitrateMbpsChange(mode === "auto" ? null : normalizeManualMp4Bitrate(autoBitrate / 1_000_000))}
									options={[
										{ value: "auto", label: tSettings("export.bitrateAuto", "Automatic") },
										{ value: "manual", label: tSettings("export.bitrateManual", "Manual") },
									]}
								/>
								{exportBitrateMbps !== null && (
									<label className="block text-xs">
										{bitrateLabel}
										<input key={exportBitrateMbps} type="number" min={MIN_MANUAL_MP4_BITRATE_MBPS}
											max={MAX_MANUAL_MP4_BITRATE_MBPS} step="0.1" defaultValue={exportBitrateMbps}
											className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
											onBlur={event => {
												const next = normalizeManualMp4Bitrate(event.currentTarget.valueAsNumber) ?? exportBitrateMbps;
												event.currentTarget.value = String(next);
												onExportBitrateMbpsChange(next);
											}}
											onKeyDown={event => {
												if (event.key !== "Enter") return;
												event.preventDefault();
												event.currentTarget.blur();
											}}
										/>
									</label>
								)}
							</div>
						</details>
						{!isLegacyModel && nvidiaCudaExportAvailable && (
							<Switch
								checked={experimentalNvidiaCudaExport}
								onCheckedChange={onExperimentalNvidiaCudaExportChange}
							>
								<Label>{tSettings("export.nvidiaCuda.title", "NVIDIA CUDA")}</Label>
							</Switch>
						)}
						{showCaptionSidecarOption && (
							<div>
								<Switch
									checked={includeCaptionSidecar}
									onCheckedChange={onIncludeCaptionSidecarChange}
								>
									<Label>
										{tSettings(
											"export.captionSidecar.title",
											"Export captions file",
										)}
									</Label>
								</Switch>
								<Description>
									{tSettings(
										"export.captionSidecar.hint",
										"Save .srt and .vtt files next to your exported video.",
									)}
								</Description>
							</div>
						)}
					</>
				) : (
					<>
						<Choices
							label={tSettings("export.fpsTitle", "FPS")}
							value={gifFrameRate}
							onChange={onGifFrameRateChange}
							options={GIF_FRAME_RATES.map((rate) => ({
								value: rate.value,
								label: String(rate.value),
							}))}
						/>
						<Choices
							label={tSettings("export.size", "Size")}
							value={gifSizePreset}
							onChange={onGifSizePresetChange}
							options={Object.entries(GIF_SIZE_PRESETS).map(([key, preset]) => ({
								value: key as GifSizePreset,
								label: tSettings(`export.gifSize.${key}`, preset.label),
							}))}
						/>
						<Description>
							{gifOutputDimensions.width} × {gifOutputDimensions.height}px
						</Description>
						<Switch checked={gifLoop} onCheckedChange={onGifLoopChange}>
							<Label>{tSettings("export.loop")}</Label>
						</Switch>
					</>
				)}
				{onRevealAfterExportChange && <Switch checked={revealAfterExport} onCheckedChange={onRevealAfterExportChange}>
					<Label>{tSettings("export.revealAfterExport", "Show the file in its folder after export")}</Label>
				</Switch>}
			</Card.Content>
			{!hideAction && (
				<Card.Footer>
					<Button size="lg" onClick={onExport} isDisabled={exportDisabled} className="w-full">
						<Download />
						{tSettings("export.exportVideo", undefined, {
							format: exportFormat === "gif" ? "GIF" : "MP4",
						})}
					</Button>
				</Card.Footer>
			)}
		</Card>
	);
}
