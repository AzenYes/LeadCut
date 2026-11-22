import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {resolveProjectPath} from './projectStore.js';
import {hash,mutate,reply} from './mutation.js';
import {TIMELINE_MODEL} from './sequence.js';
import {chapterProgressStatus,chapterSequenceDuration,chapterSequenceSignature,confirmChapterProgress,normalizeChapterProgress,normalizeChapterStyle,validateChapters,type ChapterSequence} from './chapterModel.js';

const time=z.number().finite().nonnegative();
const chapter=z.object({id:z.string().min(1).optional(),title:z.string().trim().min(1).max(80),startMs:time,endMs:time}).strict();
const color=z.string().regex(/^#[0-9a-f]{6}$/i);
const style=z.object({
 fontFamily:z.string().trim().min(1).max(100).optional(),fontSize:z.number().min(16).max(120).optional(),
 height:z.number().min(40).max(200).optional(),gap:z.number().min(0).max(64).optional(),radius:z.number().min(0).max(32).optional(),
 backgroundOpacity:z.number().min(0).max(1).optional(),captionGap:z.number().min(0).max(120).optional(),
 playedColor:color.optional(),unplayedColor:color.optional(),playedTextColor:color.optional(),unplayedTextColor:color.optional(),
}).strict();
const args={project:z.string().min(1),timelineModel:z.literal(TIMELINE_MODEL),dryRun:z.boolean().default(true),expectedRevision:z.string().optional()};
export function registerChapterTools(server:McpServer){
 server.tool('list_chapters','Read native chapter draft, confirmation status, sequence clock and revision. Times are SEQUENCE milliseconds.',{project:z.string()},async({project})=>{
  const file=await resolveProjectPath(project),raw=await fs.readFile(file,'utf8'),p=JSON.parse(raw);
  const value=normalizeChapterProgress(p.editor.chapterProgress),seq=p.editor as ChapterSequence;
  return reply({project:file,revision:hash(raw),timelineModel:TIMELINE_MODEL,durationMs:chapterSequenceDuration(seq),sequenceSignature:chapterSequenceSignature(seq),status:chapterProgressStatus(value,seq),chapterProgress:value});
 });
 server.tool('set_chapters','Save a reviewed chapter draft covering the complete sequence. Drafts stay disabled. Set confirmedByUser only after the human has approved these exact names and ranges. Save/close LeadCut, copy first, dryRun, then write with expectedRevision.',{...args,chapters:z.array(chapter).min(1).max(50),style:style.optional(),confirmedByUser:z.boolean().default(false)},async({project,dryRun,expectedRevision,chapters,style:patch,confirmedByUser})=>mutate(project,dryRun,expectedRevision,p=>{
  const seq=p.editor as ChapterSequence,durationMs=chapterSequenceDuration(seq),items=chapters.map(c=>({...c,id:c.id??randomUUID()}));
  const error=validateChapters(items,durationMs);if(error)throw new Error(error);
  const old=normalizeChapterProgress(p.editor.chapterProgress);
  let value={...old,chapters:items,style:normalizeChapterStyle({...old.style,...patch}),enabled:false,confirmed:false,sequenceSignature:null as string|null,durationMs};
  if(confirmedByUser)value=confirmChapterProgress(value,seq);
  return {project:{...p,editor:{...p.editor,chapterProgress:value}},status:chapterProgressStatus(value,seq),chapterProgress:value};
 }));
 server.tool('confirm_chapters','Confirm the existing chapter draft ONLY after human approval, including a new review after sequence cuts, ordering or speed changes.',{...args,confirmedByUser:z.literal(true)},async({project,dryRun,expectedRevision})=>mutate(project,dryRun,expectedRevision,p=>{
  const value=confirmChapterProgress(normalizeChapterProgress(p.editor.chapterProgress),p.editor as ChapterSequence);
  return {project:{...p,editor:{...p.editor,chapterProgress:value}},status:'ready',chapterProgress:value};
 }));
 server.tool('update_chapter_style','Update native chapter appearance in 4K reference pixels, preserving chapter timing and captions. Enable only current, confirmed chapters.',{...args,style:style.optional(),enabled:z.boolean().optional()},async({project,dryRun,expectedRevision,style:patch,enabled})=>mutate(project,dryRun,expectedRevision,p=>{
  const old=normalizeChapterProgress(p.editor.chapterProgress),value={...old,style:normalizeChapterStyle({...old.style,...patch}),enabled:enabled??old.enabled};
  if(value.enabled&&chapterProgressStatus(value,p.editor as ChapterSequence)!=='ready')throw new Error('Chapters require human review and confirmation before enabling.');
  return {project:{...p,editor:{...p.editor,chapterProgress:value}},chapterProgress:value};
 }));
}
