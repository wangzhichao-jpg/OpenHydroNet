"""模型校验不修改输入。问题携带稳定对象 ID 及修复建议。"""
import math


class ModelError(ValueError):
    def __init__(self, issues):
        self.issues = issues
        super().__init__("；".join(x["message"] for x in issues))


def active_edge(e):
    return not (e.get("closed", False) or (e.get("kind") == "valve" and e.get("opening", 1) == 0) or (e.get("kind") == "pump" and e.get("speed", 1) == 0))


def validate(model):
    issues = []
    def add(code, obj, message, fix):
        issues.append(dict(code=code, object_id=obj if isinstance(obj,str) else None, message=message, fix=fix, severity="error"))
    def number(obj, key, default, lo=-math.inf, hi=math.inf, strict=False):
        v = obj.get(key, default)
        if not isinstance(v, (float, int)) or isinstance(v, bool) or not math.isfinite(v) or (v <= lo if strict else v < lo) or v > hi:
            add("PARAMETER", obj.get("id"), f"{key} 必须在{'(' if strict else '['}{lo}, {hi}] 范围且为有限数", "在属性面板修正该值；软件不会替换用户输入")
    if not isinstance(model, dict):
        add('STRUCTURE', None, '物理模型必须是对象', '使用版本化工程格式')
        return issues
    nodes, edges = model.get("nodes", []), model.get("edges", [])
    if not isinstance(nodes, list) or not isinstance(edges, list) or not all(isinstance(x,dict) for x in nodes+edges):
        add('STRUCTURE', None, '节点和支路必须是对象数组', '检查导入字段映射与工程格式')
        return issues
    if not nodes:
        add("EMPTY", None, "工程没有节点", "从闭式循环模板开始或拖入节点")
    ids = set()
    for obj in nodes + edges:
        key = obj.get("id")
        if not isinstance(key, str) or not key or key in ids:
            add("ID", key, "对象 ID 缺失或重复", "为每个对象设置唯一稳定 ID")
        if isinstance(key,str): ids.add(key)
        if 'name' in obj and not isinstance(obj['name'],str):
            add('NAME',key,'设备名称必须是文本','检查导入列的数据类型')
        for state in ('closed','check_valve'):
            if state in obj and type(obj[state]) is not bool:
                add('STATE',key,'关闭/止回状态必须是布尔值','使用 true/false，不把文本当作开关')
    if issues:
        return issues
    node_ids = {n.get("id") for n in nodes}
    for n in nodes:
        number(n, "elevation", 0)
        number(n, "demand", 0)
        if n.get("head") is not None:
            number(n, "head", 0)
    supported = {"pipe", "pump", "valve", "terminal", "resistance", "flow_control"}
    for e in edges:
        eid = e.get("id")
        if not isinstance(e.get('source'),str) or not isinstance(e.get('target'),str) or e.get("source") not in node_ids or e.get("target") not in node_ids:
            add("REFERENCE", eid, "支路端点引用失效", "重新连接支路端口")
        if e.get("source") == e.get("target"):
            add("SELF_LOOP", eid, "支路不能首尾连接同一个节点", "增加另一个节点，组成有效循环")
        kind = e.get("kind")
        if not isinstance(kind,str) or kind not in supported:
            add("DEVICE", eid, "不支持的设备模型", "选择已定义的设备类型")
            continue
        if kind == "pipe":
            number(e, "length", 100, 0, strict=True)
            number(e, "diameter", .1, 0, strict=True)
            number(e, "roughness", .00005, 0)
            number(e, "zeta", 0, 0)
            number(e, "local_ratio", 0, 0)
            if e.get("local_mode", "zeta") not in ("zeta", "ratio"):
                add("LOCAL_MODE", eid, "局部阻力模型未知", "选择动压系数或沿程倍率")
            if e.get("zeta", 0) and e.get("local_ratio", 0):
                add("DOUBLE_LOSS", eid, "局部阻力重复定义", "仅保留一种局部阻力输入")
        if kind == "resistance":
            number(e, "resistance", 1e5, 0, strict=True)
        if kind == "terminal":
            number(e, "design_head", 10, 0, strict=True)
            number(e, "design_flow", .01, 0, strict=True)
            number(e, 'demand_tolerance', .05, 0, 1)
        if kind == "valve":
            number(e, "opening", 1, 0, 1)
            number(e, "kv", 100, 0, strict=True)
            number(e, "rangeability", 50, 1)
            if e.get("characteristic", "linear") not in ("linear", "equal_percentage"):
                add("VALVE_MODEL", eid, "阀门特性未知", "选择线性或等百分比")
        if kind == "pump":
            number(e, "speed", 1, 0, 2)
            number(e, "parallel", 1, 1, 20)
            count=e.get('parallel',1)
            if isinstance(count,(int,float)) and math.isfinite(count) and count != int(count):
                add("PUMP_COUNT", eid, "并联台数必须为整数", "输入实际相同泵台数")
            curve = e.get("curve", [25, 0, -50000])
            if not isinstance(curve, list) or not 1 <= len(curve) <= 4 or not all(type(v) in (int,float) and math.isfinite(v) for v in curve):
                add("CURVE", eid, "泵曲线需为 1–4 个有限升幂系数", "检查泵曲线编辑器")
            if 'valid_flow' in e:
                interval=e['valid_flow']
                if not isinstance(interval,list) or len(interval)!=2 or not all(type(v) in (int,float) and math.isfinite(v) for v in interval) or not 0<=interval[0]<interval[1]:
                    add('CURVE_RANGE',eid,'泵有效流量范围必须为 [非负下限, 更大的上限]，单位 m³/s','使用真实数据范围，不自动扩大范围')
            if e.get('nominal_rpm') is not None:number(e,'nominal_rpm',None,0,strict=True)
            if e.get("efficiency") is not None:
                number(e, "efficiency", .7, 0, 1, strict=True)
        if kind == "flow_control":
            number(e, "set_flow", .01, 0, strict=True)
            number(e, "min_head", 0, 0)
    fluid = model.get("fluid", {})
    if not isinstance(fluid,dict):
        add('FLUID', 'fluid', '物性设置必须是对象', '恢复有效的水温和大气压设置')
        return issues
    number({"id": "fluid", **fluid}, "temperature", 20, 0, 100)
    number({"id": "fluid", **fluid}, "atmospheric_pressure", 101325, 0, strict=True)
    if issues:
        return issues
    adjacency = {n["id"]: set() for n in nodes}
    for e in edges:
        if active_edge(e):
            adjacency[e["source"]].add(e["target"])
            adjacency[e["target"]].add(e["source"])
    unseen = set(adjacency)
    while unseen:
        start = min(unseen); component = {start}; stack = [start]
        while stack:
            for nxt in adjacency[stack.pop()] - component:
                component.add(nxt); stack.append(nxt)
        unseen -= component
        if not any(n.get("head") is not None for n in nodes if n["id"] in component):
            add("UNREFERENCED_COMPONENT", start, f"连通分量缺少定压参考（{len(component)} 个节点）；可能由关闭阀门造成", "定位该分量；确认隔离意图后增加真实定压边界，不自动添加虚构边界")
    return issues
