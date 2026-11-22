import {describe,it,expect} from "vitest";
import {emptyChapterProgress,confirmChapterProgress,chapterProgressStatus,chapterSequenceSignature,normalizeChapterProgress,validateChapters} from "./chapterProgress";
const sequence={clipRegions:[{id:'a',startMs:0,endMs:3000,sourceStartMs:4000,speed:2},{id:'b',startMs:3000,endMs:6000,sourceStartMs:0,speed:1}],audioRegions:[{id:'music',audioPath:'music.wav',startMs:0,endMs:7000}]};
const chapters=[{id:'one',title:'开场',startMs:0,endMs:2000},{id:'two',title:'操作',startMs:2000,endMs:7000}];
describe('native chapters',()=>{
 it('old projects stay disabled; drafts cannot render',()=>{expect(chapterProgressStatus(normalizeChapterProgress(undefined))).toBe('off');expect(chapterProgressStatus({...emptyChapterProgress(),enabled:true,chapters})).toBe('draft');});
 it('confirmation includes audio tail and survives serialization',()=>{const ready=confirmChapterProgress({...emptyChapterProgress(),chapters},sequence);expect(ready.durationMs).toBe(7000);expect(chapterProgressStatus(normalizeChapterProgress(JSON.parse(JSON.stringify(ready))),sequence)).toBe('ready');});
 it('cut, source reorder and speed invalidate confirmation; array order does not',()=>{
  const ready=confirmChapterProgress({...emptyChapterProgress(),chapters},sequence);
  expect(chapterSequenceSignature({...sequence,clipRegions:[...sequence.clipRegions].reverse()})).toBe(chapterSequenceSignature(sequence));
  for(const patch of [{endMs:2900},{sourceStartMs:5000},{speed:1}])expect(chapterProgressStatus(ready,{...sequence,clipRegions:[{...sequence.clipRegions[0],...patch},sequence.clipRegions[1]]})).toBe('stale');
 });
 it('rejects overlaps, gaps, unsorted, duplicate IDs, missing coverage and out of bounds',()=>{
  for(const invalid of [[...chapters].reverse(),[{...chapters[0],endMs:2100},chapters[1]],[chapters[0],{...chapters[1],startMs:2100}],[chapters[0],{...chapters[1],id:'one'}],[chapters[0]],[chapters[0],{...chapters[1],endMs:8000}]])expect(validateChapters(invalid,7000)).toBeTruthy();
 });
});
