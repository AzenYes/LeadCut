import {planCuts,TIMELINE_MODEL} from './sequence.js';
import {mutate} from './mutation.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {getProjectFileExtension, getProjectsDir, getRecordingsDir, getUserDataDir, stripProjectExtension} from './paths.js';
import {openProject, resolveProjectPath} from './projectStore.js';
const reply = (value: unknown) => ({content:[{type:'text' as const,text:JSON.stringify(value,null,2)}]});
const time = z.number().finite().int().nonnegative();

export function registerProjectEditingTools(server:McpServer) {
 server.tool('get_paths','Resolve the actual recordings and Projects directories, including custom recordings-settings.json.',{},async()=>reply({application:'LeadCut',timelineModel:TIMELINE_MODEL,userDataDir:getUserDataDir(),recordingsDir:await getRecordingsDir(),projectsDir:await getProjectsDir()}));
 server.tool('copy_project','Create a new editable project copy directly in the desktop Projects directory. Preserves media references, assigns a new projectId, and never overwrites.',
  {project:z.string().min(1),name:z.string().min(1)},async({project,name})=>{
   const stem=stripProjectExtension(name);
   const hasControlCharacter = Array.from(stem).some(character => character.charCodeAt(0) < 0x20);
   if (!stem.trim() || stem!==stem.trim() || /[<>:"/\\|?*]/.test(stem) || hasControlCharacter || /[. ]$/.test(stem) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) throw new Error('name must be a plain portable filename without path separators.');
   const source=path.resolve(await resolveProjectPath(project));
   const data=await openProject(source);
   // Relative media must still refer to the same file after moving the project.
   const absolute=(value:string)=>path.isAbsolute(value)||/^[a-z]+:/i.test(value)?value:path.resolve(path.dirname(source),value);
   data.videoPath=absolute(data.videoPath);
   const webcam=data.editor.webcam as {sourcePath?:string}|undefined;
   if(webcam?.sourcePath)webcam.sourcePath=absolute(webcam.sourcePath);
   if(Array.isArray(data.editor.audioRegions))for(const region of data.editor.audioRegions)if(region.audioPath)region.audioPath=absolute(region.audioPath);
   const target=path.join(await getProjectsDir(),`${stem}.${getProjectFileExtension()}`);
   await fs.writeFile(target,JSON.stringify({...data,projectId:randomUUID()},null,2),{encoding:'utf8',flag:'wx'});
   return reply({project:target,source,mediaCopied:false,visibleInProjectLibrary:true});
  });
 server.tool('cut_ranges','Remove reviewed source or timeline ranges; preserve sequence order and speed, ripple effects and timeline captions, return mapping. Source cuts affect every occurrence of that source range.',
  {project:z.string().min(1),timelineModel:z.literal(TIMELINE_MODEL),timeBasis:z.enum(['source','timeline']),ranges:z.array(z.object({
   startMs:time,endMs:time,reason:z.string().trim().max(500).optional(),confidence:z.enum(['high','medium','low']).optional(),
  })).min(1),dryRun:z.boolean().default(true),expectedRevision:z.string().optional()},
  async({project,ranges,timeBasis,dryRun,expectedRevision})=>mutate(project,dryRun,expectedRevision,p=>planCuts(p,ranges,timeBasis)));
}
