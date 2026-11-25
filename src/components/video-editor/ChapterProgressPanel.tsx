import { useI18n } from "@/contexts/I18nContext";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CaptionFontPicker } from "./CaptionFontPicker";
import { chapterProgressStatus, chapterSequenceDuration, confirmChapterProgress, normalizeChapterStyle, validateChapters, type ChapterProgress, type ChapterSequence, type ChapterStyle } from "./chapterProgress";
import { formatTimelineTimecode, parseTimelineTimecode } from "./timeline/core/time";

export function ChapterProgressPanel({ value, onChange, sequence, getCurrentTime, onSeek }: {
 value:ChapterProgress;onChange:(value:ChapterProgress)=>void;sequence:ChapterSequence;getCurrentTime:()=>number;onSeek:(seconds:number)=>void;
}) {
 const {t}=useI18n();const [message,setMessage]=useState('');
 const updateStyle = (patch: Partial<ChapterStyle>) => {
  onChange({ ...value, style: normalizeChapterStyle({ ...value.style, ...patch }) });
 };
 const durationMs=chapterSequenceDuration(sequence),status=chapterProgressStatus({...value,enabled:true},sequence);
 const draft=(chapters:ChapterProgress['chapters'])=>{setMessage('');onChange({...value,chapters,confirmed:false,enabled:false});};
 const confirm=()=>{try {onChange(confirmChapterProgress(value,sequence));setMessage('');}catch{setMessage(t('editor.chapters.invalid','Chapters must cover the full sequence in order, without overlaps or gaps.'));}};
 const add=()=>{
  if(!durationMs)return;
  const title=t('editor.chapters.chapter','Chapter')+` ${value.chapters.length+1}`;
  if(!value.chapters.length){draft([{id:crypto.randomUUID(),title,startMs:0,endMs:durationMs}]);return;}
  const currentTimeMs = getCurrentTime() * 1000;
  const index=value.chapters.findIndex(c=>currentTimeMs>c.startMs&&currentTimeMs<c.endMs);
  if(index<0){setMessage(t('editor.chapters.seekToSplit','Move the playhead inside a chapter to add a boundary.'));return;}
  const atMs=Math.round(currentTimeMs),current=value.chapters[index];draft(value.chapters.flatMap((c,i)=>i===index?[{...c,endMs:atMs},{id:crypto.randomUUID(),title,startMs:atMs,endMs:current.endMs}]:[c]));
 };
 return <section className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5" aria-label={t('editor.chapters.title','Chapters')}>
  <h2 className="mb-3 text-sm font-semibold">{t('editor.chapters.title','Chapters')}</h2>
  <p className="mb-4 text-xs text-muted-foreground">{t('editor.chapters.workflow','Review chapter suggestions, then confirm to show them in preview and export.')}</p>
  <label className="mb-4 flex items-center justify-between text-sm">{t('editor.chapters.show','Show chapter progress')}<input type="checkbox" aria-label={t('editor.chapters.show','Show chapter progress')} checked={value.enabled} disabled={!value.enabled && status!=='ready'} onChange={event=>onChange({...value,enabled:event.target.checked})}/></label>
  {(status==='stale'||(!value.confirmed&&value.chapters.length>0))&&<p role="status" className="mb-3 rounded bg-amber-500/10 p-2 text-xs text-amber-700">{t('editor.chapters.review','Chapters need confirmation. Editing the sequence requires a new review.')}</p>}
  <div className="space-y-3">
   {value.chapters.map((chapter,index)=><div key={chapter.id} className="space-y-2 rounded border border-foreground/10 p-2" data-chapter-id={chapter.id}>
    <div className="flex gap-2"><button type="button" aria-label={`${t('editor.chapters.jump','Jump to chapter')} ${index+1}`} className="text-xs text-accent" onClick={()=>onSeek(chapter.startMs/1000)}>{index+1}</button><input aria-label={`${t('editor.chapters.name','Chapter name')} ${index+1}`} className="min-w-0 flex-1 rounded bg-foreground/5 px-2 py-1 text-sm" maxLength={80} value={chapter.title} onChange={event=>draft(value.chapters.map((c,i)=>i===index?{...c,title:event.target.value}:c))}/></div>
    <div className="flex gap-1 text-xs"><input key={`${chapter.id}:${chapter.startMs}`} aria-label={`${t('editor.chapters.start','Chapter start')} ${index+1}`} className="w-28 rounded bg-foreground/5 p-1 font-mono" defaultValue={formatTimelineTimecode(chapter.startMs)} onBlur={event=>{const time=parseTimelineTimecode(event.target.value);if(time!==null&&time!==chapter.startMs)draft(value.chapters.map((c,i)=>i===index?{...c,startMs:time}:i===index-1?{...c,endMs:time}:c));}}/><span>—</span><input key={`${chapter.id}:${chapter.endMs}`} aria-label={`${t('editor.chapters.end','Chapter end')} ${index+1}`} className="w-28 rounded bg-foreground/5 p-1 font-mono" defaultValue={formatTimelineTimecode(chapter.endMs)} onBlur={event=>{const time=parseTimelineTimecode(event.target.value);if(time!==null&&time!==chapter.endMs)draft(value.chapters.map((c,i)=>i===index?{...c,endMs:time}:i===index+1?{...c,startMs:time}:c));}}/></div>
   </div>)}
  </div>
  <Button className="mt-3" variant="outline" onClick={add}>{t('editor.chapters.add','Add chapter at playhead')}</Button>
  <Button className="mt-2" onClick={confirm} disabled={Boolean(validateChapters(value.chapters,durationMs))}>{t('editor.chapters.confirm','Confirm chapters and enable')}</Button>
  {message&&<p role="alert" className="mt-2 text-xs text-red-500">{message}</p>}
  <h3 className="mb-2 mt-5 text-xs font-semibold">{t('editor.chapters.style','Progress bar style')}</h3>
  {([
   ['backgroundOpacity', t('editor.chapters.opacity', 'Background opacity'), 0, 1, 0.01],
   ['fontSize', t('editor.chapters.fontSize', 'Font size'), 16, 120, 1],
   ['height', t('editor.chapters.height', 'Bar height'), 40, 200, 1],
   ['gap', t('editor.chapters.gap', 'Chapter gap'), 0, 64, 1],
  ] as const).map(([key, label, min, max, step]) => (
   <label key={key} className="mb-2 flex items-center justify-between text-xs">
    {label}
    <input type="number" className="w-20 rounded bg-foreground/5 p-1" min={min} max={max} step={step}
     value={Math.round(value.style[key] * 100) / 100} onChange={event => {
      if (event.currentTarget.value !== '') updateStyle({ [key]: event.currentTarget.valueAsNumber });
     }} />
   </label>
  ))}
  {([
   ['playedColor', t('editor.chapters.playedColor', 'Played bar color')],
   ['unplayedColor', t('editor.chapters.unplayedColor', 'Unplayed bar color')],
   ['playedTextColor', t('editor.chapters.playedTextColor', 'Played text color')],
   ['unplayedTextColor', t('editor.chapters.unplayedTextColor', 'Unplayed text color')],
  ] as const).map(([key, label]) => (
   <label key={key} className="mb-2 flex items-center justify-between gap-2 text-xs">
    {label}
    <input type="color" className="h-6 w-20 shrink-0 cursor-pointer rounded bg-foreground/5 px-1"
     value={value.style[key]} onChange={event => updateStyle({ [key]: event.currentTarget.value })} />
   </label>
  ))}
  <CaptionFontPicker label={t('editor.chapters.fontFamily', 'Font')} value={value.style.fontFamily}
   onChange={fontFamily => updateStyle({ fontFamily })} />
 </section>;
}
