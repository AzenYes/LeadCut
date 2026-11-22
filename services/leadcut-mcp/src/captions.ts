import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {resolveProjectPath} from './projectStore.js';
import {hash,mutate,reply} from './mutation.js';
import {TIMELINE_MODEL,sequence} from './sequence.js';
const time=z.number().finite().nonnegative();
const word=z.object({text:z.string(),startMs:time,endMs:time,leadingSpace:z.boolean().optional(),timingUnreliable:z.boolean().optional()});
const captionText = z.string().trim().min(1);
const cue=z.object({id:z.string().min(1).optional(),text:captionText,startMs:time,endMs:time,words:z.array(word).optional()});
type EditableCaption = z.infer<typeof cue> & { id: string; timeBasis?: 'source' | 'timeline' };
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
const settings = z.object({
	enabled: z.boolean().optional(),
	timelineQuickAdd: z.boolean().optional(),
	language: z.string().trim().min(1).optional(),
	fontFamily: z.string().trim().min(1).optional(),
	fontSize: z.number().min(16).max(72).optional(),
	bottomOffset: z.number().min(0).max(95).optional(),
	horizontalOffset: z.number().min(-50).max(50).optional(),
	maxWidth: z.number().min(40).max(95).optional(),
	maxRows: z.number().int().min(1).max(4).optional(),
	animationStyle: z.enum(["none", "fade", "rise", "pop"]).optional(),
	boxRadius: z.number().min(0).max(40).optional(),
	textColor: color.optional(),
	inactiveTextColor: color.optional(),
	backgroundOpacity: z.number().min(0).max(1).optional(),
	fontWeight: z.enum(["normal", "medium", "bold"]).optional(),
	strokeWidth: z.number().min(0).max(12).optional(),
	strokePosition: z.enum(["center", "outside"]).optional(),
	strokeColor: color.optional(),
	shadowEnabled: z.boolean().optional(),
	shadowColor: color.optional(),
	shadowOpacity: z.number().min(0).max(1).optional(),
	shadowBlur: z.number().min(0).max(30).optional(),
	shadowOffsetX: z.number().min(-30).max(30).optional(),
	shadowOffsetY: z.number().min(-30).max(30).optional(),
}).strict();
const args={project:z.string().min(1),timelineModel:z.literal(TIMELINE_MODEL),dryRun:z.boolean().default(true),expectedRevision:z.string().optional()};
function validate(cues:EditableCaption[]){
 const ids=new Set();const bases=new Set();
 for(const c of cues){
  if(!c.id||ids.has(c.id)||!Number.isFinite(c.startMs)||!Number.isFinite(c.endMs)||c.endMs<=c.startMs||c.startMs<0||typeof c.text!=='string')throw new Error('Invalid caption span/text or duplicate ID.');
  ids.add(c.id);bases.add(c.timeBasis??'source');
  if(c.words){let end=c.startMs;for(const w of c.words){if(w.startMs<end||w.endMs<=w.startMs||w.endMs>c.endMs)throw new Error('Words must be ordered and inside their caption.');end=w.endMs;}}
 }
 if(bases.size>1)throw new Error('Cannot mix source and timeline captions; replace the track or convert first.');
 return cues.sort((a,b)=>a.startMs-b.startMs||a.endMs-b.endMs);
}
export function registerCaptionTools(server:McpServer){
 server.tool('list_captions','Read native captions, their clock, editable style and revision.',{project:z.string()},async({project})=>{
  const file=await resolveProjectPath(project),raw=await fs.readFile(file,'utf8'),p=JSON.parse(raw);return reply({project:file,revision:hash(raw),cues:p.editor.autoCaptions??[],settings:p.editor.autoCaptionSettings??{}});
 });
 server.tool('set_captions','Replace or append reviewed captions. timeBasis source uses original video milliseconds; timeline uses current packed sequence. All cues must share one clock.',{...args,timeBasis:z.enum(['source','timeline']),cues:z.array(cue).min(1),mode:z.enum(['replace','append']).default('replace'),settings:settings.optional()},async({project,dryRun,expectedRevision,cues,timeBasis,mode,settings:style})=>mutate(project,dryRun,expectedRevision,p=>{
  sequence(p);const next: EditableCaption[] = cues.map(c=>({...c,id:c.id??randomUUID(),...(timeBasis==='timeline'?{timeBasis}: {})}));
  return {project:{...p,editor:{...p.editor,autoCaptions:validate([...(mode==='append'?(p.editor.autoCaptions as EditableCaption[]??[]):[]),...next]),autoCaptionSettings:{...(p.editor.autoCaptionSettings as object??{}),enabled:true,...style}}}};
 }));
 server.tool('update_caption','Edit one caption in its existing clock; text-only edits clear stale word timestamps.',{...args,captionId:z.string(),text:captionText.optional(),startMs:time.optional(),endMs:time.optional(),words:z.array(word).optional()},async({project,dryRun,expectedRevision,captionId,text,startMs,endMs,words})=>mutate(project,dryRun,expectedRevision,p=>{
  sequence(p);const cues=(p.editor.autoCaptions??[]) as EditableCaption[];if(!cues.some(c=>c.id===captionId))throw new Error('Caption ID not found.');
  const patch=Object.fromEntries(Object.entries({text,startMs,endMs,words}).filter(([,v])=>v!==undefined));if(!Object.keys(patch).length)throw new Error('Supply a caption change.');
  const next=cues.map(c=>{if(c.id!==captionId)return c;const n={...c,...patch};if((text!==undefined||startMs!==undefined||endMs!==undefined)&&words===undefined)delete n.words;return n;});
  return {project:{...p,editor:{...p.editor,autoCaptions:validate(next)}}};
 }));
 server.tool('delete_captions','Delete only named caption IDs.',{...args,captionIds:z.array(z.string()).min(1)},async({project,dryRun,expectedRevision,captionIds})=>mutate(project,dryRun,expectedRevision,p=>{
  sequence(p);const cues=(p.editor.autoCaptions??[]) as EditableCaption[];if(captionIds.some(id=>!cues.some(c=>c.id===id)))throw new Error('Caption ID not found.');return {project:{...p,editor:{...p.editor,autoCaptions:cues.filter(c=>!captionIds.includes(c.id))}}};
 }));
 server.tool('update_caption_settings','Edit LeadCut native caption style within the desktop editor ranges, preserving text and timing.',{...args,settings},async({project,dryRun,expectedRevision,settings:style})=>mutate(project,dryRun,expectedRevision,p=>{
  sequence(p);if(!Object.keys(style).length)throw new Error('Supply at least one setting.');return {project:{...p,editor:{...p.editor,autoCaptionSettings:{...(p.editor.autoCaptionSettings as object??{}),...style}}}};
 }));
}
