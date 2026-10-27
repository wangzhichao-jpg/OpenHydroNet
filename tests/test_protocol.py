import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import pytest
from pathlib import Path

@pytest.fixture
def backend():
    proc=subprocess.Popen([sys.executable,'-m','openhydronet.cli','serve'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    info=json.loads(proc.stdout.readline());yield info
    proc.terminate();proc.wait(timeout=8)


def call(info,path,data=None,method=None,token=True):
    url=f"http://127.0.0.1:{info['port']}/api/{path}"
    request=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json',**({'X-Session-Token':info['token']} if token else {})},method=method)
    # No proxy for a loopback service, irrespective of machine proxy settings.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=10) as response:
        return json.loads(response.read())


def test_auth_and_protocol(backend):
    assert call(backend,'health')['protocol']==1
    with pytest.raises(urllib.error.HTTPError) as exc:call(backend,'health',token=False)
    assert exc.value.code==401


def test_job_ownership_and_completion(backend):
    p=json.loads((Path(__file__).resolve().parents[1]/'examples/closed-loop.ohn.json').read_text())
    job=call(backend,'jobs',p['model'])
    for _ in range(100):
        done=call(backend,'jobs/'+job['id'])
        if done['status']!='running':break
        time.sleep(.03)
    assert done['status']=='completed'
    assert done['result']['status']=='converged'
    assert done['input_hash']==done['result']['input_hash']


def test_cancel_and_unknown_task(backend):
    p=json.loads((Path(__file__).resolve().parents[1]/'examples/closed-loop.ohn.json').read_text())
    job=call(backend,'jobs',p['model'])
    done=call(backend,'jobs/'+job['id'],method='DELETE')
    assert done['status'] in ('cancelled','completed')
    assert call(backend,'jobs/'+job['id'])['status']!='running'
    with pytest.raises(urllib.error.HTTPError) as exc:call(backend,'jobs/missing')
    assert exc.value.code==404


def test_stale_export_rejected(backend):
    p=json.loads((Path(__file__).resolve().parents[1]/'examples/closed-loop.ohn.json').read_text())
    with pytest.raises(urllib.error.HTTPError) as exc:call(backend,'export',dict(project=p,result={'input_hash':'wrong'},kind='csv'))
    assert exc.value.code==400


def test_balance_pairing_preview_and_job_over_http(backend):
    p=json.loads((Path(__file__).resolve().parents[1]/'examples/closed-loop.ohn.json').read_text())
    pairs=call(backend,'balance/pairs',p['model'])
    assert [(x['terminal'],x['valve']) for x in pairs['paired']]==[('T1','V1'),('T2','V2')]
    assert pairs['unpaired']==[] and pairs['ambiguous']==[]
    job=call(backend,'analysis-jobs',dict(owner='o',request=dict(kind='balance',model=p['model'],mode='variable',pump='PU1')))
    for _ in range(200):
        done=call(backend,'analysis-jobs/'+job['id'])
        if done['status']!='running':break
        time.sleep(.05)
    assert done['status']=='completed' and done['result']['index_terminal']=='T2'
    with pytest.raises(urllib.error.HTTPError) as exc:call(backend,'balance/pairs',{'nodes':'x'})
    assert exc.value.code==400
