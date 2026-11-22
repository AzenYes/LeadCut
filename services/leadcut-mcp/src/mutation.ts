import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openProject,resolveProjectPath,saveProject,type LeadcutProject} from './projectStore.js';
import {assertProjectNotOpen} from './editorLock.js';
export const hash=(raw:string)=>createHash('sha256').update(raw).digest('hex');
export const reply=(data:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(data,null,2)}]});
const queues = new Map<string, Promise<unknown>>();

// Serialize this server's writes and verify revisions against edits from other processes.
async function locked<T>(file: string, action: () => Promise<T>): Promise<T> {
	const key = process.platform === "win32" ? file.toLowerCase() : file;
	const previous = queues.get(key) ?? Promise.resolve();
	const current = previous.catch(() => undefined).then(action);
	queues.set(key, current);
	try {
		return await current;
	} finally {
		if (queues.get(key) === current) queues.delete(key);
	}
}

export async function readProjectSnapshot(name: string) {
	const file = path.resolve(await resolveProjectPath(name));
	const raw = await fs.readFile(file, "utf8");
	const project = await openProject(file);
	if (await fs.readFile(file, "utf8") !== raw) throw new Error("Project changed while reading; retry.");
	return { file, project, revision: hash(raw) };
}

type MutationResult = { project: LeadcutProject; [key: string]: unknown };

export async function mutate(project:string,dryRun:boolean,expectedRevision:string|undefined,edit:(p:LeadcutProject, file: string) => MutationResult | Promise<MutationResult>){
 const file=path.resolve(await resolveProjectPath(project));
 return locked(file,async()=>{
  const openInEditor=await assertProjectNotOpen(file,dryRun);
  const raw=await fs.readFile(file,'utf8'),revision=hash(raw);
  if(!dryRun&&!expectedRevision)throw new Error('expectedRevision is required for writes.');
  if(expectedRevision!==undefined&&expectedRevision!==revision)throw new Error('Project changed; reopen before editing.');
  const p=await openProject(file);if(await fs.readFile(file,'utf8')!==raw)throw new Error('Project changed while loading.');
  const {project:next,...details}=await edit(p,file);const changed=JSON.stringify(p)!==JSON.stringify(next);
  let backupPath:string|null=null,afterRevision=revision;
  if(!dryRun&&changed){
   await assertProjectNotOpen(file,false);
   const dir=path.join(path.dirname(file),'.mcp-backups');await fs.mkdir(dir,{recursive:true});backupPath=path.join(dir,`${path.basename(file)}.${Date.now()}-${randomUUID()}.leadcut`);
   await fs.writeFile(backupPath,raw,{encoding:'utf8',flag:'wx'});
   if(await fs.readFile(file,'utf8')!==raw)throw new Error('Project changed before save.');
   await assertProjectNotOpen(file,false);
   await saveProject(file,next);afterRevision=hash(await fs.readFile(file,'utf8'));
  }
  return reply({...details,project:file,dryRun,changed,revision:afterRevision,backupPath,reloadRequired:changed&&!dryRun,...(openInEditor?{openInEditor}: {})});
 });
}
