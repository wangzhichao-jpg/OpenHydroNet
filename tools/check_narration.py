"""Independent offline ASR check of Mandarin narration, NOT human listening.

--clips checks source WAVs before capture; default checks audio extracted from
FINAL MP4s, scene by scene. Requires an external SenseVoice int8 model and
sherpa-onnx==1.13.8; not bundled with or used by OpenHydroNet itself.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
MEDIA = ROOT/'artifacts/media'/VERSION


def normalize(text):
    return ''.join(re.findall(r'[\u4e00-\u9fff0-9a-z]', text.lower()))


def character_error_rate(expected, actual):
    a, b = normalize(expected), normalize(actual)
    if not a:
        raise ValueError('不能审核空文本')
    previous = list(range(len(b)+1))
    for i, char in enumerate(a, 1):
        row = [i]
        for j, other in enumerate(b, 1):
            row.append(min(row[-1]+1, previous[j]+1, previous[j-1]+(char!=other)))
        previous = row
    return previous[-1]/len(a)


def read_pcm(path, start=None, duration=None):
    command = ['ffmpeg','-v','error']
    if start is not None:
        command += ['-ss',str(start)]
    command += ['-i',str(path)]
    if duration is not None:
        command += ['-t',str(duration)]
    command += ['-vn','-f','s16le','-ac','1','-ar','16000','pipe:1']
    raw = subprocess.check_output(command)
    return np.frombuffer(raw,dtype='<i2').astype(np.float32)/32768


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir',required=True)
    parser.add_argument('--clips',action='store_true')
    args = parser.parse_args()
    import sherpa_onnx
    model = Path(args.model_dir)
    recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(model/'model.int8.onnx'),tokens=str(model/'tokens.txt'),
        language='zh',use_itn=False,num_threads=4,provider='cpu')
    plans = json.loads((ROOT/'media/storyboards.json').read_text())
    records = []
    for kind in ('quickstart','intro'):
        directory = MEDIA/kind
        manifest = json.loads((directory/('speech-manifest.json' if args.clips else 'audio-manifest.json')).read_text())
        video = MEDIA/f'OpenHydroNet-{kind}-{VERSION}-清晰配音.mp4'
        scenes = []
        for i, scene in enumerate(plans[kind]['segments']):
            if args.clips:
                clips = [c for c in manifest['clips'] if c['scene']==i]
                samples = np.concatenate([read_pcm(directory/c['file']) for c in clips])
            else:
                captions = [c for c in manifest['captions'] if c['scene']==i]
                begin, end = captions[0]['start_s'], captions[-1]['end_s']
                samples = read_pcm(video,max(0,begin-.05),end-begin+.12)
            stream = recognizer.create_stream()
            stream.accept_waveform(16000,samples)
            recognizer.decode_stream(stream)
            actual = stream.result.text
            error = character_error_rate(scene['text'],actual)
            # Missing a negation is important even when total CER is small.
            expected_negation = normalize(scene['text']).count('不')
            actual_negation = normalize(actual).count('不')
            accepted = error <= .12 and expected_negation == actual_negation
            row = dict(scene=i,title=scene['title'],expected=scene['text'],recognized=actual,
                       character_error_rate=error,negation_count_matches=expected_negation==actual_negation,
                       accepted=accepted)
            scenes.append(row)
            print(kind,i,round(error,4),'通过' if accepted else '需复核',actual,flush=True)
        record = dict(kind=kind,source='original speech WAVs' if args.clips else 'audio extracted from final MP4',
                      accepted=all(s['accepted'] for s in scenes),scenes=scenes)
        if not args.clips:
            record.update(file=video.name,sha256=hashlib.sha256(video.read_bytes()).hexdigest())
        records.append(record)
    report = dict(software=VERSION,asr='SenseVoice int8 / sherpa-onnx 1.13.8, Chinese, CPU',
                  asr_model_sha256=hashlib.sha256((model/'model.int8.onnx').read_bytes()).hexdigest(),
                  acceptance_gate='each scene CER <= 0.12 and 不 count equal; ASR is fallible',
                  human_listening_review=False,accepted=all(r['accepted'] for r in records),records=records)
    (MEDIA/('NARRATION_SOURCE_ASR.json' if args.clips else 'NARRATION_FINAL_ASR.json')).write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if not report['accepted']:
        raise SystemExit('回识别有需复核项：先核对文字与发音，不能冒称真人试听通过')


if __name__ == '__main__':
    main()
