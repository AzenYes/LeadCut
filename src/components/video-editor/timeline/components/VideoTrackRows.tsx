import { useI18n } from "@/contexts/I18nContext";
import type { VideoRegion, VideoTrack } from "../../videoTracks";
import Row from "../Row";
import Item from "../Item";

export const videoRowId = (id: string) => `row-video:${id}`;

export interface VideoTrackControls {
	tracks: VideoTrack[];
	regions: VideoRegion[];
	selectedIds: string[];
	onSelect: (id: string) => void;
	onChangeSpan: (id: string, span: { start: number; end: number }, trackId?: string) => void;
	onTrackChange: (id: string, patch: Partial<VideoTrack>) => void;
	onImport: (trackId: string) => void;
}

export function VideoTrackRows({ tracks, regions, selectedIds, onSelect, onTrackChange, onImport }: {
	tracks: VideoTrack[]; regions: VideoRegion[]; selectedIds: string[];
	onSelect: (id: string) => void;
	onTrackChange: (id: string, patch: Partial<VideoTrack>) => void;
	onImport: (trackId: string) => void;
}) {
	const { t } = useI18n();
	return <>{[...tracks].reverse().map((track, index) => {
		const hideLabel = `${t("editor.tracks.hide", "Hide track")} ${track.name}`;
		const muteLabel = `${t("editor.tracks.mute", "Mute track")} ${track.name}`;
		const lockLabel = `${t("editor.tracks.lock", "Lock track")} ${track.name}`;
		return <Row key={track.id} id={videoRowId(track.id)} filmstrip header={<>
		<span className="truncate text-[11px] text-foreground" title={track.name}>V{tracks.length + 1 - index} · {track.name}</span>
		<div className="mt-1 flex gap-1">
			<button type="button" className="rounded px-1 text-[9px] hover:bg-foreground/10" title={hideLabel} aria-label={hideLabel} aria-pressed={Boolean(track.hidden)} onClick={() => onTrackChange(track.id, { hidden: !track.hidden })}>{track.hidden ? "○" : "●"}</button>
			<button type="button" className="rounded px-1 text-[9px] hover:bg-foreground/10" title={muteLabel} aria-label={muteLabel} aria-pressed={Boolean(track.muted)} onClick={() => onTrackChange(track.id, { muted: !track.muted })}>M</button>
			<button type="button" className="rounded px-1 text-[9px] hover:bg-foreground/10" title={lockLabel} aria-label={lockLabel} aria-pressed={Boolean(track.locked)} onClick={() => onTrackChange(track.id, { locked: !track.locked })}>{track.locked ? "◆" : "◇"}</button>
			<button type="button" className="rounded px-1 text-[11px] hover:bg-foreground/10" disabled={track.locked} aria-label={`${t("editor.tracks.import", "Import B-roll")} ${track.name}`} onClick={() => onImport(track.id)}>+</button>
		</div>
	</>} isEmpty={!regions.some((region) => region.trackId === track.id)} hint={t("editor.tracks.empty", "Import video into this track")}>
		{regions.filter((region) => region.trackId === track.id).map((region) => <Item key={region.id} id={region.id} rowId={videoRowId(track.id)} variant="video" videoPath={region.sourcePath} span={{ start: region.startMs, end: region.endMs }} sourceSpan={{ start: region.sourceStartMs, end: region.sourceStartMs + (region.endMs - region.startMs) * region.speed }} disabled={track.locked} isSelected={selectedIds.includes(region.id)} onSelect={() => onSelect(region.id)} muted={track.muted || region.muted}>
			{region.sourcePath.split(/[\\/]/).pop()}
		</Item>)}
	</Row>;
	})}</>;
}
