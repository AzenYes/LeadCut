"""Local word-timestamp ASR; never downloads a model implicitly."""
import argparse,json,os,pathlib,site

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--audio',type=pathlib.Path,required=True)
 p.add_argument('--model-path',type=pathlib.Path,required=True)
 p.add_argument('--output',type=pathlib.Path,required=True)
 p.add_argument('--delay-ms',type=float,default=0)
 p.add_argument('--language',default='zh')
 p.add_argument('--device',choices=['cpu','cuda','auto'],default='auto')
 a=p.parse_args()
 if not a.audio.is_file() or not a.model_path.is_dir(): p.error('Existing audio and local model directory required')
 if a.output.exists():p.error('Output exists; choose a new path')
 handles=[]
 if os.name=='nt':
  for base in map(pathlib.Path,site.getsitepackages()):
   for d in [base/'torch/lib',*base.glob('nvidia/*/bin')]:
    if d.is_dir():
     os.environ['PATH']=str(d)+os.pathsep+os.environ['PATH'];handles.append(os.add_dll_directory(str(d)))
 from faster_whisper import WhisperModel
 m=WhisperModel(str(a.model_path),device=a.device,compute_type='int8' if a.device=='cpu' else 'default',local_files_only=True)
 segments,_=m.transcribe(str(a.audio),language=a.language,beam_size=5,word_timestamps=True,vad_filter=True,condition_on_previous_text=False)
 offset=a.delay_ms/1000
 result={'audioPath':str(a.audio.resolve()),'startDelayMs':a.delay_ms,'timeBasis':'source video seconds after supplied delay','segments':[]}
 for s in segments:
  result['segments'].append({'start':s.start+offset,'end':s.end+offset,'text':s.text,'words':[{'start':w.start+offset,'end':w.end+offset,'word':w.word,'probability':w.probability} for w in s.words or []]})
 a.output.parent.mkdir(parents=True,exist_ok=True)
 a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'output':str(a.output),'segments':len(result['segments'])},ensure_ascii=False))
if __name__=='__main__':main()
