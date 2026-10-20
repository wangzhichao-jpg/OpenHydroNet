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

def fetch(url,name,expected=None):
    path=D/name
    if not path.exists():
        print('DOWNLOAD',url,flush=True)
        subprocess.run(['curl','--fail','--location','--retry','2','--connect-timeout','20','--max-time','240','--output',str(path.with_suffix(path.suffix+'.part')),url],check=True)
        path.with_suffix(path.suffix+'.part').replace(path)
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
fetch('https://repo.huaweicloud.com/python/3.12.10/'+pyname,pyname,expected)
checks=fetch('https://npmmirror.com/mirrors/electron/38.2.0/SHASUMS256.txt','electron-38.2.0-SHASUMS256.txt')
name='electron-v38.2.0-win32-x64.zip'
digest=next(line.split()[0] for line in checks.read_text().splitlines() if line.split()[-1].lstrip('*')==name)
fetch('https://npmmirror.com/mirrors/electron/38.2.0/'+name,name,digest)
subprocess.run([sys.executable,'-m','pip','download','--dest',str(D),'--cache-dir',str(ROOT/'.local/pip-cache'),'--platform','win_amd64','--python-version','312','--implementation','cp','--abi','cp312','--only-binary=:all:','--no-deps','--index-url','https://pypi.tuna.tsinghua.edu.cn/simple','numpy==2.4.3','scipy==1.17.1'],check=True)
for wheel in sorted(D.glob('*.whl')):
    records.append(dict(file=wheel.name,url='https://pypi.tuna.tsinghua.edu.cn/simple (pip verifies index SHA-256 fragment)',sha256=hashlib.sha256(wheel.read_bytes()).hexdigest(),bytes=wheel.stat().st_size))
(D/'manifest.json').write_text(json.dumps(records,indent=2)+'\n')
print('DONE',json.dumps(records,indent=2),flush=True)
