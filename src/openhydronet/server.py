"""Loopback-only authenticated protocol v1. No arbitrary local file endpoints."""
from __future__ import annotations
import hmac
import base64
import json
import mimetypes
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote
from uuid import uuid4
from .validation import validate
from .solver import model_hash
from .export import result_csv,report_html
from .project import check_project
from .version import VERSION
from .library import fit_definition, validate_entry, import_catalog
from .tableio import read_table, preview_import, workbook_export

PROTOCOL=1
ROOT=Path(__file__).resolve().parents[2]


class Jobs:
    def __init__(self):
        self.items={};self.lock=threading.RLock();self.closed=False
    def start(self,model,owner='legacy'):
        if not isinstance(owner,str) or not 1<=len(owner)<=128:raise ValueError('任务所有者必须为 1–128 字符的不透明请求 ID')
        digest=model_hash(model)
        with self.lock:
            if self.closed:raise ValueError('计算服务正在退出，拒绝启动新任务')
            for job in self.items.values():
                if job['input_hash']==digest and job['status']=='running' and job['owner']==owner: return self.public(job)
            if sum(j['status']=='running' for j in self.items.values())>=2:
                raise ValueError("最多同时计算两个任务，请等待或取消现有任务")
            for key in list(self.items):
                if len(self.items)>30 and self.items[key]['status']!='running': del self.items[key]
            process=subprocess.Popen([sys.executable,'-m','openhydronet.cli','solve','-','--timeout','45'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env={**os.environ,'PYTHONIOENCODING':'utf-8','OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'})
            job={'id':str(uuid4()),'status':'running','input_hash':digest,'created':time.time(),'owner':owner,'process':process}
            self.items[job['id']]=job
            threading.Thread(target=self.wait,args=(job,model),daemon=True).start()
            return self.public(job)
    def wait(self,job,model):
        try:
            out,err=job['process'].communicate(json.dumps(model,allow_nan=False),timeout=50)
            result=json.loads(out)
            result.update(job_id=job['id'],request_owner=job['owner'])
            with self.lock:
                if job['status']=='running':job.update(status='completed',result=result)
        except subprocess.TimeoutExpired:
            job['process'].kill();job['process'].communicate()
            with self.lock:
                if job['status']=='running':job.update(status='timeout',error='任务超过 50 秒，计算进程已终止')
        except Exception as exc:
            with self.lock:
                if job['status']=='running':job.update(status='failed',error='计算进程异常：'+str(exc))
    def public(self,j):return {k:v for k,v in j.items() if k!='process'}
    def cancel(self,key):
        with self.lock:
            j=self.items[key];process=j['process'];terminate=j['status']=='running'
            if terminate:j['status']='cancelled'
        if terminate and process.poll() is None:
            try:
                process.terminate();process.wait(timeout=2)
            except subprocess.TimeoutExpired:process.kill();process.wait()
            except ProcessLookupError:pass
        with self.lock:
            j['process_stopped']=process.poll() is not None
            return self.public(j)
    def shutdown(self):
        with self.lock:self.closed=True;keys=list(self.items)
        for key in keys:self.cancel(key)
        for j in list(self.items.values()):
            try:j['process'].wait(timeout=3)
            except subprocess.TimeoutExpired:j['process'].kill();j['process'].wait()


def serve(port=0):
    token=os.environ.get('OHN_SESSION_TOKEN') or secrets.token_urlsafe(32)
    jobs=Jobs()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def reply(self,status,data,typ='application/json; charset=utf-8'):
            body=json.dumps(data,ensure_ascii=False,allow_nan=False).encode() if typ.startswith('application/json') else data.encode() if isinstance(data,str) else data
            self.send_response(status);self.send_header('Content-Type',typ);self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'")
            self.end_headers();self.wfile.write(body)
        def auth(self):
            if not hmac.compare_digest(self.headers.get('X-Session-Token',''),token):
                self.reply(401,{'error':'本地会话认证失败'});return False
            host=self.headers.get('Host','')
            if host != f'127.0.0.1:{self.server.server_port}':
                self.reply(403,{'error':'不允许的主机'});return False
            return True
        def do_GET(self):
            path=urlparse(self.path).path
            if path.startswith('/api/'):
                if not self.auth():return
                if path=='/api/health':return self.reply(200,{'protocol':PROTOCOL,'version':VERSION})
                if path=='/api/examples':
                    return self.reply(200,[json.loads(p.read_text(encoding='utf-8')) for p in sorted((ROOT/'examples').glob('*.ohn.json'))])
                if path.startswith('/api/jobs/'):
                    with jobs.lock:
                        job=jobs.items.get(path.rsplit('/',1)[-1])
                        return self.reply(200,jobs.public(job)) if job else self.reply(404,{'error':'任务不存在'})
                return self.reply(404,{'error':'未知接口'})
            base=(ROOT/'web'/'dist').resolve()
            dest=(base/unquote(path).lstrip('/')).resolve()
            if not dest.is_relative_to(base):return self.reply(403,{'error':'禁止越界'})
            if path=='/':dest=base/'index.html'
            if not dest.is_file():return self.reply(404,{'error':'资源不存在；请先 npm run build'})
            return self.reply(200,dest.read_bytes(),mimetypes.guess_type(dest.name)[0] or 'application/octet-stream')
        def do_POST(self):
            if not self.auth():return
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=5_000_000:return self.reply(413,{'error':'请求大小无效或超过 5 MB'})
                payload=json.loads(self.rfile.read(size))
                path=urlparse(self.path).path
                if path=='/api/validate':return self.reply(200,{'issues':validate(payload)})
                if path=='/api/jobs':
                    return self.reply(202,jobs.start(payload['model'],payload['owner'])) if isinstance(payload,dict) and 'model' in payload and 'owner' in payload else self.reply(202,jobs.start(payload))
                if path=='/api/check-project':return self.reply(200,check_project(payload))
                if path=='/api/fit-pump':return self.reply(200,fit_definition(payload))
                if path=='/api/library/check':return self.reply(200,validate_entry(payload))
                if path=='/api/library/import':return self.reply(200,import_catalog(payload))
                if path=='/api/table/read':return self.reply(200,read_table(payload))
                if path=='/api/table/preview':return self.reply(200,preview_import(payload))
                if path=='/api/export':
                    project=check_project(payload['project']);result=payload.get('result')
                    if payload['kind']=='parameters-xlsx':
                        content=workbook_export(project)
                        return self.reply(200,{'content_base64':base64.b64encode(content).decode(),'mime':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
                    if model_hash(project['model'])!=result.get('input_hash'):
                        raise ValueError('计算结果已过期，不能导出为当前工程结果')
                    if payload['kind']=='xlsx':
                        content=workbook_export(project,result)
                        return self.reply(200,{'content_base64':base64.b64encode(content).decode(),'mime':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
                    if payload['kind']=='csv':return self.reply(200,result_csv(project['model'],result),'text/csv; charset=utf-8')
                    if payload['kind']=='html':return self.reply(200,report_html(project,result),'text/html; charset=utf-8')
                    raise ValueError('未知导出格式')
                return self.reply(404,{'error':'未知接口'})
            except (ValueError,KeyError,TypeError,AttributeError) as exc:
                return self.reply(400,{'error':str(exc)})
        def do_DELETE(self):
            if not self.auth():return
            if not self.path.startswith('/api/jobs/'):return self.reply(404,{'error':'未知接口'})
            try:self.reply(200,jobs.cancel(self.path.rsplit('/',1)[-1]))
            except KeyError:self.reply(404,{'error':'任务不存在'})
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    def stop(*_):
        threading.Thread(target=server.shutdown,daemon=True).start()
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    print(json.dumps({'protocol':PROTOCOL,'port':server.server_port,'token':token}),flush=True)
    try:server.serve_forever(poll_interval=.2)
    finally:jobs.shutdown();server.server_close()


if __name__=='__main__':serve()
