"""Public square grids with an independent linear-head analytical reference."""
import json
import os
from pathlib import Path
import platform
import resource
import subprocess
import sys
import time
ROOT=Path(__file__).resolve().parents[1]

def grid(side):
    nodes=[];edges=[];layout={}
    for y in range(side):
        for x in range(side):
            key=f'n{x}_{y}';nodes.append(dict(id=key,elevation=0,demand=0,head=50 if x==0 else 30 if x==side-1 else None));layout[key]=dict(x=x*100,y=y*100)
            for dx,dy in ((1,0),(0,1)):
                if x+dx<side and y+dy<side:edges.append(dict(id=f'e{x}_{y}_{dx}',source=key,target=f'n{x+dx}_{y+dy}',kind='pipe',length=10,diameter=.1,roughness=.00005,zeta=0))
    return dict(format='openhydronet',schema_version=1,name=f'公开基准 {side}×{side}',model=dict(nodes=nodes,edges=edges,fluid=dict(temperature=20)),layout=layout,scenarios=[],preferences=dict(flow_unit='m3/h',scenario='heating'),library=[])

if __name__=='__main__':
    if len(sys.argv)>1:
        from openhydronet import solve
        side=int(sys.argv[1]);p=grid(side);start=time.perf_counter();r=solve(p['model'],timeout=60)
        error=max(abs(r['nodes'][n['id']]['head_m']-(50-20*int(n['id'].split('_')[0][1:])/(side-1))) for n in p['model']['nodes']) if r.get('nodes') else None
        print(json.dumps(dict(side=side,nodes=len(p['model']['nodes']),edges=len(p['model']['edges']),elapsed_s=time.perf_counter()-start,peak_rss_mib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,status=r['status'],residuals=r.get('residuals'),analytical_head_max_error_m=error,iterations=r.get('iterations'))));sys.exit(0)
    directory=ROOT/'examples/benchmarks';directory.mkdir(exist_ok=True)
    records=[]
    for size in (5,10,20):
        (directory/f'grid-{size}.ohn.json').write_text(json.dumps(grid(size),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        child=subprocess.run([sys.executable,__file__,str(size)],capture_output=True,text=True,env={**os.environ,'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'},timeout=80)
        records.append(json.loads(child.stdout) if child.returncode==0 else dict(side=size,status='process_failure',error=child.stderr))
    machine=dict(platform=platform.platform(),python=platform.python_version(),cpu=subprocess.check_output(['lscpu'],text=True).splitlines())
    output=dict(machine=machine,records=records,criterion='质量≤1e-8 m³/s、能量≤1e-5 m、独立线性水头解析误差≤1e-4 m；运行总时间包含残差检查，不含启动与 UI')
    (ROOT/'artifacts/benchmark.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(output,ensure_ascii=False,indent=2))
