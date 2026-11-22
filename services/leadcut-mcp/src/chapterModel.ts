/** Pure shared chapter contract used by the desktop and the local MCP. */
export interface Chapter { id: string; title: string; startMs: number; endMs: number }
export interface ChapterStyle {
 fontFamily: string; fontSize: number; height: number; gap: number; radius: number;
 backgroundOpacity: number; playedColor: string; unplayedColor: string;
 playedTextColor: string; unplayedTextColor: string; captionGap: number;
}
export interface ChapterProgress {
 enabled: boolean; confirmed: boolean; chapters: Chapter[]; style: ChapterStyle;
 sequenceSignature: string | null; durationMs: number;
}
export interface ChapterSequence {
 clipRegions?: { id: string; startMs: number; endMs: number; sourceStartMs?: number; speed?: number }[];
 videoRegions?: { id: string; startMs: number; endMs: number; sourceStartMs?: number; speed?: number; sourcePath: string; trackId: string }[];
 audioRegions?: { id: string; startMs: number; endMs: number; sourceStartMs?: number; speed?: number; audioPath: string; trackIndex?: number }[];
}
export const DEFAULT_CHAPTER_STYLE: ChapterStyle = {
 fontFamily: 'Microsoft YaHei', fontSize: 40, height: 58, gap: 14, radius: 7,
 backgroundOpacity: 140 / 255, playedColor: '#f0f0f0', unplayedColor: '#1c1c1c',
 playedTextColor: '#171717', unplayedTextColor: '#f2f2f2', captionGap: 24,
};
export function emptyChapterProgress(): ChapterProgress {
 return { enabled: false, confirmed: false, chapters: [], style: { ...DEFAULT_CHAPTER_STYLE }, sequenceSignature: null, durationMs: 0 };
}
export function chapterSequenceDuration(sequence: ChapterSequence): number {
 return Math.max(0, ...(sequence.clipRegions ?? []).map(r => r.endMs), ...(sequence.videoRegions ?? []).map(r => r.endMs), ...(sequence.audioRegions ?? []).map(r => r.endMs));
}
export function chapterSequenceSignature(sequence: ChapterSequence): string {
 const sort = <T extends {id:string;startMs:number}>(items:T[]) => [...items].sort((a,b) => a.startMs-b.startMs || a.id.localeCompare(b.id));
 const clips = sort(sequence.clipRegions ?? []).map(r => [r.id,r.startMs,r.endMs,r.sourceStartMs ?? r.startMs,r.speed ?? 1]);
 const videos = sort(sequence.videoRegions ?? []).map(r => [r.id,r.startMs,r.endMs,r.sourceStartMs ?? 0,r.speed ?? 1,r.sourcePath.replace(/\\/g,'/'),r.trackId]);
 const audio = sort(sequence.audioRegions ?? []).map(r => [r.id,r.startMs,r.endMs,r.sourceStartMs ?? 0,r.speed ?? 1,r.audioPath.replace(/\\/g,'/'),r.trackIndex ?? 0]);
 const text = JSON.stringify([clips,videos,audio]);
 let hash = 2166136261;
 for(let index=0;index<text.length;index++) hash = Math.imul(hash ^ text.charCodeAt(index),16777619);
 return `leadcut-chapters-v1:${(hash>>>0).toString(16)}:${chapterSequenceDuration(sequence)}`;
}
export function validateChapters(chapters: Chapter[], durationMs: number): string | null {
 if (!Number.isFinite(durationMs) || durationMs <= 0) return 'No sequence duration';
 if (!chapters.length || chapters.length > 50) return 'Use 1–50 chapters';
 const ids = new Set<string>();
 for(let i=0;i<chapters.length;i++) {
  const chapter=chapters[i];
  if (!chapter || typeof chapter.id !== 'string' || !chapter.id || ids.has(chapter.id)) return 'Duplicate or missing chapter ID';
  ids.add(chapter.id);
  if (typeof chapter.title !== 'string' || !chapter.title.trim() || chapter.title.length > 80) return 'Chapter titles must contain 1–80 characters';
  if (![chapter.startMs,chapter.endMs].every(Number.isFinite) || chapter.startMs < 0 || chapter.endMs <= chapter.startMs || chapter.endMs > durationMs+0.5) return 'Chapter range is empty or outside the sequence';
  if (Math.abs(chapter.startMs - (i ? chapters[i-1].endMs : 0)) > 0.5) return 'Chapters must be sorted, contiguous and non-overlapping';
 }
 if (Math.abs(chapters[chapters.length-1].endMs-durationMs)>0.5) return 'Chapters must cover the complete sequence';
 return null;
}
export function normalizeChapterStyle(value: unknown): ChapterStyle {
 const raw = value && typeof value === 'object' ? value as Partial<ChapterStyle> : {};
 const number = (key: keyof ChapterStyle, min:number,max:number) => typeof raw[key]==='number' && Number.isFinite(raw[key]) ? Math.max(min,Math.min(max,raw[key] as number)) : DEFAULT_CHAPTER_STYLE[key] as number;
 const color = (key: keyof ChapterStyle) => typeof raw[key]==='string' && /^#[0-9a-f]{6}$/i.test(raw[key] as string) ? raw[key] as string : DEFAULT_CHAPTER_STYLE[key] as string;
 return {fontFamily:typeof raw.fontFamily==='string' && raw.fontFamily.trim() ? raw.fontFamily.slice(0,100) : DEFAULT_CHAPTER_STYLE.fontFamily,
 fontSize:number('fontSize',16,120),height:number('height',40,200),gap:number('gap',0,64),radius:number('radius',0,32),backgroundOpacity:number('backgroundOpacity',0,1),captionGap:number('captionGap',0,120),
 playedColor:color('playedColor'),unplayedColor:color('unplayedColor'),playedTextColor:color('playedTextColor'),unplayedTextColor:color('unplayedTextColor')};
}
export function normalizeChapterProgress(value: unknown): ChapterProgress {
 const raw = value && typeof value === 'object' ? value as Partial<ChapterProgress> : {};
 const chapters = Array.isArray(raw.chapters) ? raw.chapters.slice(0,50).filter(c => c && typeof c.id === 'string' && typeof c.title === 'string' && Number.isFinite(c.startMs) && Number.isFinite(c.endMs)).map(c => ({id:c.id,title:c.title.slice(0,80),startMs:c.startMs,endMs:c.endMs})) : [];
 const durationMs=typeof raw.durationMs==='number' && Number.isFinite(raw.durationMs) ? Math.max(0,raw.durationMs) : 0;
 const signature=typeof raw.sequenceSignature==='string' ? raw.sequenceSignature : null;
 const confirmed=raw.confirmed===true && signature!==null && !validateChapters(chapters,durationMs);
 return {enabled:raw.enabled===true,confirmed,chapters,style:normalizeChapterStyle(raw.style),sequenceSignature:signature,durationMs};
}
export function chapterProgressStatus(value: ChapterProgress | undefined, sequence?: ChapterSequence): 'off'|'draft'|'stale'|'ready' {
 if (!value?.enabled) return 'off';
 if (!value.confirmed || !value.sequenceSignature || validateChapters(value.chapters,value.durationMs)) return 'draft';
 if (sequence && value.sequenceSignature !== chapterSequenceSignature(sequence)) return 'stale';
 return 'ready';
}
export function confirmChapterProgress(value: ChapterProgress, sequence: ChapterSequence): ChapterProgress {
 const durationMs=chapterSequenceDuration(sequence),error=validateChapters(value.chapters,durationMs);
 if(error)throw new Error(error);
 return {...value,enabled:true,confirmed:true,durationMs,sequenceSignature:chapterSequenceSignature(sequence)};
}
