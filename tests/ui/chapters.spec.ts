import {test,expect} from '@playwright/test';
import {installDesktopBridge, installDesktopBridgeOverrides} from './bridge';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('chapter draft, confirmation, seek, rename, save/reopen and undo',async({page})=>{
 await installDesktopBridge(page,'waveform.mp4');
 await installDesktopBridgeOverrides(page,()=>{
  Object.assign(window, { queryLocalFonts: async () => [{ family: 'Arial' }, { family: 'Times New Roman' }] });
  const project={version:2,projectId:'chapters',videoPath:`${location.origin}/tests/ui/fixtures/waveform.mp4`,editor:{clipRegions:[{id:'screen',startMs:0,endMs:6000,sourceStartMs:0,speed:1}],chapterProgress:{enabled:false,confirmed:false,chapters:[{id:'one',title:'Start',startMs:0,endMs:2000},{id:'two',title:'Work',startMs:2000,endMs:6000}]}}};
  window.electronAPI.loadCurrentProjectFile=async()=>({success:true,path:'/chapters.leadcut',project:JSON.parse(sessionStorage.getItem('chapter-project')??JSON.stringify(project))});
  window.electronAPI.saveProjectFile=async(project)=>{sessionStorage.setItem('chapter-project',JSON.stringify(project));return {success:true,path:'/chapters.leadcut',projectId:project.projectId};};
 });
 await page.goto('/?windowType=editor');await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1);
 await page.getByRole('radio',{name:'Chapters',exact:true}).click();
 await expect(page.locator('[data-chapter-progress]')).toHaveCount(0);
 await page.getByRole('button',{name:'Confirm chapters and enable',exact:true}).click();
 await expect(page.locator('[data-chapter-progress]')).toHaveCount(1);
 await page.getByRole('button',{name:'Jump to chapter 2',exact:true}).click();
 await expect(page.locator('[data-chapter-progress]')).toHaveAttribute('data-time-ms','2000');
 await page.getByRole('textbox',{name:'Chapter start 2',exact:true}).fill('00:00:01.500');
 await page.getByRole('textbox',{name:'Chapter start 2',exact:true}).blur();
 await expect(page.getByRole('textbox',{name:'Chapter end 1',exact:true})).toHaveValue('00:00:01.500');
 await page.getByRole('textbox',{name:'Chapter name 2',exact:true}).fill('Practical');
 await expect(page.locator('[data-chapter-progress]')).toHaveCount(0);
 await page.getByRole('button',{name:'Confirm chapters and enable',exact:true}).click();
 await expect(page.getByRole('spinbutton', { name: 'Font size', exact: true })).toBeVisible();
 await expect(page.getByRole('spinbutton', { name: 'Bar height', exact: true })).toBeVisible();
 await expect(page.getByRole('spinbutton', { name: 'Chapter gap', exact: true })).toBeVisible();
 await page.getByLabel('Played bar color', { exact: true }).fill('#f00000');
 await page.getByLabel('Unplayed bar color', { exact: true }).fill('#00e000');
 await page.getByLabel('Played text color', { exact: true }).fill('#ffff00');
 await page.getByLabel('Unplayed text color', { exact: true }).fill('#ff00ff');
 await page.getByRole('button', { name: 'Font', exact: true }).click();
 await page.getByRole('textbox', { name: 'Search fonts', exact: true }).fill('Times');
 await page.getByRole('option', { name: 'Times New Roman', exact: true }).click();
 await expect(page.getByRole('button', { name: 'Font', exact: true })).toHaveText('Times New Roman');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('chapter-project')??'{}').editor?.chapterProgress)).toMatchObject({
  confirmed:true,enabled:true,chapters:[{},{title:'Practical'}],
  style:{fontFamily:'"Times New Roman"',playedColor:'#f00000',unplayedColor:'#00e000',playedTextColor:'#ffff00',unplayedTextColor:'#ff00ff'},
 });
 await page.reload();await page.getByRole('radio',{name:'Chapters',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Chapter name 2',exact:true})).toHaveValue('Practical');
 await expect(page.getByRole('button', { name: 'Font', exact: true })).toHaveText('Times New Roman');
 await expect(page.getByLabel('Unplayed text color', { exact: true })).toHaveValue('#ff00ff');
 await expect(page.locator('[data-chapter-progress]')).toHaveCount(1);
 await page.getByRole('checkbox',{name:'Show chapter progress',exact:true}).uncheck();await expect(page.locator('[data-chapter-progress]')).toHaveCount(0);
 await page.getByRole('checkbox',{name:'Show chapter progress',exact:true}).blur();await page.keyboard.press('Meta+z');
 await expect(page.locator('[data-chapter-progress]')).toHaveCount(1);
 await page.getByRole('button',{name:'Jump to chapter 2',exact:true}).click();
 await page.locator('[data-region-id="screen"]').click({position:{x:30,y:20}});
 await page.keyboard.press('F2');
 await page.getByRole('radio',{name:'Chapters',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Chapters need confirmation'})).toBeVisible();
 await expect(page.locator('[data-chapter-progress]')).toHaveCount(0);
});

test('1080p and 4K exact V4 edges, opacity, sequence-time fill and caption clearance',async({page})=>{
 await installDesktopBridge(page);await page.goto('/?windowType=editor');
 const output=await page.evaluate(async()=>{
  const {drawChapterProgress,chapterCaptionSettings}=await import('/src/lib/exporter/chapterRenderer.ts');
  const {emptyChapterProgress,confirmChapterProgress}=await import('/src/components/video-editor/chapterProgress.ts');
  const {DEFAULT_AUTO_CAPTION_SETTINGS}=await import('/src/components/video-editor/types.ts');
  const seq={clipRegions:[{id:'s',startMs:0,endMs:10000,sourceStartMs:20000,speed:2}]};
  const progress=confirmChapterProgress({...emptyChapterProgress(),chapters:[{id:'1',title:'效果展示',startMs:0,endMs:4000},{id:'2',title:'创作实操',startMs:4000,endMs:10000}]},seq);
  const result=[];
  for(const width of [1920,3840])for(const time of [0,2500,4000,7000,10000]){
   const height=width*9/16,s=width/3840,c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d')!;
   drawChapterProgress(ctx,progress,width,height,time);
   const sample=(x:number,y:number)=>Array.from(ctx.getImageData(x,y,1,1).data);
   const settings=chapterCaptionSettings(DEFAULT_AUTO_CAPTION_SETTINGS,progress,width,height)!;
   result.push({width,time,left:sample(0,height-9*s),right:sample(width-1,height-9*s),before:sample(Math.max(2,width*time/10000-20*s),height-9*s),after:sample(Math.min(width-3,width*time/10000+20*s),height-9*s),gap:sample(width*.4,height-9*s),above:sample(10,height-59*s),bottom:settings.bottomOffset/100*height,minimum:(58+24)*s});
  }return result;
 });
 for(const r of output){
  expect(r.left[3]).toBeGreaterThan(100);expect(r.right[3]).toBeGreaterThan(100);
  expect(r.gap[3]).toBe(0);expect(r.above[3]).toBe(0);expect(r.bottom).toBeGreaterThanOrEqual(r.minimum);
  if(r.time>0)expect(r.before[0]).toBeGreaterThan(225);if(r.time<10000)expect(r.after[0]).toBeLessThan(40);
  expect(r.before[3]).toBe(140);expect(r.after[3]).toBe(140);
 }
});

test('GIF includes the shared chapter overlay',async({page},info)=>{
 test.setTimeout(90000);await installDesktopBridge(page);await page.goto('/?windowType=editor');
 const bytes=await page.evaluate(async()=>{
  const {GifExporter}=await import('/src/lib/exporter/gifExporter.ts');
  const {emptyChapterProgress,confirmChapterProgress}=await import('/src/components/video-editor/chapterProgress.ts');
  const clipRegions=[{id:'s',startMs:0,endMs:1000,sourceStartMs:0,speed:1}];
  const chapterProgress=confirmChapterProgress({...emptyChapterProgress(),chapters:[{id:'c',title:'章节',startMs:0,endMs:1000}]},{clipRegions});
  const exporter=new GifExporter({width:960,height:540,frameRate:10,loop:true,sizePreset:'original',videoUrl:`${location.origin}/tests/ui/fixtures/broll-blue.mp4`,wallpaper:'#0000ff',showShadow:false,shadowIntensity:0,backgroundBlur:0,cropRegion:{x:0,y:0,width:1,height:1},padding:0,zoomRegions:[],showCursor:false,clipRegions,chapterProgress});
  const result=await exporter.export();if(!result.success||!result.blob)throw new Error(result.error??'no GIF');return Array.from(new Uint8Array(await result.blob.arrayBuffer()));
 });
 const file=info.outputPath('chapters.gif');fs.writeFileSync(file,Buffer.from(bytes));
 const frame=execFileSync(path.resolve('node_modules/ffmpeg-static/ffmpeg.exe'),['-v','error','-ss','0.5','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true,maxBuffer:960*540*3+1024});
 expect(frame[(530*960+10)*3]).toBeGreaterThan(100);expect(frame[(530*960+900)*3]).toBeLessThan(45);
});

for(const pipeline of ['modern','legacy'] as const)test(`${pipeline} real MP4 renders chapter overlay above output`,async({page},info)=>{
 test.setTimeout(120000);await installDesktopBridge(page);await page.goto('/?windowType=editor');
 const bytes=await page.evaluate(async(pipeline)=>{
  const {ModernVideoExporter}=await import('/src/lib/exporter/modernVideoExporter.ts');const {VideoExporter}=await import('/src/lib/exporter/videoExporter.ts');
  const {emptyChapterProgress,confirmChapterProgress}=await import('/src/components/video-editor/chapterProgress.ts');
  const clipRegions=[{id:'s',startMs:0,endMs:1000,sourceStartMs:0,speed:1}];
  const draft = emptyChapterProgress();
  const chapterProgress=confirmChapterProgress({
   ...draft,
   chapters:[{id:'one',title:'Start',startMs:0,endMs:500},{id:'two',title:'Work',startMs:500,endMs:1000}],
   style:{...draft.style, fontFamily:'"Times New Roman"', playedColor:'#f00000', unplayedColor:'#00e000', playedTextColor:'#ffff00', unplayedTextColor:'#ff00ff'},
  },{clipRegions});
  const Exporter=pipeline==='modern'?ModernVideoExporter:VideoExporter;
  const exporter=new Exporter({width:1920,height:1080,frameRate:10,bitrate:5000000,codec:'avc1.640028',backendPreference:'webcodecs',preferredRenderBackend:'webgl',videoUrl:`${location.origin}/tests/ui/fixtures/broll-blue.mp4`,wallpaper:'#0000ff',showShadow:false,shadowIntensity:0,backgroundBlur:0,cropRegion:{x:0,y:0,width:1,height:1},padding:0,zoomRegions:[],showCursor:false,clipRegions,chapterProgress});
  const result=await exporter.export();if(!result.success||!result.blob)throw new Error(result.error??'no export');return Array.from(new Uint8Array(await result.blob.arrayBuffer()));
 },pipeline);
 const file=info.outputPath(`${pipeline}-chapters.mp4`);fs.writeFileSync(file,Buffer.from(bytes));
 const frame=execFileSync(path.resolve('node_modules/ffmpeg-static/ffmpeg.exe'),['-v','error','-ss','0.5','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true,maxBuffer:1920*1080*3+1024});
 const rgb=(x:number,y:number)=>Array.from(frame.subarray((y*1920+x)*3,(y*1920+x)*3+3));
 expect(rgb(10,1060)[0]).toBeGreaterThan(100);
 expect(rgb(10,1060)[1]).toBeLessThan(35);
 expect(rgb(1800,1060)[0]).toBeLessThan(35);
 expect(rgb(1800,1060)[1]).toBeGreaterThan(100);
 const titlePixels = (centerX: number) => Array.from({ length: 10 * 100 }, (_, index) =>
  rgb(centerX - 50 + index % 100, 1057 + Math.floor(index / 100)));
 expect(titlePixels(480).some(([r,g,b]) => r > 200 && g > 200 && b < 80)).toBe(true);
 expect(titlePixels(1440).some(([r,g,b]) => r > 200 && g < 80 && b > 200)).toBe(true);
 expect(rgb(10,1040)[0]).toBeLessThan(35);
});
