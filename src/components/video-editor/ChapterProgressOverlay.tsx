import { useEffect, useRef } from "react";
import type { ChapterProgress } from "./chapterProgress";
import { chapterProgressStatus } from "./chapterProgress";
import { drawChapterProgress } from "@/lib/exporter/chapterRenderer";
export function ChapterProgressOverlay({ progress, timeMs }: { progress?: ChapterProgress; timeMs: number }) {
 const canvasRef=useRef<HTMLCanvasElement>(null);
 useEffect(() => {
  const canvas=canvasRef.current,parent=canvas?.parentElement;if(!canvas||!parent)return;
  const draw=()=>{const ratio=window.devicePixelRatio||1;canvas.width=Math.max(1,Math.round(parent.clientWidth*ratio));canvas.height=Math.max(1,Math.round(parent.clientHeight*ratio));const ctx=canvas.getContext('2d');if(ctx)drawChapterProgress(ctx,progress,canvas.width,canvas.height,timeMs);};
  draw();const observer=new ResizeObserver(draw);observer.observe(parent);let disposed=false;void document.fonts.ready.then(()=>{if(!disposed)draw();});
  return()=>{disposed=true;observer.disconnect();};
 },[progress,timeMs]);
 if(chapterProgressStatus(progress)!=='ready')return null;
 return <canvas ref={canvasRef} data-chapter-progress data-time-ms={Math.round(timeMs)} aria-label="Chapter progress" className="pointer-events-none absolute inset-0 h-full w-full" style={{zIndex:30}} />;
}
