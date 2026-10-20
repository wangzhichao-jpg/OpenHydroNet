"""Versioned projects, atomic writes and explicit format rejection."""
from __future__ import annotations
import copy
import json
import os
import tempfile
from pathlib import Path
from .validation import validate, ModelError


class ProjectError(ValueError):
    pass


def _model_structure(model):
    import math
    if not isinstance(model, dict): raise ProjectError('工程缺少物理模型对象')
    numeric = {'elevation','head','demand','length','diameter','roughness','zeta','local_ratio',
               'resistance','design_head','design_flow','demand_tolerance','speed','parallel',
               'efficiency','nominal_rpm','kv','opening','rangeability','set_flow','min_head'}
    def finite(v): return type(v) in (int,float) and math.isfinite(v)
    ids=set()
    for key in ('nodes','edges'):
        values=model.get(key)
        if not isinstance(values,list) or not all(isinstance(x,dict) for x in values):
            raise ProjectError(f'model.{key} 必须是对象数组')
        for item in values:
            oid=item.get('id')
            if not isinstance(oid,str) or not oid or oid in ids or oid in ('__proto__','constructor','prototype'):
                raise ProjectError('对象 ID 缺失、重复或保留字，不会自动重写 ID')
            ids.add(oid)
            for label in ('name','data_source'):
                if label in item and not isinstance(item[label],str): raise ProjectError(f'{oid}.{label} 必须是文本')
            if 'device_data' in item:
                metadata=item['device_data']
                if not isinstance(metadata,dict) or any(k in metadata and not isinstance(metadata[k],str) for k in ('name','data_source','library_id','source_kind')):
                    raise ProjectError(f'{oid} 的设备来源元数据类型错误')
            for field in numeric & item.keys():
                if item[field] is None and field in ('head','efficiency','nominal_rpm'): continue
                if not finite(item[field]): raise ProjectError(f'{oid}.{field} 必须是有限数，不能为文本或布尔值')
            for field in ('closed','check_valve'):
                if field in item and type(item[field]) is not bool: raise ProjectError(f'{oid}.{field} 必须是布尔值')
            if 'curve' in item and (not isinstance(item['curve'],list) or not 1<=len(item['curve'])<=4 or not all(finite(v) for v in item['curve'])):
                raise ProjectError(f'{oid} 的曲线需为 1–4 个有限系数')
    node_ids={n['id'] for n in model['nodes']}
    for e in model['edges']:
        if e.get('kind') not in ('pipe','pump','valve','terminal','resistance','flow_control'):
            raise ProjectError(f"不支持的设备模型：{e['id']}，请使用支持该设备的版本")
        if not isinstance(e.get('source'),str) or not isinstance(e.get('target'),str) or e.get('source') not in node_ids or e.get('target') not in node_ids:
            raise ProjectError(f"支路 {e['id']} 的端点引用失效")
    fluid=model.setdefault('fluid',{})
    if not isinstance(fluid,dict): raise ProjectError('物性设置必须为对象')
    t=fluid.get('temperature',20);p=fluid.get('atmospheric_pressure',101325)
    if not finite(t) or not 0<=t<=100 or not finite(p) or p<=0:
        raise ProjectError('水温须为 0–100 ℃，当地大气压须为正数；不会自动修改输入')


def check_project(data, *, check_model=False):
    if not isinstance(data,dict) or data.get('format')!='openhydronet': raise ProjectError('不是 OpenHydroNet 工程文件')
    if type(data.get('schema_version')) is not int or data['schema_version']!=1:
        raise ProjectError(f"不支持的工程版本 {data.get('schema_version')}；仅支持 schema_version=1，不猜测转换")
    try: json.dumps(data,allow_nan=False)
    except (TypeError,ValueError) as exc: raise ProjectError('工程包含不支持的数据或非有限数') from exc
    data=copy.deepcopy(data)
    data.setdefault('name','未命名工程')
    if not isinstance(data['name'],str): raise ProjectError('工程名称必须是文本')
    _model_structure(data.get('model'))
    for key,default in (('layout',{}),('scenarios',[]),('preferences',{}),('library',[])):
        data.setdefault(key,default)
        if not isinstance(data[key],type(default)): raise ProjectError(f'{key} 字段类型错误')
    for oid,pos in data['layout'].items():
        import math
        if not isinstance(pos,dict) or not all(type(pos.get(k)) in (int,float) and math.isfinite(pos[k]) for k in ('x','y')):
            raise ProjectError(f'布局 {oid} 的 x/y 坐标必须是有限数')
    prefs=data['preferences'];prefs.setdefault('flow_unit','m3/h');prefs.setdefault('scenario','heating')
    if prefs['flow_unit'] not in ('m3/h','kg/h','t/h','L/s') or prefs['scenario'] not in ('heating','airconditioning'):
        raise ProjectError('不支持的显示单位或系统场景')
    seen=set()
    for scenario in data['scenarios']:
        if not isinstance(scenario,dict) or not isinstance(scenario.get('id'),str) or not scenario['id'] or scenario['id'] in seen or not isinstance(scenario.get('name'),str):
            raise ProjectError('工况须包含唯一 ID、文本名称和完整模型/结果')
        seen.add(scenario['id']);_model_structure(scenario.get('model'))
        result=scenario.get('result')
        if not isinstance(result,dict) or not isinstance(result.get('edges'),dict) or not isinstance(result.get('nodes'),dict):
            raise ProjectError('工况计算结果结构错误')
        for group in ('edges','nodes'):
            if not all(isinstance(v,dict) for v in result[group].values()): raise ProjectError('工况设备结果须为对象')
    from .library import validate_entry
    if len(data['library'])>500:raise ProjectError('工程设备库最多 500 个条目，请拆分工程')
    library_ids=set()
    for entry in data['library']:
        try:
            validate_entry(entry,complete=False)
            if entry['id'] in library_ids:raise ValueError('设备库 ID 重复')
            library_ids.add(entry['id'])
        except (ValueError,TypeError) as exc:raise ProjectError(f'设备库结构错误：{exc}') from exc
    if check_model:
        issues=validate(data['model'])
        if issues: raise ModelError(issues)
    return data


def load_project(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"), parse_constant=lambda x: (_ for _ in ()).throw(ProjectError(f"非法数值 {x}")))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ProjectError("工程不是有效 UTF-8 JSON；请尝试恢复草稿或备份") from exc
    return check_project(data)


def save_project(path, project):
    project = check_project(project)
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(project, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    # Same-directory replacement is atomic on supported local filesystems.
    fd, temporary = tempfile.mkstemp(prefix=f".{p.name}.", suffix=".tmp", dir=p.parent)
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            f.write(payload); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, p)
        if os.name != "nt":
            dfd = os.open(p.parent, os.O_DIRECTORY)
            try: os.fsync(dfd)
            finally: os.close(dfd)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    return str(p)


def migrate(data):
    """Version 1 is the first public schema; no fictional legacy migration."""
    return check_project(copy.deepcopy(data))
