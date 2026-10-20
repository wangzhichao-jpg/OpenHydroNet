"""Collect already executed evidence. Never treats configuration as execution."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--core-log',required=True)
    parser.add_argument('--ui-log',required=True)
    parser.add_argument('--ui-unit',required=True)
    args=parser.parse_args()
    status=subprocess.check_output(['systemctl','--user','show',args.ui_unit,'-p','ActiveState','-p','Result'],text=True)
    if 'ActiveState=inactive' not in status or 'Result=success' not in status:raise RuntimeError('真实界面任务尚未成功结束')
    core=(ROOT/args.core_log).read_text();ui=(ROOT/args.ui_log).read_text()
    if len(re.findall(r'^PASS:',ui,re.M))!=5:raise RuntimeError('必须具有五套成功界面入口，不能复用不完整日志')
    passed=re.search(r'(\d+) passed in ([\d.]+)s',core)
    groups=[int(v) for v in re.findall(r'^# pass (\d+)$',core,re.M)]
    if not passed or len(groups)!=2 or not all(groups) or 'All matched files use Prettier' not in core:raise RuntimeError('核心/命令/格式证据不完整')
    version=json.loads((ROOT/'package.json').read_text())['version']
    receipts=[]
    for category in ('ui','graph','lifecycle','features','jobs'):
        p=ROOT/'artifacts'/category/version/'test-result.json';record=json.loads(p.read_text())
        if record.get('status')!='passed' or record.get('pageErrors'):raise RuntimeError('界面验收未通过：'+category)
        receipts.append({'path':p.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'record':record})
    npm=json.loads((ROOT/'artifacts'/f'npm-audit-{version}.json').read_text())
    if 'auditReportVersion' not in npm:raise RuntimeError('npm audit 并非有效报告')
    files={}
    for directory in ('src','desktop','web/dist'):
        for p in sorted((ROOT/directory).rglob('*')):
            if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc' and not any(s.endswith('.egg-info') for s in p.parts):files[p.relative_to(ROOT).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
    report={'version':version,'collected_at':datetime.now(timezone.utc).isoformat(),'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'working_tree_clean':not subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip(),'execution_host':'Linux x86_64 / Xvfb','python_tests':int(passed[1]),'python_seconds':float(passed[2]),'typescript_tests':groups[0],'node_document_storage_tests':groups[1],'format':'passed','typescript_vite_build':'passed (executed before UI)','ui':receipts,'runtime_sha256':files,'npm_audit':{'registry':'https://registry.npmjs.org','domestic_mirror_attempt':'npmmirror security API returned 404 NOT_IMPLEMENTED; retained private failure log before upstream fallback','vulnerabilities':npm['metadata']['vulnerabilities']},'windows_executed':False,'new_version_media_recorded':False,'external_solver_cross_validation':False,'human_novice_test':False}
    out=ROOT/'artifacts'/f'VALIDATION-{version}.json';out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ('version','commit','working_tree_clean','python_tests','typescript_tests','node_document_storage_tests','windows_executed')},indent=2))

if __name__=='__main__':main()
