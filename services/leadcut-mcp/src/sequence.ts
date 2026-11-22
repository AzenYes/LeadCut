import {randomUUID} from 'node:crypto';
import type {LeadcutProject} from './projectStore.js';
import { intersectCutWithClip, type ChangeConfidence, type ChangeLogEntry } from './changeLogModel.js';
import { rippleProjectTracks, summarizeTrackEdit } from './rippleProjectTracks.js';

export type Span = {startMs:number;endMs:number};
type ExplainedRange = Span & { reason?: string; confidence?: ChangeConfidence };
type CaptionWord = Span & {text:string;leadingSpace?:boolean};
export type Clip = Span & {id:string;sourceStartMs:number;speed:number;[key:string]:unknown};
export type Mapping = Span & {clipId:string;originalClipId:string;sourceStartMs:number;sourceEndMs:number;outputStartMs:number;outputEndMs:number;speed:number};
export const TIMELINE_MODEL = 'leadcut-sequence-v1';
export function sequence(project:LeadcutProject):Clip[] {
 if(project.version!==2) throw new Error('LeadCut version-2 project required.');
 const list=project.editor.clipRegions;
 if(!Array.isArray(list)||!list.length) throw new Error('Save the project in LeadCut first: nonempty clipRegions required.');
 if(Array.isArray(project.editor.speedRegions)&&project.editor.speedRegions.length) throw new Error('Legacy speedRegions are unsupported; save/normalize in LeadCut first.');
 const ids=new Set<string>();let end=0;
 return [...list].sort((a,b)=>a.startMs-b.startMs).map(c=>{
  const speed=c.speed??1,sourceStartMs=c.sourceStartMs??c.startMs;
  if(!c.id||ids.has(c.id)||![c.startMs,c.endMs,sourceStartMs,speed].every(Number.isFinite)||c.startMs!==end||c.endMs<=c.startMs||sourceStartMs<0||speed<=0||['sourcePath','videoPath'].some(k=>k in c)) throw new Error('Invalid or unpacked sequence; save it in LeadCut before editing.');
  if((c.sourceMinMs!==undefined&&sourceStartMs<c.sourceMinMs)||(c.sourceMaxMs!==undefined&&sourceStartMs+(c.endMs-c.startMs)*speed>c.sourceMaxMs+1)) throw new Error('Clip exceeds media source bounds.');
  ids.add(c.id);end=c.endMs;return {...c,sourceStartMs,speed};
 });
}
export function mergeRanges(ranges:Span[]):Span[]{
 const out:Span[]=[];
 for(const r of [...ranges].sort((a,b)=>a.startMs-b.startMs)){
  if(!Number.isFinite(r.startMs)||!Number.isFinite(r.endMs)||r.startMs<0||r.endMs<=r.startMs)throw new Error('Invalid cut range.');
  const last=out.at(-1);if(last&&r.startMs<=last.endMs)last.endMs=Math.max(last.endMs,r.endMs);else out.push({...r});
 }return out;
}
function retained(span:Span,cuts:Span[]):Span[]{
 let cursor=span.startMs;const result:Span[]=[];
 for(const cut of cuts){if(cut.endMs<=cursor||cut.startMs>=span.endMs)continue;if(cut.startMs>cursor)result.push({startMs:cursor,endMs:cut.startMs});cursor=Math.min(span.endMs,Math.max(cursor,cut.endMs));}
 if(cursor<span.endMs)result.push({startMs:cursor,endMs:span.endMs});return result;
}

function removedTimelineRanges(mapping: readonly Mapping[], durationMs: number): Span[] {
	const removed: Span[] = [];
	let cursor = 0;
	for (const kept of mapping) {
		if (kept.startMs - cursor > 1e-7) removed.push({ startMs: cursor, endMs: kept.startMs });
		cursor = kept.endMs;
	}
	if (durationMs - cursor > 1e-7) removed.push({ startMs: cursor, endMs: durationMs });
	return removed;
}

