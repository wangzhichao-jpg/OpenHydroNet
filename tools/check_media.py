"""Local media checks and privacy-safe QA receipts; never claims human listening."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import os
ROOT=Path(__file__).resolve().parents[1]


def seconds(s):
    h,m,tail=s.split(':');sec,ms=tail.split(',');return int(h)*3600+int(m)*60+int(sec)+int(ms)/1000


def main():
    records=[]
    for kind,wanted in (('quickstart',120),('intro',300)):
        directory=ROOT/'artifacts/media'/kind
        video=ROOT/'artifacts/media'/f'OpenHydroNet-{kind}-0.1.0-preview.1.mp4'
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(video)],text=True))
        probe['format']['filename']=video.name
        v=next(s for s in probe['streams'] if s['codec_type']=='video');a=next(s for s in probe['streams'] if s['codec_type']=='audio')
        assert v['codec_name']=='h264' and (v['width'],v['height'])==(1920,1080)
        assert a['codec_name']=='aac'
        assert abs(float(probe['format']['duration'])-wanted)<.1
        assert abs(float(v['duration'])-float(a['duration']))<.05
        text=(ROOT/'artifacts/media'/f'{kind}.srt').read_text()
        blocks=re.findall(r'(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})\n([^\n]+)',text)
        previous=0
        for begin,end,caption in blocks:
            lo,hi=seconds(begin),seconds(end)
            assert 0<=lo<hi<=wanted and lo>=previous-.002
            assert len(caption)<=28
            previous=hi
        recording=json.loads((directory/'recording.json').read_text())
        delay=max(e['actual_s']-e['expected_s'] for e in recording['events'])
        # Actual local player smoke: short sample in a virtual display. Dummy audio
        # intentionally cannot establish human intelligibility or subjective sync.
        subprocess.run(['xvfb-run','-a','ffplay','-loglevel','error','-autoexit','-t','4',str(video)],env={**os.environ,'SDL_AUDIODRIVER':'dummy'},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True,timeout=15)
        receipt=dict(file=video.name,sha256=hashlib.sha256(video.read_bytes()).hexdigest(),software='0.1.0-preview.1',commit=recording['commit'],duration_s=wanted,video_codec=v['codec_name'],audio_codec=a['codec_name'],resolution=[1920,1080],frame_rate=v['avg_frame_rate'],subtitle_blocks=len(blocks),subtitle_timestamps='ordered and within duration',av_stream_duration_difference_s=abs(float(v['duration'])-float(a['duration'])),timeline_max_action_completion_delay_s=delay,local_player_smoke='ffplay 4-second sample exited normally in Xvfb; dummy audio',full_decode='completed by render_videos.py',human_listening_review=False,remaining='人工试听中文可懂度、逐句音画同步、旁白自然度与完整字幕校审未完成')
        (directory/'quality-check.json').write_text(json.dumps({**receipt,'probe':probe},ensure_ascii=False,indent=2)+'\n')
        records.append(receipt)
    (ROOT/'artifacts/media/MEDIA_QA.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(records,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
