import { useState } from "react";
import { useTimelineContext } from "dnd-timeline";
import { useScopedT } from "@/contexts/I18nContext";
import Row from "../timeline/Row";
import type { KeystrokeItem } from "./keystrokeModel";

export type KeystrokeTrackControls = {
	items: readonly KeystrokeItem[];
	enabled: boolean;
	onToggle?: () => void;
	onHide?: (id: string) => void;
};

export function KeystrokeTrack({ items, enabled, onToggle, onHide }: KeystrokeTrackControls) {
	const t = useScopedT("editor");
	const { direction, range, valueToPixels } = useTimelineContext();
	const [selected, setSelected] = useState<string | null>(null);
	const toggle = t("keystrokes.enabled", "Show keystrokes");
	const title = t("keystrokes.track", "Keystrokes");
	return (
		<Row id="row-keystrokes" header={
			<label className="flex items-center justify-between gap-1" title={toggle}>
				<span className="truncate">{title}</span>
				<input type="checkbox" checked={enabled} disabled={!onToggle} onChange={onToggle} aria-label={toggle} />
			</label>
		}>
			{items.filter(item => item.startMs < range.end && item.endMs > range.start).map(item => {
				const instance = `${item.id}@${item.startMs}`;
				const start = Math.max(range.start, item.startMs);
				const end = Math.min(range.end, item.endMs);
				return (
					<button type="button" key={instance} aria-pressed={selected === instance}
						aria-label={item.label} title={item.label}
						data-keystroke-item={item.id} data-start-ms={item.startMs}
						className={`absolute inset-y-0 truncate rounded border px-1 text-[10px] ${selected === instance ? "border-accent bg-accent/35" : "border-accent/35 bg-accent/15"} ${enabled ? "" : "opacity-45"}`}
						style={{ [direction === "rtl" ? "right" : "left"]: valueToPixels(start - range.start), width: Math.max(6, valueToPixels(end - start)) }}
						onMouseDown={event => event.stopPropagation()}
						onClick={event => { event.stopPropagation(); setSelected(instance); }}
						onKeyDown={event => {
							if (event.key !== "Delete" && event.key !== "Backspace") return;
							event.preventDefault();
							event.stopPropagation();
							event.currentTarget.closest<HTMLElement>('[data-testid="timeline-scroll"]')?.focus();
							onHide?.(item.id);
							setSelected(null);
						}}
					>{item.label}</button>
				);
			})}
		</Row>
	);
}
