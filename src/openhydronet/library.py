"""Portable nameplate/curve definitions. No implicit manufacturer certification."""
import copy
import math
import numpy as np
from .physics import water, flow_to_si, fit_pump
from .validation import validate

FIELDS = {
    'pump': {'curve','valid_flow','efficiency','nominal_rpm'},
    'valve': {'kv','characteristic','rangeability'},
}


def validate_entry(entry, *, complete=True):
    if not isinstance(entry,dict) or not isinstance(entry.get('id'),str) or not entry['id']:
        raise ValueError('设备库条目缺少稳定 ID')
    kind=entry.get('kind')
    if not isinstance(kind,str) or kind not in FIELDS: raise ValueError('设备库仅支持水泵和阀门')
    if not isinstance(entry.get('name'),str) or (complete and not entry['name'].strip()):
        raise ValueError('设备名称必须为文本且应用前不能为空')
    source=entry.get('data_source','')
    if not isinstance(source,str) or (complete and not source.strip()):
        raise ValueError('请提供数据来源；示例必须标为虚构，不能包装成厂家数据')
    if entry.get('source_kind','user') not in ('synthetic','user','manufacturer'):
        raise ValueError('未知数据来源类别')
    for text in ('points_text',):
        if text in entry and not isinstance(entry[text],str):raise ValueError('性能点草稿必须是文本')
    if entry.get('point_unit','m3/h') not in ('m3/h','kg/h','t/h','L/s'):raise ValueError('未知性能点流量单位')
    if entry.get('fit_degree',2) not in (2,3):raise ValueError('只支持二次/三次曲线')
    if 'point_temperature' in entry and (type(entry['point_temperature']) not in (int,float) or not math.isfinite(entry['point_temperature']) or not 0<=entry['point_temperature']<=100):raise ValueError('性能点水温必须在 0–100 ℃')
    fitted=entry.get('fit')
    if fitted is not None:
        if not isinstance(fitted,dict) or not isinstance(fitted.get('points_si'),list) or not 3<=len(fitted['points_si'])<=100:raise ValueError('拟合元数据需含 3–100 个有限性能点')
        for key in ('rmse_m','density_kg_m3','temperature_c'):
            if type(fitted.get(key)) not in (int,float) or not math.isfinite(fitted[key]):raise ValueError('拟合元数据必须为有限数')
        for point in fitted['points_si']:
            if not isinstance(point,dict) or not all(type(point.get(k)) in (int,float) and math.isfinite(point[k]) for k in ('flow_m3_s','head_m')):raise ValueError('原始性能点结构错误')
    params=entry.get('parameters')
    if not isinstance(params,dict) or set(params)-FIELDS[kind]:
        raise ValueError('设备库参数包含未知字段或稳定 ID/连接/运行状态字段')
    if kind=='pump' and 'curve' not in params: raise ValueError('水泵条目需要基准曲线')
    if kind=='valve' and 'kv' not in params: raise ValueError('阀条目需要全开 Kv')
    if params.get('nominal_rpm') is not None:
        rpm=params['nominal_rpm']
        if type(rpm) not in (int,float) or not math.isfinite(rpm) or rpm<=0:
            raise ValueError('额定转速必须为正的有限数，单位 rpm')
    edge=dict(id='device-check',kind=kind,source='a',target='b',**params)
    issues=validate(dict(nodes=[dict(id='a',head=0),dict(id='b',head=0)],edges=[edge]))
    if issues: raise ValueError('；'.join(i['message'] for i in issues))
    return copy.deepcopy(entry)


def import_catalog(payload):
    if not isinstance(payload,dict) or payload.get('format')!='openhydronet-library' or type(payload.get('schema_version')) is not int or payload['schema_version']!=1:
        raise ValueError('不是受支持的设备库 JSON；需要 openhydronet-library / schema_version=1')
    entries=payload.get('entries')
    if not isinstance(entries,list) or not 1<=len(entries)<=500:raise ValueError('设备库须含 1–500 个条目')
    checked=[validate_entry(entry) for entry in entries]
    if len({entry['id'] for entry in checked})!=len(checked):raise ValueError('原库 ID 重复，请先修正；不猜测覆盖关系')
    return {'entries':checked}


def fit_definition(payload):
    q=payload.get('flows');h=payload.get('heads');degree=payload.get('degree',2)
    if not isinstance(q,list) or not isinstance(h,list) or not 3<=len(q)<=100 or len(q)!=len(h):
        raise ValueError('请提供 3–100 组同长度的流量/扬程；三次拟合至少四点')
    if not all(type(v) in (int,float) and math.isfinite(v) for v in q+h) or any(v<0 for v in q+h):
        raise ValueError('泵性能点必须为非负有限数，不接受布尔值、文本或空值')
    temperature=payload.get('temperature',20)
    if type(temperature) not in (int,float) or not math.isfinite(temperature):raise ValueError('点数据水温必须为有限数')
    rho,_=water(temperature)
    unit=payload.get('flow_unit','m3/h')
    try: flows=[flow_to_si(v,unit,rho) for v in q]
    except (KeyError,TypeError) as exc: raise ValueError('未知拟合流量单位') from exc
    try: fitted=fit_pump(flows,h,degree)
    except np.linalg.LinAlgError as exc: raise ValueError('拟合数据病态；请核对点值和流量范围') from exc
    if not math.isfinite(fitted['rmse_m']) or not all(math.isfinite(v) for v in fitted['curve']): raise ValueError('拟合系数非有限数，拒绝应用')
    samples=np.linspace(min(flows),max(flows),81)
    heads=np.polynomial.polynomial.polyval(samples,fitted['curve'])
    warnings=[]
    if np.any(heads<0):warnings.append('数据范围内存在负扬程拟合段；请复核模型阶数和数据')
    if np.any(np.diff(heads)>1e-6):warnings.append('基准曲线存在正斜率段；不保证工作点唯一或稳定，不自动改写数据')
    return {**fitted,'points_si':[dict(flow_m3_s=q,head_m=float(h)) for q,h in zip(flows,h)],
            'sampled_curve':[dict(flow_m3_s=float(q),head_m=float(h)) for q,h in zip(samples,heads)],
            'temperature_c':temperature,'density_kg_m3':rho,'input_flow_unit':unit,'warnings':warnings}
