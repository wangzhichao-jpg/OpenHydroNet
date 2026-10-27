"""Fetch redistributable Windows runtime from checked domestic mirrors.
Run in a systemd user job with flock. HTTPS validation is never disabled.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT=Path(__file__).resolve().parents[1];D=ROOT/'.local/downloads';D.mkdir(parents=True,exist_ok=True)
records=[]

def fetch(urls,name,expected=None):
    """Download from the first reachable URL (domestic mirror first, official source as fallback)."""
    urls=(urls,) if isinstance(urls,str) else urls
    path=D/name;url=urls[0]
    if not path.exists():
        for url in urls:
            print('DOWNLOAD',url,flush=True)
            part=path.with_suffix(path.suffix+'.part')
            if subprocess.run(['curl','--fail','--location','--retry','2','--connect-timeout','20','--max-time','600','--output',str(part),url]).returncode==0:
                part.replace(path);break
        else:raise RuntimeError('所有下载源均失败：'+name)
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    if expected and digest!=expected:raise RuntimeError(f'Checksum mismatch: {name}')
    records.append(dict(file=name,url=url,sha256=digest,bytes=path.stat().st_size,verification='SHA-256 matched expected digest' if expected else 'HTTPS transport + recorded SHA-256'))
    return path

pyname='python-3.12.10-embed-amd64.zip'
bundle=fetch('https://www.python.org/ftp/python/3.12.10/'+pyname+'.sigstore',pyname+'.sigstore')
sigstore=json.loads(bundle.read_text())
# This verifies content against the digest published by python.org over TLS;
# it does not claim a full offline Sigstore transparency/certificate verification.
expected=sigstore.get('messageSignature',{}).get('messageDigest',{}).get('digest')
if not expected:
    # Legacy sigstore bundle: dsseEnvelope payload contains an in-toto subject.
    import base64
    payload=json.loads(base64.b64decode(sigstore['dsseEnvelope']['payload']))
    expected=payload['subject'][0]['digest']['sha256']
else:
    import base64
    expected=base64.b64decode(expected).hex()
fetch(('https://repo.huaweicloud.com/python/3.12.10/'+pyname,'https://www.python.org/ftp/python/3.12.10/'+pyname),pyname,expected)
ELECTRON=('https://npmmirror.com/mirrors/electron/44.9.1/','https://github.com/electron/electron/releases/download/v44.9.1/')
checks=fetch(tuple(u+'SHASUMS256.txt' for u in ELECTRON),'electron-44.9.1-SHASUMS256.txt')
name='electron-v44.9.1-win32-x64.zip'
digest=next(line.split()[0] for line in checks.read_text().splitlines() if line.split()[-1].lstrip('*')==name)
fetch(tuple(u+name for u in ELECTRON),name,digest)
# Domestic mirror first; fall back to PyPI when it is unreachable (e.g. hosted CI abroad). Same pinned versions.
for index in ('https://pypi.tuna.tsinghua.edu.cn/simple','https://pypi.org/simple'):
    pip=subprocess.run([sys.executable,'-m','pip','download','--timeout','60','--dest',str(D),'--cache-dir',str(ROOT/'.local/pip-cache'),'--platform','win_amd64','--python-version','312','--implementation','cp','--abi','cp312','--only-binary=:all:','--no-deps','--index-url',index,'numpy==2.4.3','scipy==1.17.1','openpyxl==3.1.5','et-xmlfile==2.0.0','defusedxml==0.7.1'])
    if pip.returncode==0:break
else:raise SystemExit('Windows wheel 下载失败（清华与 PyPI 均不可用）')
for wheel in sorted(D.glob('*.whl')):
    records.append(dict(file=wheel.name,url=index+' (pip verifies index SHA-256 fragment)',sha256=hashlib.sha256(wheel.read_bytes()).hexdigest(),bytes=wheel.stat().st_size))
(D/'manifest.json').write_text(json.dumps(records,indent=2)+'\n')
print('DONE',json.dumps(records,indent=2),flush=True)
