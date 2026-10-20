"""Curate local preview deliverables without publishing or exposing private paths."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'artifacts'
VERSION = '0.1.0-preview.1'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    subprocess.run(['git', 'diff', '--exit-code'], cwd=ROOT, check=True)
    build = json.loads((ART / 'WINDOWS_BUILD_MANIFEST.json').read_text(encoding='utf-8'))
    portable = ART / f'OpenHydroNet-{VERSION}-win-x64.zip'
    compared = []
    with ZipFile(portable) as archive:
        prefix = archive.namelist()[0].split('/')[0] + '/resources/app/'
        for folder in ('src', 'desktop', 'web/dist'):
            for file in sorted((ROOT / folder).rglob('*')):
                if not file.is_file() or '__pycache__' in file.parts or file.suffix == '.pyc':
                    continue
                relative = file.relative_to(ROOT).as_posix()
                if archive.read(prefix + relative) != file.read_bytes():
                    raise RuntimeError('当前运行时代码与候选包不同，必须重新构建：' + relative)
                compared.append(relative)
    source = ART / f'OpenHydroNet-{VERSION}-source.zip'
    # Keep the original exact software snapshot locally, not in public candidates.
    if source.exists():
        backup = ROOT / '.local/provenance-source'
        backup.mkdir(exist_ok=True)
        backup_file = backup / (digest(source)[:12] + '-source.zip')
        if not backup_file.exists():
            shutil.copy2(source, backup_file)
    subprocess.run([
        'git', 'archive', '--format=zip', f'--prefix=OpenHydroNet-{VERSION}/',
        '-o', str(source), commit,
    ], cwd=ROOT, check=True)
    examples = ART / f'OpenHydroNet-{VERSION}-examples.zip'
    with ZipFile(examples, 'w', ZIP_DEFLATED) as archive:
        archive.write(ROOT / 'LICENSE', 'LICENSE')
        for file in sorted((ROOT / 'examples').rglob('*.json')):
            archive.write(file, file.relative_to(ROOT).as_posix())
    docs = ART / f'OpenHydroNet-{VERSION}-docs.zip'
    with ZipFile(docs, 'w', ZIP_DEFLATED) as archive:
        for name in ('README.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md'):
            archive.write(ROOT / name, name)
        for folder in ('docs', 'media'):
            for file in sorted((ROOT / folder).rglob('*')):
                if file.is_file():
                    archive.write(file, file.relative_to(ROOT).as_posix())
    editable = ART / f'OpenHydroNet-{VERSION}-video-project.zip'
    with ZipFile(editable, 'w', ZIP_DEFLATED) as archive:
        archive.write(ROOT / 'LICENSE', 'LICENSE')
        for file in sorted((ROOT / 'media').rglob('*')):
            if file.is_file(): archive.write(file, file.relative_to(ROOT).as_posix())
        for name in ('record_video.cjs', 'render_videos.py', 'tts_local.py', 'check_media.py'):
            file = ROOT / 'tools' / name
            archive.write(file, 'tools/' + name)
        archive.write(ROOT / 'examples/closed-loop.ohn.json', 'examples/closed-loop.ohn.json')
        for kind in ('intro', 'quickstart'):
            directory = ART / 'media' / kind
            for name in ('capture.mkv', 'narration.wav', 'recording.json', 'audio-manifest.json', 'quality-check.json'):
                archive.write(directory / name, 'artifacts/media/' + kind + '/' + name)
            archive.write(ART / 'media' / f'{kind}.srt', 'artifacts/media/' + f'{kind}.srt')
    targets = sorted(ART.glob('*.zip')) + sorted((ART / 'media').glob('*.mp4'))
    targets += [ART / 'media/intro.srt', ART / 'media/quickstart.srt', ART / 'media/MEDIA_QA.json', ART / 'WINDOWS_BUILD_MANIFEST.json']
    records = [dict(path=file.relative_to(ART).as_posix(), bytes=file.stat().st_size, sha256=digest(file)) for file in targets]
    metadata = dict(
        version=VERSION, software_recording_commit=build['commit'], delivery_source_commit=commit,
        runtime_sources_byte_identical_to_portable=compared,
        note='交付源码提交补充文档/字幕后期/QA；运行时代码与便携包逐文件字节相同。软件录屏仍对应记录中的原提交。',
        windows_native_execution=False, github_published=False, gitee_published=False,
        human_video_listening_review=False, files=records,
    )
    index = ART / 'DELIVERY_INDEX.json'
    index.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = [record['sha256'] + '  ' + record['path'] for record in records]
    lines.append(digest(index) + '  ' + index.name)
    (ART / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')
    for file in targets:
        if file.suffix in ('.zip', '.mp4'):
            Path(str(file) + '.sha256').write_text(digest(file) + '  ' + file.name + '\n')
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
