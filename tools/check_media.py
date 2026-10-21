"""Versioned technical media QA; never equates decoding or ASR with human listening."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
MEDIA=ROOT/'artifacts/media'/VERSION


def seconds(text):
    h,m,tail=text.split(':');sec,ms=tail.split(',')
    return int(h)*3600+int(m)*60+int(sec)+int(ms)/1000


def main():
    asr=json.loads((MEDIA/'NARRATION_FINAL_ASR.json').read_text())
    assert asr['accepted'] and asr['software']==VERSION
    records=[]
    for kind,wanted in [('quickstart',120),('intro',300)]:
        directory=MEDIA/kind
        video=MEDIA/f'OpenHydroNet-{kind}-{VERSION}-清晰配音.mp4'
        sha=hashlib.sha256(video.read_bytes()).hexdigest()
        rendering=json.loads((directory/'quality-check.json').read_text())
        assert rendering['full_decode'] and rendering['sha256']==sha
        asr_record=next(r for r in asr['records'] if r['kind']==kind)
        assert asr_record['accepted'] and asr_record['sha256']==sha
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)],text=True))
        probe['format']['filename']=video.name
        videos=[s for s in probe['streams'] if s['codec_type']=='video']
        audios=[s for s in probe['streams'] if s['codec_type']=='audio']
        assert len(videos)==len(audios)==1
        v,a=videos[0],audios[0]
        assert v['codec_name']=='h264' and (v['width'],v['height'])==(1920,1080)
        assert v['avg_frame_rate']=='30/1' and a['codec_name']=='aac'
        assert abs(float(probe['format']['duration'])-wanted)<.1
        difference=abs(float(v['duration'])-float(a['duration']))
        assert difference<.05
        text=(MEDIA/f'{kind}.srt').read_text()
        blocks=re.findall(r'(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})\n([^\n]+)',text)
        narration=json.loads((directory/'audio-manifest.json').read_text())
        previous=0
        assert len(blocks)==len(narration['captions'])
        for (begin,end,caption),actual in zip(blocks,narration['captions']):
            lo,hi=seconds(begin),seconds(end)
            assert 0<=lo<hi<=wanted and lo>=previous-.002
            assert caption==actual['text'] and len(caption)<=28
            assert abs(lo-actual['start_s'])<.001 and abs(hi-actual['end_s'])<.001
            previous=hi
        assert narration['no_time_compression'] and narration['speed']<=1
        recording=json.loads((directory/'recording.json').read_text())
        assert recording['software']==VERSION and recording['sourceTreeClean']
        assert not recording['smoke'] and not recording['pageErrors']
        assert hashlib.sha256((directory/'capture.mkv').read_bytes()).hexdigest()==recording['capture_sha256']
        levels=subprocess.run(['ffmpeg','-hide_banner','-nostats','-i',str(video),
                               '-vn','-af','loudnorm=I=-16:LRA=7:TP=-1.5:print_format=json',
                               '-f','null','-'],capture_output=True,text=True,check=True)
        loudness=json.loads(levels.stderr[levels.stderr.rfind('{'):])
        assert -18<float(loudness['input_i'])<-14
        assert float(loudness['input_tp'])<0, 'encoded audio true-peak clipping'
        subprocess.run(['xvfb-run','-a','ffplay','-loglevel','error','-autoexit','-t','4',str(video)],
                       env={**os.environ,'SDL_AUDIODRIVER':'dummy'},stdout=subprocess.DEVNULL,
                       stderr=subprocess.PIPE,check=True,timeout=20)
        receipt=dict(file=video.name,sha256=sha,software=VERSION,commit=recording['commit'],
                     duration_s=wanted,resolution=[1920,1080],frame_rate='30/1',video_codec='h264',audio_codec='aac',
                     subtitle_blocks=len(blocks),sentence_aligned_subtitles=True,
                     av_stream_duration_difference_s=difference,
                     timeline_max_action_completion_delay_s=max(e['actual_s']-e['expected_s'] for e in recording['events']),
                     speech_engine=narration.get('engine','offline neural Mandarin; see speech-manifest.json'),
                     loudness=loudness,final_audio_independent_asr='passed per-scene CER and negation gates',
                     full_decode=True,local_player_smoke='ffplay 4 seconds in Xvfb, dummy audio',
                     human_listening_review=False,remaining='使用者真人试听、主观自然度和逐句音画校审仍待确认')
        (directory/'quality-check.json').write_text(json.dumps({**receipt,'probe':probe},ensure_ascii=False,indent=2)+'\n')
        records.append(receipt)
    (MEDIA/'MEDIA_QA.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(records,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
