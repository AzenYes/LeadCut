import { useEffect, useMemo, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { CAPTION_QUALITY_SETTINGS_KEY } from "@/lib/storageKeys";
import {
	checkCaptions,
	normalizeCaptionQualityRules,
	type CaptionQualityRules,
} from "../captionQuality";
import { getCaptionFontStack, getCaptionFontWeight, getCaptionScaledFontSize, getCaptionTextMaxWidth } from "../captionStyle";
import { type AutoCaptionSettings } from "../types";

const REFERENCE_WIDTH = 1920;
const MAX_CACHED_WIDTHS = 5000;

export function useCaptionQuality(rows: Parameters<typeof checkCaptions>[0], appearance: AutoCaptionSettings) {
	const [rules, setRules] = useState(() => normalizeCaptionQualityRules(loadAppSetting(CAPTION_QUALITY_SETTINGS_KEY)));
	const [fontVersion, setFontVersion] = useState(0);
	const fontSize = getCaptionScaledFontSize(appearance.fontSize, REFERENCE_WIDTH, appearance.maxWidth);
	const font = `${getCaptionFontWeight(appearance)} ${fontSize}px ${getCaptionFontStack(appearance)}`;
	const maxWidth = getCaptionTextMaxWidth(REFERENCE_WIDTH, appearance.maxWidth, fontSize);

	useEffect(() => {
		const fonts = document.fonts;
		if (!fonts) return;
		let disposed = false;
		const refresh = () => { if (!disposed) setFontVersion(value => value + 1); };
		fonts.addEventListener("loadingdone", refresh);
		void fonts.load(font).catch(() => undefined).then(() => fonts.ready).then(refresh);
		return () => {
			disposed = true;
			fonts.removeEventListener("loadingdone", refresh);
		};
	}, [font]);

	const measurements = useMemo(() => ({
		version: fontVersion,
		font,
		values: new Map<string, number>(),
	}), [font, fontVersion]);
	const issues = useMemo(() => {
		const context = rules.enabled.tooWide ? document.createElement("canvas").getContext("2d") : null;
		if (context) context.font = measurements.font;
		return checkCaptions(rows, rules, (text) => {
			const cached = measurements.values.get(text);
			if (cached !== undefined) return cached;
			const width = context?.measureText(text).width ?? 0;
			if (measurements.values.size >= MAX_CACHED_WIDTHS) measurements.values.clear();
			measurements.values.set(text, width);
			return width;
		}, maxWidth);
	}, [maxWidth, measurements, rows, rules]);

	function updateRules(next: CaptionQualityRules) {
		const normalized = normalizeCaptionQualityRules(next);
		setRules(normalized);
		saveAppSetting(CAPTION_QUALITY_SETTINGS_KEY, normalized);
	}

	return { issues, rules, updateRules };
}
