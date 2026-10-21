"""Versioned real-screen videos with offline neural Mandarin, sentence-aligned SRT.

Run in a single systemd user job under .local/video.lock. Optional tool deps and
model provenance: media/ASSETS.md. Never overwrites preview.1 media.
No speech acceleration, no overlapping narration, no invented UI frames.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import wave

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
MEDIA = ROOT/'artifacts/media'/VERSION


def stamp(seconds):
    ms = round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'


def subtitle_chunks(text, maximum=28):
    """Prefer clauses, especially keeping a negation with the following words."""
    clauses = re.findall(r'[^，。；！？]+[，。；！？]?', text)
    chunks = []
    for clause in clauses:
        pieces = [clause[i:i+maximum] for i in range(0,len(clause),maximum)]
        for piece in pieces:
            if chunks and len(chunks[-1])+len(piece) <= maximum:
                chunks[-1] += piece
            else:
                chunks.append(piece)
    return chunks


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def prepare_speech(kind, plan, narrator):
    directory = MEDIA/kind
    directory.mkdir(parents=True, exist_ok=True)
    manifest_file = directory/'speech-manifest.json'
    previous = json.loads(manifest_file.read_text()) if manifest_file.exists() else {}
    cached = {x['file']:x for x in previous.get('clips', [])}
    manifest = dict(engine='sherpa-onnx 1.13.8 / Kokoro v1.1 Chinese, generic zf_001 voice',
                    model_sha256=narrator.model_sha256, speed=narrator.speed, clips=[])
    for i, scene in enumerate(plan['segments']):
        for k, text in enumerate(subtitle_chunks(scene['text'])):
            file = f'speech-{i:02}-{k:02}.wav'
            clip = cached.get(file)
            if not (previous.get('model_sha256') == narrator.model_sha256
                    and previous.get('speed') == narrator.speed
                    and previous.get('engine') == manifest['engine'] and clip
                    and clip['text'] == text and (directory/file).exists()
                    and digest(directory/file) == clip['sha256']):
                duration = narrator.synthesize(text, directory/file)
                clip = dict(file=file, scene=i, text=text, duration_s=duration,
                            sha256=digest(directory/file))
            manifest['clips'].append(clip)
            manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
        duration = sum(c['duration_s']+.16 for c in manifest['clips'] if c['scene']==i)-.16
        end = plan['segments'][i+1]['at'] if i+1 < len(plan['segments']) else plan['duration']
        print(kind, i, 'speech seconds', round(duration,2), 'slot', end-scene['at'], flush=True)
        if duration+1.0 > end-scene['at']:
            raise RuntimeError(f'{kind} 场景 {i} 旁白太长：请改短文本，不加速、不截断')
    text = '# '+plan['title']+' · '+VERSION+'\n\n'
    text += '\n\n'.join(f"## {stamp(s['at'])} — {s['title']}\n\n操作：`{s['action']}`\n\n{s['text']}" for s in plan['segments'])+'\n'
    (ROOT/'media'/f'{kind}-narration.md').write_text(text)
    return manifest


def write_subtitles(kind, captions):
    srt = '\n\n'.join(f'{i+1}\n{stamp(c["start_s"])} --> {stamp(c["end_s"])}\n{c["text"]}'
                      for i,c in enumerate(captions))+'\n'
    (MEDIA/f'{kind}.srt').write_text(srt)
    def ass_stamp(value):
        cs = round(value*100)
        return f'{cs//360000}:{cs//6000%60:02}:{cs//100%60:02}.{cs%100:02}'
    ass = ('[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n'
           '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
           'Style: Narration,Noto Sans CJK SC,34,&H00FFFFFF,&H00FFFFFF,&H00432B10,&H00432B10,0,0,0,0,100,100,0,0,1,1.5,0,2,50,50,18,1\n'
           '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')
    for c in captions:
        safe = c['text'].replace('\\','').replace('{','').replace('}','')
        ass += f'Dialogue: 0,{ass_stamp(c["start_s"])},{ass_stamp(c["end_s"])},Narration,,0,0,0,,{safe}\n'
    (MEDIA/f'{kind}.ass').write_text(ass)


def compose_audio(kind, plan):
    directory = MEDIA/kind
    speech = json.loads((directory/'speech-manifest.json').read_text())
    recording = json.loads((directory/'recording.json').read_text())
    if recording['software'] != VERSION or recording.get('smoke'):
        raise RuntimeError('拒绝复用不同软件版本或 smoke 流程的录屏')
    captions = []
    sample_rate = None
    combined = None
    for i, scene in enumerate(plan['segments']):
        event = recording['events'][i]
        if event['action'] != scene['action'] or event['expected_s'] != scene['at']:
            raise RuntimeError('分镜与实际操作记录不一致')
        offset = max(scene['at']+.65, event['actual_s']+.25)
        end = plan['segments'][i+1]['at'] if i+1<len(plan['segments']) else plan['duration']
        for clip in [c for c in speech['clips'] if c['scene']==i]:
            with wave.open(str(directory/clip['file']), 'rb') as stream:
                assert stream.getnchannels()==1 and stream.getsampwidth()==2
                if sample_rate is None:
                    sample_rate = stream.getframerate()
                    combined = bytearray(round(plan['duration']*sample_rate)*2)
                assert stream.getframerate()==sample_rate
                audio = stream.readframes(stream.getnframes())
            if digest(directory/clip['file']) != clip['sha256']:
                raise RuntimeError('配音文件摘要改变')
            duration = len(audio)/2/sample_rate
            if offset+duration > end-.2:
                raise RuntimeError(f'{kind} 场景 {i} 实际操作后空间不足，请缩短旁白或调整分镜')
            begin = round(offset*sample_rate)*2
            combined[begin:begin+len(audio)] = audio
            captions.append(dict(start_s=offset,end_s=offset+duration,text=clip['text'],file=clip['file'],scene=i))
            offset += duration+.16
    with wave.open(str(directory/'narration.wav'), 'wb') as stream:
        stream.setparams((1,2,sample_rate,0,'NONE','not compressed'))
        stream.writeframes(combined)
    write_subtitles(kind, captions)
    manifest = dict(software=VERSION, model_sha256=speech['model_sha256'], speed=speech['speed'],
                    no_time_compression=True, timing='each caption uses its own WAV duration, after actual action completion',
                    captions=captions)
    (directory/'audio-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')


def render(kind, plan, record=True):
    directory = MEDIA/kind
    if record:
        subprocess.run(['xvfb-run','-a','-s','-screen 0 1920x1080x24',
                        'node','tools/record_video.cjs',kind],cwd=ROOT,check=True)
    compose_audio(kind, plan)
    font = subprocess.check_output(['fc-match','-f','%{file}','Noto Sans CJK SC'],text=True)
    filters = ['drawbox=x=0:y=960:w=1920:h=120:color=0x102b43:t=fill']
    for i, scene in enumerate(plan['segments']):
        title = directory/f'title-{i:02}.txt'
        title.write_text(f'OpenHydroNet {VERSION} · Linux 实机录制 | '+scene['title'])
        end = plan['segments'][i+1]['at'] if i+1<len(plan['segments']) else plan['duration']
        filters.append(f"drawtext=fontfile='{font}':textfile='{title}':x=32:y=974:fontsize=22:fontcolor=0xa6c5d5:enable='between(t,{scene['at']},{end-.001})'")
    filters.append(f"ass='{MEDIA/f'{kind}.ass'}'")
    output = MEDIA/f'OpenHydroNet-{kind}-{VERSION}-清晰配音.mp4'
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','warning',
                    '-i',str(directory/'capture.mkv'),'-i',str(directory/'narration.wav'),
                    '-vf',','.join(filters),'-af','highpass=f=70,loudnorm=I=-16:LRA=7:TP=-1.5',
                    '-t',str(plan['duration']),'-r','30','-threads','4',
                    '-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p',
                    '-c:a','aac','-ar','48000','-b:a','160k','-movflags','+faststart',str(output)],check=True)
    subprocess.run(['ffmpeg','-v','error','-i',str(output),'-f','null','-'],check=True)
    for at in (5,25,45,65,95,115,145,185,225,245,265,285):
        if at < plan['duration']:
            subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',str(at),'-i',str(output),
                            '-frames:v','1',str(directory/f'final-check-{at}.png')],check=True)
    receipt = dict(file=output.name,sha256=digest(output),software=VERSION,
                   commit=json.loads((directory/'recording.json').read_text())['commit'],
                   duration_s=plan['duration'],full_decode=True,
                   neural_speech=True,no_time_compression=True,human_listening_review=False,
                   remaining='需使用者真人试听；自动回识别和响度检查不能证明主观可懂度')
    (directory/'quality-check.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
    print('DONE',output.name,flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir')
    parser.add_argument('--audio-only',action='store_true')
    parser.add_argument('--remux',action='store_true',help='reuse this version’s actual capture and speech clips')
    parser.add_argument('--kind',choices=['intro','quickstart'])
    args = parser.parse_args()
    plans = json.loads((ROOT/'media/storyboards.json').read_text())
    narrator = None
    if not args.remux:
        if not args.model_dir:
            parser.error('--model-dir is required; no online or eSpeak fallback')
        from tts_neural import Narrator
        narrator = Narrator(args.model_dir)
    for kind in ([args.kind] if args.kind else ['quickstart','intro']):
        if narrator:
            prepare_speech(kind,plans[kind],narrator)
        if not args.audio_only:
            render(kind,plans[kind],record=not args.remux)


if __name__ == '__main__':
    main()
