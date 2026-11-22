import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
let dir,client,serial=0;
const model='leadcut-sequence-v1';
const base={version:2,projectId:'original',videoPath:'screen.mp4',future:{keep:true},editor:{clipRegions:[{id:'a',startMs:0,endMs:10000,sourceStartMs:0,speed:1,custom:7}],zoomRegions:[{id:'z',startMs:4000,endMs:8000,depth:2}],annotationRegions:[{id:'note',startMs:6000,endMs:7000}],audioRegions:[{id:'music',startMs:6000,endMs:14000}],sourceAudioTrackSettingsByClip:{a:{mic:{volume:.8}}}}};
before(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'leadcut-test-'));await fs.writeFile(path.join(dir,'recordings-settings.json'),'\uFEFF'+JSON.stringify({recordingsDir:path.join(dir,'custom')}));client=new Client({name:'leadcut-tests',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/index.js')],env:{...process.env,LEADCUT_USER_DATA_DIR:dir,RECORDLY_USER_DATA_DIR:path.join(dir,'must-not-use-recordly')}}));});
after(async()=>{await client?.close();if(dir)await fs.rm(dir,{recursive:true,force:true});});
async function fixture(p=base){const f=path.join(dir,`p-${serial++}.leadcut`);await fs.writeFile(f,JSON.stringify(p));return f;}
async function call(name,args={},error=false){const r=await client.callTool({name,arguments:args});if(error){assert.equal(r.isError,true,JSON.stringify(r));return r;}assert(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);}
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
async function write(name,args){const {revision}=await call('open_project',{project:args.project});return call(name,{timelineModel:model,dryRun:false,expectedRevision:revision,...args});}
const cut=(project,ranges,extra={})=>write('cut_ranges',{project,ranges,timeBasis:'source',...extra});
test('cut_ranges preserves the embedded project thumbnail', async () => {
 const thumbnailPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+Rk8eGAAAAABJRU5ErkJggg==';
 const project = await fixture({ ...base, thumbnailPng });
 await cut(project, [{startMs:2000,endMs:5000}]);
 assert.equal((await read(project)).thumbnailPng, thumbnailPng);
});
test('LeadCut custom path, exclusive project copy and unchanged original',async()=>{
 const p=await fixture(),raw=await fs.readFile(p,'utf8'),paths=await call('get_paths');assert.equal(paths.application,'LeadCut');assert.equal(paths.projectsDir,path.join(dir,'custom','Projects'));
 const copy=await call('copy_project',{project:p,name:'测试 剪辑'});assert.equal(path.dirname(copy.project),paths.projectsDir);assert.notEqual((await read(copy.project)).projectId,base.projectId);assert.deepEqual((await read(copy.project)).editor,base.editor);
 for(const name of ['测试 剪辑','../escape','CON','foo.'])await call('copy_project',{project:p,name},true);
 assert.equal(await fs.readFile(p,'utf8'),raw);assert((await call('list_projects')).some(x=>x.path===copy.project));
});
test('source cut repacks clips and ripples effects/audio, copies track settings, exact backup',async()=>{
 const p=await fixture(),raw=await fs.readFile(p,'utf8');const r=await cut(p,[{startMs:2000,endMs:5000}]);assert.equal(r.outputDurationMs,7000);assert.equal(r.removedMs,3000);assert.equal(await fs.readFile(r.backupPath,'utf8'),raw);
 const d=await read(p);assert.deepEqual(d.editor.clipRegions.map(c=>[c.startMs,c.endMs,c.sourceStartMs]),[[0,2000,0],[2000,7000,5000]]);assert.deepEqual(d.editor.zoomRegions.map(c=>[c.startMs,c.endMs]),[[2000,5000]]);assert.deepEqual(d.editor.annotationRegions.map(c=>[c.startMs,c.endMs]),[[3000,4000]]);assert.deepEqual(d.editor.audioRegions.map(c=>[c.startMs,c.endMs]),[[3000,11000]]);assert.deepEqual(d.future,base.future);
 for(const c of d.editor.clipRegions)assert.deepEqual(d.editor.sourceAudioTrackSettingsByClip[c.id],base.editor.sourceAudioTrackSettingsByClip.a);
 const again=await cut(p,[{startMs:2000,endMs:5000}]);assert.equal(again.changed,false);assert.equal(again.backupPath,null);
});
test('reads legacy and current formats while producing current copies and backups', async () => {
 const {projectsDir} = await call('get_paths');
 const legacy = path.join(projectsDir, 'legacy twin.recordly');
 const modern = path.join(projectsDir, 'legacy twin.leadcut');
 const raw = JSON.stringify(base);
 await fs.writeFile(legacy, raw);
 assert.equal((await call('open_project', {project:'legacy twin'})).path, legacy);
 const copy = await call('copy_project', {project:legacy, name:'converted copy.recordly'});
 assert.equal(path.basename(copy.project), 'converted copy.leadcut');
 assert.equal(await fs.readFile(legacy, 'utf8'), raw);
 const edited = await cut(copy.project, [{startMs:2000,endMs:3000}]);
 assert.equal(path.extname(edited.backupPath), '.leadcut');
 await fs.writeFile(modern, raw);
 assert.equal((await call('open_project', {project:'legacy twin'})).path, modern);
 assert.equal((await call('open_project', {project:'legacy twin.recordly'})).path, legacy);
 const entries = await call('list_projects');
 assert(entries.some(entry => entry.path === legacy));
 assert(entries.some(entry => entry.path === modern));
});
test('reordered, accelerated and repeated source clips preserve order and source mapping',async()=>{
 const d=structuredClone(base);d.editor.clipRegions=[{id:'late',startMs:0,endMs:2000,sourceStartMs:8000,speed:2},{id:'early',startMs:2000,endMs:6000,sourceStartMs:0,speed:1},{id:'repeat',startMs:6000,endMs:8000,sourceStartMs:8000,speed:2}];
 const p=await fixture(d);const r=await cut(p,[{startMs:9000,endMs:10000}]);assert.equal(r.removedMs,1000);assert.deepEqual((await read(p)).editor.clipRegions.map(c=>[c.startMs,c.endMs,c.sourceStartMs,c.speed]),[[0,500,8000,2],[500,1500,10000,2],[1500,5500,0,1],[5500,6000,8000,2],[6000,7000,10000,2]]);
 const q=await fixture(d);await cut(q,[{startMs:500,endMs:1000}],{timeBasis:'timeline'});assert.equal((await read(q)).editor.clipRegions.at(-1).sourceStartMs,8000);assert.equal((await read(q)).editor.clipRegions.at(-1).endMs,7500);
});
test('default dry run, missing/stale revision, old model, invalid schema cannot write',async()=>{
 const p=await fixture(),raw=await fs.readFile(p,'utf8'),ranges=[{startMs:1000,endMs:2000}];const r=await call('cut_ranges',{project:p,ranges,timeBasis:'source',timelineModel:model});assert.equal(r.dryRun,true);assert.equal(r.backupPath,null);
 for(const args of [{dryRun:false},{dryRun:false,expectedRevision:'stale'},{timelineModel:'recordly-1.4-source-time'},{ranges:[{startMs:0,endMs:10000}]},{ranges:[{startMs:500,endMs:400}]}])await call('cut_ranges',{project:p,ranges,timeBasis:'source',timelineModel:model,...args},true);
 assert.equal(await fs.readFile(p,'utf8'),raw);
 const invalidEdits = [
  data => { data.version = 1; },
  data => { data.editor.clipRegions[0].speed = 0; },
  data => { data.editor.clipRegions[0].startMs = 10; },
  data => { data.editor.speedRegions = [{ startMs: 0, endMs: 100, speed: 2 }]; },
 ];
 for (const modify of invalidEdits) {
  const data = structuredClone(base);
  modify(data);
  const invalidProject = await fixture(data);
  await call('cut_ranges', { project: invalidProject, ranges, timeBasis: 'source', timelineModel: model }, true);
 }
});
test('native captions clocks, word retiming, explicit style and CRUD',async()=>{
 const p=await fixture();await write('set_captions',{project:p,timeBasis:'timeline',cues:[{id:'c',startMs:1000,endMs:7000,text:'甲乙丙',words:[{text:'甲',startMs:1000,endMs:1500},{text:'乙',startMs:3000,endMs:3500},{text:'丙',startMs:6000,endMs:6500}]}]});
 await cut(p,[{startMs:2000,endMs:5000}]);const caps=(await call('list_captions',{project:p})).cues;assert.deepEqual(caps.map(c=>c.text),['甲','丙']);assert.deepEqual(caps[1].words.map(w=>[w.startMs,w.endMs]),[[3000,3500]]);
 await write('update_caption_settings',{project:p,settings:{fontWeight:'medium',fontSize:65,backgroundOpacity:0}});const settings=(await call('list_captions',{project:p})).settings;assert.equal(settings.fontWeight,'medium');assert.equal(settings.fontSize,65);assert.equal(settings.backgroundOpacity,0);
 await write('update_caption',{project:p,captionId:'c',text:'校对'});assert.equal((await call('list_captions',{project:p})).cues[0].words,undefined);
 await call('set_captions',{project:p,timelineModel:model,timeBasis:'source',mode:'append',cues:[{text:'不能混合',startMs:0,endMs:1000}]},true);
 await write('delete_captions',{project:p,captionIds:['c']});assert.equal((await call('list_captions',{project:p})).cues.length,1);
 const source=await fixture();await write('set_captions',{project:source,timeBasis:'source',cues:[{id:'source',text:'保留源时间',startMs:6000,endMs:7000}]});await cut(source,[{startMs:2000,endMs:5000}]);assert.equal((await call('list_captions',{project:source})).cues[0].startMs,6000);
});
test('simultaneous writes with same revision allow exactly one commit',async()=>{
 const p=await fixture();const {revision}=await call('open_project',{project:p});const args={project:p,dryRun:false,expectedRevision:revision};const results=await Promise.all([client.callTool({name:'update_zoom',arguments:{...args,zoomId:'z',depth:1}}),client.callTool({name:'cut_ranges',arguments:{...args,timelineModel:model,timeBasis:'source',ranges:[{startMs:1000,endMs:2000}]}})]);assert.equal(results.filter(r=>r.isError).length,1);
});
test('published MCP supports captions and transcription, excludes old approximate exporter',async()=>{const names=(await client.listTools()).tools.map(t=>t.name);for(const n of ['get_paths','copy_project','cut_ranges','list_zooms','set_captions','update_caption','delete_captions','update_caption_settings','transcribe_audio'])assert(names.includes(n));for(const n of ['trim_range','cut_silence','export_final'])assert(!names.includes(n));});

test('caption positions keep offsets above 30 percent and reject coordinates outside the frame range', async () => {
 const project = await fixture();
 await write('update_caption_settings', { project, settings: { bottomOffset: 66, horizontalOffset: -10 } });
 assert.deepEqual((await call('list_captions', { project })).settings, { bottomOffset: 66, horizontalOffset: -10 });
 for (const settings of [{ bottomOffset: 96 }, { horizontalOffset: 51 }, { fontSize: 15 }, { fontSize: 73 }, { maxWidth: 39 }, { maxWidth: 96 }, { maxRows: 5 }, { boxRadius: 41 }, { strokeWidth: 13 }, { shadowBlur: 31 }, { shadowOffsetX: -31 }]) {
  const result = await client.callTool({ name: 'update_caption_settings', arguments: { project, timelineModel: model, settings } });
  assert.equal(result.isError, true);
 }
 await write('update_caption_settings', { project, settings: { fontSize: 72, maxWidth: 95, maxRows: 4, bottomOffset: 95 } });
 assert.equal((await call('list_captions', { project })).settings.maxRows, 4);
});
