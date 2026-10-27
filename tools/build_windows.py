"""Build a REAL Windows x64 portable archive without cross-compiling native code.

Inputs are upstream Electron + CPython embeddable + official Windows wheels.
This is assembly, not a substitute for executing Windows acceptance tests.
Requires `npm run build`, `tools/download_windows.py`, and a clean git commit.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from zipfile import ZipFile,ZIP_DEFLATED,ZipInfo

ROOT=Path(__file__).resolve().parents[1];D=ROOT/'.local/downloads';VERSION=json.loads((ROOT/'package.json').read_text())['version']

def main():
    if subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip():raise RuntimeError('请先提交所有源码/文档并确认工作区干净，禁止把未提交代码打入候选包')
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    manifest=json.loads((D/'manifest.json').read_text())
    for entry in manifest:
        if hashlib.sha256((D/entry['file']).read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('下载校验失败：'+entry['file'])
    destination=ROOT/'build'/f'OpenHydroNet-{VERSION}-win-x64'
    if destination.exists():raise FileExistsError('构建目录已存在；请先检查或归档，不自动覆盖')
    destination.mkdir(parents=True)
    with ZipFile(D/'electron-v44.9.1-win32-x64.zip') as z:z.extractall(destination)
    (destination/'electron.exe').rename(destination/'OpenHydroNet.exe')
    application=destination/'resources/app';application.mkdir(parents=True)
    for directory in ('src','desktop','examples','docs','third_party','schemas'):
        shutil.copytree(ROOT/directory,application/directory,ignore=shutil.ignore_patterns('__pycache__','*.pyc','*.egg-info'))
    for name in ('package.json','LICENSE','README.md','CHANGELOG.md','SECURITY.md'):
        shutil.copy2(ROOT/name,application/name)
    shutil.copytree(ROOT/'web/dist',application/'web/dist')
    runtime=application/'runtime';runtime.mkdir()
    with ZipFile(D/'python-3.12.10-embed-amd64.zip') as z:z.extractall(runtime)
    site=runtime/'Lib/site-packages';site.mkdir(parents=True)
    for package in ('numpy','scipy','openpyxl','et_xmlfile','defusedxml'):
        wheels=list(D.glob(f'{package}-*.whl'))
        if len(wheels)!=1:raise ValueError('需要唯一锁定 Windows wheel：'+package)
        with ZipFile(wheels[0]) as z:z.extractall(site)
    (runtime/'python312._pth').write_text('python312.zip\n.\nLib/site-packages\n../src\nimport site\n',encoding='utf-8')
    # A double-clickable console smoke test uses exactly the bundled interpreter.
    (destination/'验证计算.cmd').write_bytes(('@echo off\r\ncd /d "%~dp0"\r\nresources\\app\\runtime\\python.exe -m openhydronet.cli solve resources\\app\\examples\\closed-loop.ohn.json -o smoke-result.json\r\nif errorlevel 1 (echo FAILED & pause & exit /b 1)\r\necho SUCCESS: see smoke-result.json\r\npause\r\n').encode('utf-8'))
    (destination/'开始使用.txt').write_text('OpenHydroNet '+VERSION+'\n\n解压到可写目录后启动 OpenHydroNet.exe。不需要联网，不需要额外安装 Python。\n软件为开源预览版本，适合方案比选与工程辅助计算。\n先运行 验证计算.cmd 检查内核，再使用公开示例完成桌面流程验收。\n用户手册：resources/app/docs/USER_MANUAL.md\n已知限制：resources/app/docs/KNOWN_LIMITATIONS.md\n开源许可：resources/app/LICENSE；Electron/Chromium 许可在本目录 LICENSE 与 LICENSES.chromium.html。\n',encoding='utf-8')
    build=dict(version=VERSION,commit=commit,platform='win32-x64',assembly_host=sys.platform,windows_executed=False,inputs=manifest,protocol=1,format_version=1)
    (destination/'BUILD_MANIFEST.json').write_text(json.dumps(build,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    # A fresh checkout (CI) has no artifacts/ directory: it is git-ignored and must not be tracked.
    artifacts=ROOT/'artifacts';artifacts.mkdir(exist_ok=True);archive=artifacts/(destination.name+'.zip')
    with ZipFile(archive,'w',ZIP_DEFLATED,compresslevel=6) as z:
        for file in sorted(destination.rglob('*')):
            if not file.is_file():continue
            info=ZipInfo(destination.name+'/'+file.relative_to(destination).as_posix(),date_time=(2026,10,20,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o100644<<16
            z.writestr(info,file.read_bytes())
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    (artifacts/(archive.name+'.sha256')).write_text(digest+'  '+archive.name+'\n')
    shutil.copy2(destination/'BUILD_MANIFEST.json',artifacts/f'WINDOWS_BUILD_MANIFEST-{VERSION}.json')
    print(json.dumps(dict(archive=str(archive.relative_to(ROOT)),bytes=archive.stat().st_size,sha256=digest,commit=commit,windows_executed=False),indent=2))

if __name__=='__main__':main()
