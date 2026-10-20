"""Local narration, real Electron capture, semantic subtitles and H.264/AAC.

System dependencies: FFmpeg, Xvfb, eSpeak NG shared library, Noto CJK fonts.
Use one systemd user job with .local/video.lock. A full run takes >7 minutes.
--remux reuses actual footage/audio; it never synthesizes fake UI frames.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import wave

ROOT = Path(__file__).resolve().parents[1]


def stamp(seconds):
    ms = round(seconds * 1000)
    return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}"


def subtitle_chunks(text, maximum=28):
    """Prefer full clauses so a negation is not stranded in the previous caption."""
    clauses = re.findall(r"[^，。；！？]+[，。；！？]?", text)
    chunks = []
    for clause in clauses:
        pieces = [clause[i:i + maximum] for i in range(0, len(clause), maximum)]
        for piece in pieces:
            if chunks and len(chunks[-1]) + len(piece) <= maximum:
                chunks[-1] += piece
            else:
                chunks.append(piece)
    return chunks


def write_subtitles(kind, manifest):
    subtitles = []
    for scene in manifest:
        offset = scene['at'] + .6
        for chunk in subtitle_chunks(scene['text']):
            duration = scene['fitted_duration_s'] * len(chunk) / len(scene['text'])
            subtitles.append((offset, offset + duration, chunk))
            offset += duration
    srt = '\n\n'.join(
        f'{i + 1}\n{stamp(a)} --> {stamp(b)}\n{text}'
        for i, (a, b, text) in enumerate(subtitles)
    ) + '\n'
    (ROOT / 'artifacts/media' / f'{kind}.srt').write_text(srt, encoding='utf-8')


def make_audio(kind, plan):
    directory = ROOT / 'artifacts/media' / kind
    directory.mkdir(parents=True, exist_ok=True)
    sample_rate = 22050
    combined = bytearray()
    manifest = []
    for i, scene in enumerate(plan['segments']):
        at = scene['at']
        end = plan['segments'][i + 1]['at'] if i + 1 < len(plan['segments']) else plan['duration']
        slot = end - at
        original = directory / f'speech-{i:02}.wav'
        # Reinitializing eSpeak after Terminate can hang. Isolate each utterance.
        natural = float(subprocess.check_output(
            [sys.executable, str(ROOT / 'tools/tts_local.py'), scene['text'], str(original)],
            text=True, timeout=30,
        ).strip())
        factor = max(1, natural / (slot - 1.3))
        fitted = original
        if factor > 1:
            fitted = directory / f'speech-{i:02}-fitted.wav'
            subprocess.run([
                'ffmpeg', '-y', '-loglevel', 'error', '-i', str(original),
                '-af', f'atempo={factor:.8f}', str(fitted),
            ], check=True)
        with wave.open(str(fitted), 'rb') as w:
            audio = w.readframes(w.getnframes())
            spoken = len(audio) / 2 / sample_rate
        segment = bytearray(int(.6 * sample_rate) * 2) + audio
        length = int(slot * sample_rate) * 2
        if len(segment) > length:
            raise RuntimeError('音频超过场景长度，不偷偷截断旁白')
        segment += b'\0' * (length - len(segment))
        combined.extend(segment)
        manifest.append(dict(
            at=at, natural_duration_s=natural, fitted_duration_s=spoken,
            tempo_factor=factor, title=scene['title'], text=scene['text'],
        ))
    with wave.open(str(directory / 'narration.wav'), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(combined)
    write_subtitles(kind, manifest)
    (directory / 'audio-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    text = '# ' + plan['title'] + ' · 旁白与分镜\n\n'
    text += '\n\n'.join(
        f"## {stamp(s['at'])} — {s['title']}\n\n操作：`{s['action']}`\n\n{s['text']}"
        for s in plan['segments']
    ) + '\n'
    (ROOT / 'media' / f'{kind}-narration.md').write_text(text, encoding='utf-8')


def render(kind, plan, record=True):
    directory = ROOT / 'artifacts/media' / kind
    if record:
        subprocess.run([
            'xvfb-run', '-a', '-s', '-screen 0 1920x1080x24',
            'node', 'tools/record_video.cjs', kind,
        ], cwd=ROOT, check=True)
    font = subprocess.check_output(['fc-match', '-f', '%{file}', 'Noto Sans CJK SC'], text=True)
    title = directory / 'title.txt'
    title.write_text('OpenHydroNet 0.1.0-preview.1  |  真实运行录制  |  开发预览，非正式发行', encoding='utf-8')
    srt = ROOT / 'artifacts/media' / f'{kind}.srt'
    output = ROOT / 'artifacts/media' / f'OpenHydroNet-{kind}-0.1.0-preview.1.mp4'
    vf = (
        'drawbox=x=0:y=960:w=1920:h=120:color=0x102b43:t=fill,'
        f"drawtext=fontfile='{font}':textfile='{title}':x=40:y=970:fontsize=21:fontcolor=0xa6c5d5,"
        f"subtitles='{srt}':force_style='FontName=Noto Sans CJK SC,FontSize=10,"
        "PrimaryColour=&H00FFFFFF,OutlineColour=&H00102B43,Outline=1,MarginV=5'"
    )
    subprocess.run([
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'warning',
        '-i', str(directory / 'capture.mkv'), '-i', str(directory / 'narration.wav'),
        '-vf', vf, '-t', str(plan['duration']), '-r', '30',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', str(output),
    ], check=True)
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output),
    ], text=True))
    probe['format']['filename'] = output.name  # Never publish a private absolute path.
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(output), '-f', 'null', '-'], check=True)
    for at in (10, 35, 70, 100, 205, 288):
        if at < plan['duration']:
            subprocess.run([
                'ffmpeg', '-y', '-loglevel', 'error', '-ss', str(at), '-i', str(output),
                '-frames:v', '1', str(directory / f'final-check-{at}.png'),
            ], check=True)
    recording = json.loads((directory / 'recording.json').read_text())
    report = dict(
        file=output.name, sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
        software='0.1.0-preview.1', commit=recording['commit'], duration=plan['duration'],
        probe=probe, decode_check='all frames decoded without ffmpeg error',
        human_listening_review=False,
        note='离线 eSpeak 合成，尚需人工试听与逐句校审；解码成功不等于真人试听通过',
    )
    (directory / 'quality-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print('DONE', output.name, flush=True)


if __name__ == '__main__':
    plans = json.loads((ROOT / 'media/storyboards.json').read_text())
    for kind in ('quickstart', 'intro'):
        if '--remux' in sys.argv:
            manifest = json.loads((ROOT / 'artifacts/media' / kind / 'audio-manifest.json').read_text())
            write_subtitles(kind, manifest)
            render(kind, plans[kind], record=False)
        else:
            make_audio(kind, plans[kind])
            render(kind, plans[kind])
