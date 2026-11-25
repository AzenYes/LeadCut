import {registerTranscriptionTools} from './transcription.js';
import fs from 'node:fs/promises';
import {registerCaptionTools} from './captions.js';
import {registerChapterTools} from './chapters.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import packageInfo from '../package.json' with {type: 'json'};
import {listProjects,parseProject} from './projectStore.js';
import {getMediaInfo,detectSilence,SILENCE_DETECT_MIN_S,SILENCE_NOISE_DB} from './media.js';
import {extractSampleFrames} from './frames.js';
import {listProjectBackups,mutate,readProjectSnapshot,reply} from './mutation.js';
import {registerZoomEditingTools} from './zoomEditing.js';
import {registerProjectEditingTools} from './projectEditing.js';
import {registerProjectReviewTools} from './reviewTools.js';
import {registerExportProjectTool} from './exportProject.js';
import {assertProjectFormatWritable,PROJECT_FORMAT_VERSION,requiresNewerProjectReader} from './projectFormat.js';
const server=new McpServer({name:'leadcut-mcp',version:packageInfo.version},{instructions:'Local LeadCut editing tools. Return to Home if the project is open in LeadCut. Copy first, dryRun, then supply expectedRevision. Clip start/end and zoom/annotation times are SEQUENCE milliseconds; sourceStartMs points into media. cut_ranges requires explicit timeBasis and leadcut-sequence-v1. Source captions and imported timeline captions use different clocks. Export through LeadCut native rendering.'});
registerZoomEditingTools(server);registerProjectEditingTools(server);registerCaptionTools(server);registerTranscriptionTools(server);registerChapterTools(server);registerProjectReviewTools(server);
registerExportProjectTool(server);
server.tool('list_projects','List projects in the desktop Projects directory.',{},async()=>reply(await listProjects()));
const pageOptions = {
 offset: z.number().int().nonnegative().default(0),
 limit: z.number().int().min(1).max(200).default(50),
};
server.tool('open_project','Read a compact project summary and revision. Use get_clips, get_captions or list_zooms for details.',{project:z.string(),includeEditor:z.boolean().default(false)},async({project,includeEditor})=>{
 const {file,project:data,revision}=await readProjectSnapshot(project);
 if (includeEditor) {
  const {thumbnailPng: _thumbnail, ...details} = data;
  return reply({...details,path:file,revision});
 }
 const counts = Object.fromEntries(
  ["clipRegions","videoTracks","videoRegions","audioTracks","audioRegions","zoomRegions","annotationRegions","autoCaptions"]
   .map(key => [key, Array.isArray(data.editor[key]) ? data.editor[key].length : 0]),
 );
 let durationMs = 0;
 for (const key of ["clipRegions","videoRegions","audioRegions"]) {
  const track = data.editor[key];
  if (!Array.isArray(track)) continue;
  for (const item of track) if (Number.isFinite(item?.endMs)) durationMs = Math.max(durationMs, item.endMs);
 }
 return reply({
  path:file,revision,version:data.version,projectId:data.projectId,videoPath:data.videoPath,
  durationMs,counts,readOnly:requiresNewerProjectReader(data),
 });
});
server.tool('get_revision','Read the current project revision.',{project:z.string()},async({project})=>{
 const {file,revision}=await readProjectSnapshot(project);
 return reply({project:file,revision});
});
server.tool('get_capabilities','Report the supported project format.',{},async()=>
 reply({projectFormatVersion:PROJECT_FORMAT_VERSION,timelineModel:"leadcut-sequence-v1"}));
server.tool('get_clips','Read a page of primary timeline clips.',{project:z.string(),...pageOptions},async({project,offset,limit})=>{
 const {file,project:data,revision}=await readProjectSnapshot(project);
 const clips = Array.isArray(data.editor.clipRegions) ? data.editor.clipRegions : [];
 return reply({project:file,revision,offset,totalCount:clips.length,clips:clips.slice(offset,offset+limit)});
});
server.tool('get_captions','Read a page of native captions and the track style.',{project:z.string(),...pageOptions},async({project,offset,limit})=>{
 const {file,project:data,revision}=await readProjectSnapshot(project);
 const cues = Array.isArray(data.editor.autoCaptions) ? data.editor.autoCaptions : [];
 return reply({project:file,revision,offset,totalCount:cues.length,cues:cues.slice(offset,offset+limit),settings:data.editor.autoCaptionSettings??{}});
});
server.tool('list_backups','List retained Agent backups for the project.',{project:z.string()},async({project})=>{
 const {file,revision}=await readProjectSnapshot(project);
 return reply({project:file,revision,backups:await listProjectBackups(file)});
});
server.tool('restore_backup','Preview or restore an Agent backup using its ID from list_backups.',{
 project:z.string(),backupId:z.string(),dryRun:z.boolean().default(true),expectedRevision:z.string().optional(),
},async({project,backupId,dryRun,expectedRevision})=>mutate(project,dryRun,expectedRevision,async(current,file)=>{
 const backup=(await listProjectBackups(file)).find(entry=>entry.id===backupId);
 if(!backup || !(await fs.lstat(backup.path)).isFile()) throw new Error('Backup ID not found.');
 const restored=parseProject(await fs.readFile(backup.path,"utf8"),file);
 assertProjectFormatWritable(restored);
 const keys=new Set([...Object.keys(current.editor),...Object.keys(restored.editor)]);
 const modifiedEditorFields=[...keys].filter(key=>JSON.stringify(current.editor[key])!==JSON.stringify(restored.editor[key]));
 return {
  project:{...restored,...(restored.thumbnailPng===undefined && current.thumbnailPng!==undefined ? {thumbnailPng:current.thumbnailPng} : {})},
  backupId,modifiedEditorFields,
 };
}));
server.tool('get_media_info','Inspect source video or separate microphone audio.',{filePath:z.string()},async({filePath})=>reply(await getMediaInfo(filePath)));
server.tool('detect_silence','Report candidate quiet intervals in the supplied audio. Add the microphone startDelayMs to use separate audio times on the source video clock.',{filePath:z.string(),minDurationSec:z.number().positive().default(SILENCE_DETECT_MIN_S),noiseDb:z.number().max(0).default(SILENCE_NOISE_DB)},async({filePath,minDurationSec,noiseDb},extra)=>reply(await detectSilence(filePath,{minDurationSec,noiseDb,signal:extra.signal})));
server.tool('scan_frames','Inspect raw source frames around candidate speech cuts or distracting zooms. These frames do not show the project zoom overlay; compare native previews too.',{filePath:z.string(),sampleCount:z.number().int().min(1).max(20).default(6),startMs:z.number().nonnegative().default(0),endMs:z.number().positive().optional(),maxWidth:z.number().int().min(64).max(1920).default(1280)},async({filePath,sampleCount,startMs,endMs,maxWidth},extra)=>{
 if(endMs!==undefined && endMs<=startMs)throw new Error('endMs must exceed startMs');
 const frames=await extractSampleFrames(filePath,sampleCount,{startMs,endMs:endMs??Number.MAX_SAFE_INTEGER},maxWidth,extra.signal);
 return {content:[{type:'text' as const,text:JSON.stringify(frames.map(f=>({timestampMs:f.timestampMs})))},...frames.map(f=>({type:'image' as const,data:f.jpegBase64,mimeType:'image/jpeg'}))]};
});
void server.connect(new StdioServerTransport()).catch(error => {
 console.error("Could not start LeadCut MCP:", error);
 process.exitCode = 1;
});
