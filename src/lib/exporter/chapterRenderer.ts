import type { ChapterProgress } from "@/components/video-editor/chapterProgress";
import { chapterProgressStatus } from "@/components/video-editor/chapterProgress";
import type { AutoCaptionSettings } from "@/components/video-editor/types";
import { getCaptionEffectPadding, getCaptionScaledFontSize } from "@/components/video-editor/captionStyle";
import { fontFamilyDisplayName, localFontCssFamily } from "@/lib/localFonts";

export function chapterCaptionSettings(settings: AutoCaptionSettings | undefined, chapters: ChapterProgress | undefined, width: number, height: number): AutoCaptionSettings | undefined {
 if (!settings || chapterProgressStatus(chapters) !== 'ready') return settings;
 const scale=width/3840;
 const effects=getCaptionEffectPadding(settings,getCaptionScaledFontSize(settings.fontSize,width,settings.maxWidth));
 const minimum=(chapters!.style.height+chapters!.style.captionGap)*scale+effects;
 return {...settings,bottomOffset:Math.max(settings.bottomOffset,minimum/Math.max(1,height)*100)};
}
function roundedCard(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number,first:boolean,last:boolean) {
 ctx.beginPath();ctx.roundRect(x,y,w,h,[first?0:r,last?0:r,last?0:r,first?0:r]);
}
/** Output-space drawing, shared by preview, MP4 renderers and GIF. Time is sequence ms. */
export function drawChapterProgress(ctx:CanvasRenderingContext2D, progress:ChapterProgress | undefined,width:number,height:number,timeMs:number) {
 if (chapterProgressStatus(progress)!=='ready') return;
 const {chapters,style,durationMs}=progress!;
 const family = style.fontFamily.trim();
 const fontFamily = localFontCssFamily(family.startsWith('"') ? fontFamilyDisplayName(family) : family);
 const scale=width/3840,stripHeight=style.height*scale,top=height-stripHeight;
 const y=top+2*scale,cardHeight=Math.max(1,(style.height-8)*scale);
 const playedX=width*Math.max(0,Math.min(1,timeMs/durationMs));
 ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
 for(let i=0;i<chapters.length;i++) {
  const chapter=chapters[i];
  const left=i===0?0:width*chapter.startMs/durationMs+style.gap*scale/2;
  const right=i===chapters.length-1?width:width*chapter.endMs/durationMs-style.gap*scale/2;
  if(right<=left)continue;
  const cardWidth=right-left,mid=(left+right)/2,radius=Math.min(style.radius*scale,cardHeight/2,cardWidth/2);
  let fontSize=Math.min(style.fontSize*scale,cardHeight*0.85),title=chapter.title;
  ctx.font = `700 ${fontSize}px ${fontFamily}`;
  const available=Math.max(0,cardWidth-12*scale);
  const titleWidth = ctx.measureText(title).width;
  if (titleWidth > available) {
   fontSize = Math.max(12 * scale, fontSize * available / Math.max(1, titleWidth));
   ctx.font = `700 ${fontSize}px ${fontFamily}`;
   while (title.length > 1 && ctx.measureText(title + '…').width > available) title = title.slice(0, -1);
   if (title !== chapter.title) title += '…';
  }
  for(const played of [false,true]) {
   ctx.save();
   // Draw disjoint regions: do not alpha-composite the light fill over the dark one.
   ctx.beginPath();ctx.rect(played?0:playedX,top,played?playedX:width-playedX,stripHeight);ctx.clip();
   roundedCard(ctx,left,y,cardWidth,cardHeight,radius,i===0,i===chapters.length-1);
   ctx.globalAlpha=style.backgroundOpacity;ctx.fillStyle=played?style.playedColor:style.unplayedColor;ctx.fill();
   ctx.globalAlpha=played?128/255:96/255;ctx.strokeStyle=played?'#ffffff':'#646464';ctx.lineWidth=Math.max(0.5,scale);ctx.stroke();
   ctx.globalAlpha=1;ctx.fillStyle=played?style.playedTextColor:style.unplayedTextColor;ctx.fillText(title,mid,y+cardHeight/2,Math.max(1,available));ctx.restore();
  }
 }
 ctx.restore();
}
