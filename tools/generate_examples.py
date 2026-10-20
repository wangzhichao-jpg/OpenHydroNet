"""Regenerate public synthetic examples; no manufacturer or real project data."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def build():
    names={'s0':'泵出口','s1':'供水分配','s2':'远端供水','t1':'末端一入口','t2':'末端二入口','r0':'定压点 / 泵入口','r1':'回水汇合','r2':'远端回水'}
    positions={'s0':(140,120),'s1':(440,120),'s2':(760,120),'t1':(440,290),'t2':(760,290),'r0':(140,480),'r1':(440,480),'r2':(760,480)}
    nodes=[dict(id=k,name=v,elevation=0,demand=0,head=30 if k=='r0' else None) for k,v in names.items()]
    edges=[]
    def pipe(i,s,t,length,diameter):edges.append(dict(id=i,name=i,kind='pipe',source=s,target=t,length=length,diameter=diameter,roughness=.00005,zeta=2,local_mode='zeta'))
    pipe('P1','s0','s1',75,.08);pipe('P2','s1','s2',100,.065);pipe('P3','r2','r1',100,.065);pipe('P4','r1','r0',75,.08)
    edges.append(dict(id='PU1',name='循环泵 · 虚构示例',kind='pump',source='r0',target='s0',curve=[32,0,-180000],speed=1,parallel=1,check_valve=True,valid_flow=[0,.013],data_source='人工构造，非厂家数据'))
    for i in (1,2):
        edges.append(dict(id=f'V{i}',name=f'调节阀 {i}',kind='valve',source=f's{i}',target=f't{i}',opening=1,kv=85,characteristic='linear'))
        edges.append(dict(id=f'T{i}',name=f'用户末端 {i}',kind='terminal',source=f't{i}',target=f'r{i}',design_head=8,design_flow=.004))
    return dict(format='openhydronet',schema_version=1,name='双末端闭式循环 · 公开教学示例',model=dict(nodes=nodes,edges=edges,fluid=dict(temperature=20,atmospheric_pressure=101325)),layout={k:dict(x=x,y=y) for k,(x,y) in positions.items()},scenarios=[],preferences=dict(flow_unit='m3/h',scenario='heating'),library=[],notes='人工构造教学网络，无真实工程或厂家数据。定压点测压水头 30 m；所有节点标高 0 m。调低泵速会降低末端流量。')

if __name__=='__main__':
    project=build();(ROOT/'examples'/'closed-loop.ohn.json').write_text(json.dumps(project,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
