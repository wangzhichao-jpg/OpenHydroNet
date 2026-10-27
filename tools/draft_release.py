"""Create a GitHub DRAFT pre-release for an existing tag and upload verified assets (never publishes).

python tools/draft_release.py --tag v0.1.0-preview.5 --name "..." --notes docs/releases/v0.1.0-preview.5.md \
    --header header.md --asset path[=name] ...

- Refuses if a release for the tag already exists, or if the tag is not on the remote.
- Uploads with retry (a partial asset is deleted before retrying), then compares GitHub's recorded
  SHA-256 digest and size of every asset with the local file.
The token is read from the git credential file used by SER8 and is never printed.
"""
import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = 'wangzhichao-jpg/OpenHydroNet'
API = f'https://api.github.com/repos/{REPO}'


def token():
    text = (Path.home() / '.config/git/ohn-github-credentials').read_text()
    return re.match(r'https://[^:]*:([^@]*)@', text).group(1)


def call(method, url, data=None, content_type='application/json', timeout=60):
    body = json.dumps(data).encode() if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, method=method, headers={
        'Authorization': 'Bearer ' + token(), 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': content_type})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b'null')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tag', required=True)
    ap.add_argument('--name', required=True)
    ap.add_argument('--notes', required=True, type=Path)
    ap.add_argument('--header', type=Path, help='status block placed above the notes')
    ap.add_argument('--asset', action='append', default=[], help='local path, optionally path=uploaded-name')
    a = ap.parse_args()
    assets = []
    for spec in a.asset:
        path, _, name = spec.partition('=')
        assets.append((Path(path), name or Path(path).name))
    digests = {name: sha256(path) for path, name in assets}
    if any(r['tag_name'] == a.tag for r in call('GET', f'{API}/releases?per_page=100')):
        sys.exit(f'已存在 {a.tag} 的 Release，不重复创建')
    call('GET', f'{API}/git/ref/tags/{urllib.parse.quote(a.tag)}')   # 404 → HTTPError: tag must exist remotely
    body = (a.header.read_text(encoding='utf-8') + '\n' if a.header else '') + a.notes.read_text(encoding='utf-8')
    release = call('POST', f'{API}/releases', dict(tag_name=a.tag, name=a.name, body=body, draft=True, prerelease=True))
    print('DRAFT', release['id'], flush=True)
    upload = release['upload_url'].split('{')[0]
    for path, name in assets:
        data = path.read_bytes()
        for attempt in range(1, 4):
            try:
                t = time.time()
                asset = call('POST', f'{upload}?name={urllib.parse.quote(name)}', data,
                             'application/zip' if name.endswith('.zip') else 'application/octet-stream', timeout=3600)
                print(f'UPLOADED {name} {asset["size"]} bytes {time.time() - t:.0f}s', flush=True)
                break
            except Exception as exc:
                print(f'RETRY {name} attempt {attempt}: {exc}', flush=True)
                for old in call('GET', f'{API}/releases/{release["id"]}/assets'):
                    if old['name'] == name: call('DELETE', old['url'])
                if attempt == 3: raise
    failed = False
    for asset in call('GET', f'{API}/releases/{release["id"]}/assets'):
        remote = (asset.get('digest') or '').removeprefix('sha256:')
        size_ok = asset['size'] == next(p for p, n in assets if n == asset['name']).stat().st_size
        ok = size_ok and remote == digests[asset['name']]
        failed |= not ok
        print(f'VERIFY {asset["name"]} size={asset["size"]} sha256={"match" if ok else "MISMATCH"}', flush=True)
    if failed: sys.exit('附件校验失败')
    print('DONE', release['id'])


if __name__ == '__main__':
    main()