export function planCuts(project:LeadcutProject,ranges:ExplainedRange[],timeBasis:'source'|'timeline'){
 const clips=sequence(project);
 const cutPieces = ranges.flatMap((range, rangeIndex) => clips.flatMap(clip => {
  const intersection = intersectCutWithClip(range, clip, timeBasis);
  return intersection ? [{ range, rangeIndex, intersection }] : [];
 }));
 const cuts=mergeRanges(ranges.map(({ startMs, endMs }) => ({ startMs, endMs }))),mapping:Mapping[]=[],next:Clip[]=[];
 const previous=clips.at(-1)!.endMs;let cursor=0;
 const limit=timeBasis==='timeline'?previous:Math.max(...clips.map(c=>c.sourceStartMs+(c.endMs-c.startMs)*c.speed));
 if(cuts.some(c=>c.endMs>limit))throw new Error('Cut exceeds current timeline/source bounds.');
 for(const clip of clips){
  const sourceEnd=clip.sourceStartMs+(clip.endMs-clip.startMs)*clip.speed;
  const span=timeBasis==='source'?{startMs:clip.sourceStartMs,endMs:sourceEnd}:clip;
  retained(span,cuts).forEach((piece,i)=>{
   const startMs=timeBasis==='timeline'?piece.startMs:clip.startMs+(piece.startMs-clip.sourceStartMs)/clip.speed;
   const endMs=timeBasis==='timeline'?piece.endMs:clip.startMs+(piece.endMs-clip.sourceStartMs)/clip.speed;
   const sourceStartMs=clip.sourceStartMs+(startMs-clip.startMs)*clip.speed;
   const id=i===0?clip.id:randomUUID(),duration=endMs-startMs;
   next.push({...clip,id,startMs:cursor,endMs:cursor+duration,sourceStartMs});
   mapping.push({clipId:id,originalClipId:clip.id,startMs,endMs,sourceStartMs,sourceEndMs:sourceStartMs+duration*clip.speed,outputStartMs:cursor,outputEndMs:cursor+duration,speed:clip.speed});cursor+=duration;
  });
 }
 if(!next.length)throw new Error('Refusing to remove all footage.');
 const changed=Math.abs(cursor-previous)>1e-7;
 const mapSpan=(region:Span)=>mapping.flatMap(m=>{
  const start=Math.max(region.startMs,m.startMs),end=Math.min(region.endMs,m.endMs);
  return end>start?[{startMs:m.outputStartMs+start-m.startMs,endMs:m.outputStartMs+end-m.startMs}]:[];
 });
 const ripple=(regions:unknown):unknown[]=>{
  if(regions===undefined)return [];if(!Array.isArray(regions))throw new Error('Invalid effect track.');
  return regions.flatMap(r=>{const spans=mapSpan(r);return spans.length?[{...r,startMs:Math.min(...spans.map(s=>s.startMs)),endMs:Math.max(...spans.map(s=>s.endMs))}]:[];});
 };
 const anchor=(time:number)=>{
  if(time>=previous)return cursor+time-previous;
  const owner=mapping.find(m=>time>=m.startMs&&time<m.endMs);
  return owner?owner.outputStartMs+time-owner.startMs:mapping.find(m=>m.startMs>=time)?.outputStartMs??cursor;
 };
 const auxiliary = rippleProjectTracks(project.editor, removedTimelineRanges(mapping, previous));
 const editor={...project.editor,...auxiliary.updates,clipRegions:next,trimRegions:[],zoomRegions:ripple(project.editor.zoomRegions),annotationRegions:ripple(project.editor.annotationRegions)};
 const tracks=project.editor.sourceAudioTrackSettingsByClip as Record<string,unknown>|undefined;
 if(tracks)Object.assign(editor,{sourceAudioTrackSettingsByClip:Object.fromEntries(mapping.filter(m=>Object.hasOwn(tracks,m.originalClipId)).map(m=>[m.clipId,tracks[m.originalClipId]]))});
 const captions=project.editor.autoCaptions;
 if(Array.isArray(captions)){
  const bases=new Set(captions.map(c=>c.timeBasis??'source'));if(bases.size>1)throw new Error('Mixed caption clocks unsupported by LeadCut renderer.');
  Object.assign(editor,{autoCaptions:captions.flatMap(c=>{
   if(c.timeBasis!=='timeline')return [c];
   const spans=mapSpan(c);return spans.map((s,i)=>{
    const words=Array.isArray(c.words)?(c.words as CaptionWord[]).flatMap(w=>mapSpan(w).filter(ws=>ws.startMs<s.endMs&&ws.endMs>s.startMs).map(ws=>({...w,startMs:Math.max(ws.startMs,s.startMs),endMs:Math.min(ws.endMs,s.endMs)}))):undefined;
    return {...c,...s,id:i?randomUUID():c.id,...(words?{words,text:words.map(w=>(w.leadingSpace?' ':'')+w.text).join('').trim()}: {})};
   });
  })});
 }
 const changeLogAdded: ChangeLogEntry[] = [];
 if (changed && cutPieces.length) {
  const batchId = randomUUID();
  const createdAt = new Date().toISOString();
  for (const { range, rangeIndex, intersection } of cutPieces) {
   const { sourceStartMs, sourceEndMs, speed, durationMs, timelineStartMs, timelineEndMs } = intersection;
   const afterClipId = mapping.find(piece => piece.startMs >= timelineEndMs)?.clipId;
   changeLogAdded.push({
    id: randomUUID(), kind: 'cut', source: 'agent', createdAt, batchId, rangeIndex,
    sourceStartMs, sourceEndMs, speed, durationMs, timelineMs: Math.round(anchor(timelineStartMs)),
    ...(afterClipId ? { afterClipId } : {}),
    ...(range.reason ? { reason: range.reason } : {}),
    ...(range.confidence ? { confidence: range.confidence } : {}),
    review: 'pending',
   });
  }
  const existing = project.editor.changeLog as { version?: unknown; entries?: unknown } | undefined;
  const previousEntries = existing?.version === 1 && Array.isArray(existing.entries) ? existing.entries : [];
  Object.assign(editor, { changeLog: { version: 1, entries: [...previousEntries, ...changeLogAdded] } });
 }
 return {
  project:changed?{...project,editor}:project,mapping,cuts,changed,removedMs:previous-cursor,outputDurationMs:cursor,changeLogAdded,
  tracks: [summarizeTrackEdit("primary", clips, next), ...auxiliary.summaries],
  lockedTracks: auxiliary.lockedTracks,
 };
}
