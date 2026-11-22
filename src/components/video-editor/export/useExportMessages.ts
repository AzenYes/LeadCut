import { useEffect, useMemo, useState } from "react";
import type { useI18n } from "@/contexts/I18nContext";

const DEFAULT_MESSAGE_DURATION_SECONDS = 6;
export type ExportMessage = {
	id: string;
	text: string;
	durationSeconds: number;
	announcementId?: string;
};

export function buildExportMessageStream(
	tips: ExportMessage[],
	announcements: ExportMessage[],
): ExportMessage[] {
	const stream: ExportMessage[] = [];
	const length = Math.max(tips.length, announcements.length);
	for (let index = 0; index < length; index += 1) {
		if (tips[index]) stream.push(tips[index]);
		if (announcements[index]) stream.push(announcements[index]);
	}
	return stream;
}

export function useExportMessages({
	t,
	active,
}: {
	t: ReturnType<typeof useI18n>["t"];
	active: boolean;
}): string | null {
	const [currentIndex, setCurrentIndex] = useState(0);
	const tips = useMemo<ExportMessage[]>(
		() => [
			{
				id: "tip:auto-zooms",
				text: t(
					"editor.exportTips.autoZooms",
					"Tip: Turn off auto-applied zooms in settings",
				),
				durationSeconds: DEFAULT_MESSAGE_DURATION_SECONDS,
			},
			{
				id: "tip:subtitle-import",
				text: t(
					"editor.exportTips.subtitleImport",
					"Tip: Import a local SRT file from the subtitle panel",
				),
				durationSeconds: DEFAULT_MESSAGE_DURATION_SECONDS,
			},
			{
				id: "tip:cursor-appearance",
				text: t(
					"editor.exportTips.cursorAppearance",
					"Tip: You can customise your cursor appearance",
				),
				durationSeconds: DEFAULT_MESSAGE_DURATION_SECONDS,
			},
		],
		[t],
	);
	const messages = tips;
	const current = messages[currentIndex % messages.length];

	useEffect(() => {
		if (!active || messages.length < 2 || !current) return;
		const timeout = window.setTimeout(
			() => setCurrentIndex((index) => (index + 1) % messages.length),
			current.durationSeconds * 1_000,
		);
		return () => window.clearTimeout(timeout);
	}, [active, current, messages.length]);

	return active ? (current?.text ?? null) : null;
}
