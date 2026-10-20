"""Local privacy/redistribution gate; does not push or contact hosting platforms."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[1]


def main():
    tracked=subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
    issues=[]
    for name in filter(None,tracked):
        if name.startswith(('.local/','node_modules/','artifacts/')) or name.lower().endswith('.docx'):
            issues.append('禁止公开的文件：'+name)
        file=ROOT/name
        if file.suffix in ('.md','.ts','.tsx','.py','.cjs','.json','.yml','.txt'):
            text=file.read_text(errors='replace')
            # Split patterns so the audit's own source is not a false positive.
            for needle in (str(Path.home())+'/',str(Path.home())+'\\','-----BEGIN '+'PRIVATE KEY-----'):
                if needle in text:issues.append('私人路径/密钥迹象：'+name)
            if re.search(r'(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_]{20,}',text):issues.append('访问凭据迹象：'+name)
    for file in (ROOT/'artifacts').rglob('*.json'):
        text=file.read_text(encoding='utf-8',errors='replace')
        if str(Path.home()) in text:
            issues.append('公开产物 JSON 含私人绝对路径：'+str(file.relative_to(ROOT)))
    archives=[]
    for archive in (ROOT/'artifacts').glob('*win-x64.zip'):
        with ZipFile(archive) as z:
            corrupt=z.testzip()
            if corrupt:issues.append('ZIP CRC 错误：'+corrupt)
            names=z.namelist();prefix=names[0].split('/')[0]+'/'
            required=['OpenHydroNet.exe','LICENSE','LICENSES.chromium.html','BUILD_MANIFEST.json','resources/app/LICENSE','resources/app/runtime/python.exe','resources/app/runtime/python312._pth','resources/app/web/dist/index.html','resources/app/examples/closed-loop.ohn.json','resources/app/docs/USER_MANUAL.md','resources/app/third_party/FRONTEND_NOTICES.txt']
            for name in required:
                if prefix+name not in names:issues.append('包缺少文件：'+name)
            for name in ('OpenHydroNet.exe','resources/app/runtime/python.exe'):
                if z.read(prefix+name)[:2]!=b'MZ':issues.append('不是实际 Windows PE 文件：'+name)
            if any('/.local/' in n or n.lower().endswith('.docx') for n in names):issues.append('安装包含私有参考资料')
            build=json.loads(z.read(prefix+'BUILD_MANIFEST.json'))
            archives.append(dict(file=archive.name,bytes=archive.stat().st_size,sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),files=len(names),source_commit=build['commit'],windows_executed=build['windows_executed'],crc='passed',actual_pe_headers='passed'))
    output=dict(source_files=len(list(filter(None,tracked))),issues=issues,windows_archives=archives,remote_published=False,limitations='这是静态隐私/结构检查，不替代漏洞扫描、法律审查或 Windows 实际运行')
    (ROOT/'artifacts/release-audit.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(output,ensure_ascii=False,indent=2))
    if issues:raise SystemExit(1)

if __name__=='__main__':main()
