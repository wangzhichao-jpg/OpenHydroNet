"""Offline Mandarin narration. Optional production tool, never a runtime dependency.

Requires sherpa-onnx==1.13.8 and the Apache-2.0 csukuangfj/kokoro-multi-lang-v1_1
ONNX conversion. Uses one of the model's built-in generic Chinese speakers; no
cloning of a user/real person, no remote code, account or network fallback.
Model acquisition/provenance: media/ASSETS.md.
"""
from pathlib import Path
import os
import wave

import numpy as np

DEFAULT_SPEAKER = os.environ.get('OHN_TTS_SPEAKER', 'zm_010')


def speaker_ids(model):
    import onnxruntime
    meta = onnxruntime.InferenceSession(str(model), providers=['CPUExecutionProvider']).get_modelmeta()
    return {name: int(i) for i, name in (x.split('->') for x in meta.custom_metadata_map['id2speaker'].split(','))}


class Narrator:
    def __init__(self, model_dir, threads=4, speaker=DEFAULT_SPEAKER, speed=1.0):
        import sherpa_onnx
        root = Path(model_dir).resolve()
        required = ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-zh.txt', 'dict/jieba.dict.utf8', 'LICENSE']
        if not all((root / name).is_file() for name in required):
            raise FileNotFoundError('缺少离线中文配音模型；不会改用旧 eSpeak 或在线配音')
        ids = speaker_ids(root/'model.onnx')
        if speaker not in ids:
            raise ValueError('模型中不存在该内置说话人：' + speaker)
        self.speaker, self.sid = speaker, ids[speaker]
        # Natural model-predicted duration; no waveform time-stretching.
        self.speed = float(speed)
        self.model_sha256 = __import__('hashlib').sha256((root / 'model.onnx').read_bytes()).hexdigest()
        # eSpeak data is used only for fallback phoneme lookup, never as a voice.
        data = next((p for p in [root/'espeak-ng-data',
                    Path('/usr/lib/x86_64-linux-gnu/espeak-ng-data'),
                    Path('/usr/share/espeak-ng-data')] if (p/'phontab').is_file()), None)
        if data is None:
            raise FileNotFoundError('缺少音素字典；请按 ASSETS.md 准备，不回退机械配音')
        self.engine = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(root/'model.onnx'), voices=str(root/'voices.bin'), tokens=str(root/'tokens.txt'),
                    lexicon=str(root/'lexicon-zh.txt'), data_dir=str(data), dict_dir=str(root/'dict'), lang='zh'),
                num_threads=threads, provider='cpu'),
            max_num_sentences=1,
        ))

    @property
    def engine_label(self):
        return f'sherpa-onnx 1.13.8 / Kokoro v1.1 Chinese, built-in generic male voice {self.speaker}, whole-sentence synthesis'

    def synthesize(self, text, destination):
        # One complete sentence per call keeps natural phrase intonation; a
        # sentence that will not fit must be rewritten, not compressed or cut.
        audio = self.engine.generate(text, sid=self.sid, speed=self.speed)
        samples = np.asarray(audio.samples, dtype=np.float64)
        if not len(samples) or not np.isfinite(samples).all():
            raise RuntimeError('配音为空或含非有限样本')
        if np.max(np.abs(samples)) >= 1:
            raise RuntimeError('原始配音削波；拒绝静默截断波形')
        with wave.open(str(destination), 'wb') as stream:
            stream.setparams((1, 2, audio.sample_rate, 0, 'NONE', 'not compressed'))
            stream.writeframes(np.rint(samples*32767).astype('<i2').tobytes())
        return len(samples)/audio.sample_rate


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--text', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--speaker', default=DEFAULT_SPEAKER)
    args = parser.parse_args()
    print(Narrator(args.model_dir, speaker=args.speaker).synthesize(args.text, args.out))
