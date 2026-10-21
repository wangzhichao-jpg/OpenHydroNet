"""Versioned local preview delivery, not publication or Windows execution evidence."""
import hashlib
import json
from pathlib import Path
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
A = ROOT / 'artifacts'
VERSION = json.loads((ROOT / 'package.json').read_text())['version']

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def audit_history():
    objects={line.split(b' ',1)[0].decode():line.split(b' ',1)[1].decode(errors='replace') for line in git('rev-list','--objects','--all').splitlines() if b' ' in line}
    findings=[];count=0
    import re
    rules={'private-home':b'/home/'+b'zhichao'+b'wang','api-key':rb'\bsk-[A-Za-z0-9_-]{20,}', 'private-key':rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----'}
    for oid,path in objects.items():
        if git('cat-file','-t',oid).strip()!=b'blob':continue
        count+=1
        if path.startswith('.local/') or path.lower().endswith('.docx'):findings.append({'path':path,'rule':'private-reference-file','blob':oid[:12]})
        data=git('cat-file','blob',oid)
        if b'\x00' in data[:8192]:continue
        for rule,pattern in rules.items():
            if re.search(pattern,data):findings.append({'path':path,'rule':rule,'blob':oid[:12]})
    return {'reachable_blobs':count,'findings':findings,'scope':'reachable local Git history only; heuristic scan plus reviewed synthetic screenshots, not a security certification'}

def main():
    if git('status','--porcelain').strip():raise RuntimeError('先提交源码/文档，工作区必须干净')
    commit=git('rev-parse','HEAD').decode().strip()
    archive=A/f'OpenHydroNet-{VERSION}-win-x64.zip';prefix=f'OpenHydroNet-{VERSION}-win-x64/'
    if not archive.exists():raise FileNotFoundError('先从干净提交实际构建对应 Windows 候选')
    privacy=audit_history()
    if privacy['findings']:raise RuntimeError('历史审计发现需人工复核的条目：'+json.dumps(privacy['findings'],ensure_ascii=False))
    with ZipFile(archive) as z:
        if z.testzip() is not None:raise RuntimeError('Windows ZIP CRC 失败')
        build=json.loads(z.read(prefix+'BUILD_MANIFEST.json'))
        if build['version']!=VERSION or build['windows_executed'] is not False:raise RuntimeError('构建清单版本/验证标志不符')
        executable=z.read(prefix+'OpenHydroNet.exe');offset=int.from_bytes(executable[0x3c:0x40],'little')
        if executable[:2]!=b'MZ' or executable[offset:offset+4]!=b'PE\x00\x00' or int.from_bytes(executable[offset+4:offset+6],'little')!=0x8664:raise RuntimeError('不是实际 PE 可执行文件')
        app=prefix+'resources/app/'
        for required in (prefix+'LICENSE',prefix+'LICENSES.chromium.html',app+'LICENSE',app+'third_party/FRONTEND_NOTICES.txt',app+'runtime/LICENSE.txt'):
            if required not in z.namelist():raise RuntimeError('缺少必要许可：'+required)
        for name in ('openpyxl','et_xmlfile','defusedxml','numpy','scipy'):
            if app+'runtime/Lib/site-packages/'+name+'/__init__.py' not in z.namelist():raise RuntimeError('缺少随包依赖 '+name)
            licenses=[p for p in z.namelist() if '/'+name+'-' in p and '.dist-info/' in p and any(t in p.lower() for t in ('license','licence','copying'))]
            if not licenses:raise RuntimeError('缺少 Python 依赖许可 '+name)
        runtime=[]
        for directory in ('src','desktop','web/dist'):
            for file in sorted((ROOT/directory).rglob('*')):
                if not file.is_file() or '__pycache__' in file.parts or any(p.endswith('.egg-info') for p in file.parts) or file.suffix=='.pyc':continue
                relative=file.relative_to(ROOT).as_posix()
                if z.read(app+relative)!=file.read_bytes():raise RuntimeError('运行时代码不一致，必须重建 Windows 候选：'+relative)
                runtime.append(relative)
        if z.read(app+'package.json')!=(ROOT/'package.json').read_bytes():raise RuntimeError('包版本/桌面入口配置不一致')
    evidence=json.loads((A/f'VALIDATION-{VERSION}.json').read_text())
    if evidence['version']!=VERSION or evidence['commit']!=build['commit']:raise RuntimeError('验证来源与实际软件构建提交不一致')
    for relative,digest in evidence['runtime_sha256'].items():
        if not (ROOT/relative).is_file() or sha((ROOT/relative).read_bytes())!=digest:raise RuntimeError('验证后运行时代码已变化，必须重新测试：'+relative)
    if set(runtime)!=set(evidence['runtime_sha256']):raise RuntimeError('验证后的运行时文件集合已经改变')
    media=A/'media'/VERSION
    media_products=[]
    media_updated=(media/'MEDIA_QA.json').is_file()
    if media_updated:
        qa=json.loads((media/'MEDIA_QA.json').read_text())
        asr=json.loads((media/'NARRATION_FINAL_ASR.json').read_text())
        if len(qa)!=2 or not asr.get('accepted') or asr.get('software')!=VERSION:
            raise RuntimeError('新版媒体证据不完整')
        for r in qa:
            name=r['file']
            if Path(name).name!=name or r['software']!=VERSION or r['commit']!=build['commit'] or not r.get('full_decode'):
                raise RuntimeError('视频版本/录制来源/全片解码不符')
            video=media/name
            if sha(video.read_bytes())!=r['sha256']:raise RuntimeError('视频在验证后变化')
            same=next((v for v in asr['records'] if v.get('file')==name),None)
            if not same or not same['accepted'] or same['sha256']!=r['sha256']:
                raise RuntimeError('最终音轨识别与视频归属不一致')
            media_products.append(video)
        media_products.extend(media/name for name in ('intro.srt','quickstart.srt','MEDIA_QA.json','NARRATION_FINAL_ASR.json'))
    tracked=[s.decode() for s in git('ls-files','-z').split(b'\x00') if s]
    products=[archive]
    source=A/f'OpenHydroNet-{VERSION}-source.zip'
    if source.exists():raise FileExistsError('源码快照已存在，先检查归档，不自动覆盖')
    subprocess.run(['git','archive','--format=zip',f'--prefix=OpenHydroNet-{VERSION}/',f'--output={source}',commit],cwd=ROOT,check=True)
    products.append(source)
    for label,heads in [('docs',('docs/',)),('examples',('examples/','schemas/'))]:
        path=A/f'OpenHydroNet-{VERSION}-{label}.zip'
        if path.exists():raise FileExistsError('分发快照已存在，请先归档：'+path.name)
        with ZipFile(path,'w',ZIP_DEFLATED) as output:
            for name in tracked:
                if name in ('LICENSE','README.md','CHANGELOG.md') or any(name.startswith(h) for h in heads):output.write(ROOT/name,name)
        products.append(path)
    for path in products:
        with ZipFile(path) as z:
            if z.testzip() is not None:raise RuntimeError('分发 ZIP CRC 失败：'+path.name)
    audit=A/f'RELEASE_AUDIT-{VERSION}.json'
    audit.write_text(json.dumps({'version':VERSION,'software_commit':build['commit'],'delivery_commit':commit,'runtime_files_byte_identical':runtime,'zip_crc':'passed','windows_pe':'passed','windows_executed':False,'git_history':privacy},ensure_ascii=False,indent=2)+'\n')
    products.extend([audit,A/f'WINDOWS_BUILD_MANIFEST-{VERSION}.json',A/f'VALIDATION-{VERSION}.json',A/f'npm-audit-{VERSION}.json',*media_products])
    numerical=A/'numerical'/VERSION/'ROBUSTNESS.json'
    if numerical.is_file():products.append(numerical)
    index=A/f'DELIVERY_INDEX-{VERSION}.json'
    index.write_text(json.dumps({'version':VERSION,'software_commit':build['commit'],'delivery_commit':commit,'published':False,'windows_executed':False,'media_version':VERSION if media_updated else None,'media_updated_for_this_version':media_updated,'media_human_listening_review':False,'pending':['this-version Windows native revalidation; preview.2 conditional feedback kept separately','human narration review']+([] if media_updated else ['new-version video'])+['full B/C parity','confirmed GitHub/Gitee/public video destinations'],'files':[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in products]},ensure_ascii=False,indent=2)+'\n')
    products.append(index)
    checks=A/f'SHA256SUMS-{VERSION}'
    checks.write_text(''.join(f'{sha(p.read_bytes())}  {p.relative_to(A).as_posix()}\n' for p in products))
    print(json.dumps({'version':VERSION,'software_commit':build['commit'],'delivery_commit':commit,'runtime_files_matched':len(runtime),'history_blobs':privacy['reachable_blobs'],'index':str(index.relative_to(ROOT)),'checksums':str(checks.relative_to(ROOT)),'windows_executed':False},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
