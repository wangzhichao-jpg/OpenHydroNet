"""Offline Mandarin narration. Optional production tool, never a runtime dependency.

Requires sherpa-onnx==1.13.8 and the Apache-2.0 csukuangfj/kokoro-multi-lang-v1_1
ONNX conversion. Uses a generic Chinese speaker zf_001, not a cloned user voice. No remote code, account, voice cloning, or network fallback.
Model acquisition/provenance: media/ASSETS.md.
"""
from pathlib import Path
import wave

import numpy as np


class Narrator:
    def __init__(self, model_dir, threads=4):
        import sherpa_onnx
        root = Path(model_dir).resolve()
        required = ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-zh.txt', 'dict/jieba.dict.utf8', 'LICENSE']
        if not all((root / name).is_file() for name in required):
            raise FileNotFoundError('缺少离线中文配音模型；不会改用旧 eSpeak 或在线配音')
        self.speed = 0.93  # Slightly slower model duration prediction, not waveform resampling.
        self.model_sha256 = __import__('hashlib').sha256((root / 'model.onnx').read_bytes()).hexdigest()
        # eSpeak is used only for fallback phoneme lookup, never for its voice.
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

    def synthesize(self, text, destination):
        # Fixed natural speed. A sentence that will not fit must be rewritten,
        # not time-compressed, cut off, or allowed to overlap the next sentence.
        audio = self.engine.generate(text, sid=3, speed=self.speed)
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
    args = parser.parse_args()
    print(Narrator(args.model_dir).synthesize(args.text, args.out))
