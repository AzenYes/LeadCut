import type { RowDefinition } from "dnd-timeline";
import { useRow } from "dnd-timeline";
import { useI18n } from "@/contexts/I18nContext";
import { TIMELINE_CLIP_ROW_HEIGHT_PX, TIMELINE_ROW_MIN_HEIGHT_PX } from "./timelineLayout";

interface RowProps extends RowDefinition {
	embedded?: boolean;
	caption?: boolean;
	compact?: boolean;
	filmstrip?: boolean;
	children: React.ReactNode;
	label?: string;
	header?: React.ReactNode;
	hint?: string;
	isEmpty?: boolean;
	labelColor?: string;
	onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
	onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
	onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
	onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
	onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export default function Row({
	id,
	embedded = false,
	compact = true,
	filmstrip = false,
	children,
	label,
	header,
	hint,
	isEmpty,
	labelColor = "#666",
	onMouseEnter,
	onMouseMove,
	onMouseLeave,
	onMouseDown,
	onClick,
}: RowProps) {
	const { setNodeRef, setSidebarRef, rowSidebarStyle, rowWrapperStyle, rowStyle } = useRow({ id });
	const { t } = useI18n();
	const trackLabel = label ?? (id === "row-clip" ? t("editor.tracks.screen", "V1 · Screen") : id === "row-zoom" ? t("editor.tracks.zoom", "Zoom") : id === "row-captions" ? t("editor.tracks.captions", "Captions") : id.startsWith("row-audio") ? t("editor.tracks.audio", "Audio") : id.startsWith("row-annotation") ? t("editor.tracks.annotation", "Annotations") : t("editor.tracks.sourceAudio", "Source audio"));

	return (
		<div
			data-timeline-row={id}
			className="bg-transparent relative"
			style={{
				...rowWrapperStyle,
				...(embedded
					? {
							position: "absolute" as const,
							insetInline: 0,
							bottom: 7,
							zIndex: 15,
							pointerEvents: "none" as const,
						}
					: {}),
				marginBottom: 2,
				flexGrow: 0,
				flexShrink: 0,
				height: embedded
					? 20
					: filmstrip || !compact
						? TIMELINE_CLIP_ROW_HEIGHT_PX
						: TIMELINE_ROW_MIN_HEIGHT_PX,
				flexBasis:
					filmstrip || !compact
						? TIMELINE_CLIP_ROW_HEIGHT_PX
						: TIMELINE_ROW_MIN_HEIGHT_PX,
			}}
		>
			{!embedded && (
				<div
					ref={setSidebarRef}
					className="relative z-20 flex shrink-0 flex-col justify-center overflow-hidden bg-editor-bg text-[10px] font-medium text-muted-foreground select-none"
					style={{ ...rowSidebarStyle, width: 120, minWidth: 120 }}
					onMouseDown={(event) => event.stopPropagation()}
					onClick={(event) => event.stopPropagation()}
				>
					<div className="flex h-full w-full flex-col justify-center border-r border-foreground/10 px-2">
						{header ?? <span className="truncate" title={trackLabel} style={label ? { color: labelColor } : undefined}>{trackLabel}</span>}
					</div>
				</div>
			)}
			{isEmpty && hint && (
				<div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10">
					<span className="text-[11px] text-foreground/15 font-medium">{hint}</span>
				</div>
			)}
			<div
				ref={setNodeRef}
				className="relative min-w-0 self-stretch"
				style={rowStyle}
				onMouseEnter={onMouseEnter}
				onMouseMove={onMouseMove}
				onMouseLeave={onMouseLeave}
				onMouseDown={onMouseDown}
				onClick={onClick}
			>
				{children}
			</div>
		</div>
	);
}
