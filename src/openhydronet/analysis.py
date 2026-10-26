"""Steady scenarios and bounded local feasibility search, not transients."""
import copy
import itertools
import math
from scipy.optimize import minimize
from .solver import solve, model_hash
from .validation import ModelError


def patched_model(model, changes):
    result = copy.deepcopy(model)
    lookup = {x["id"]: x for x in result["nodes"]+result["edges"]}
    for change in changes:
        oid, field, value = change["id"], change["field"], change["value"]
        if oid not in lookup or field in ("id", "source", "target", "kind"):
            raise ValueError("工况不能修改稳定 ID、端点或设备类型")
        lookup[oid][field] = value
    return result


MAX_SCAN_POINTS = 1000
# Operating adjustments only (SPEC-001 D3): design parameters are not scanned.
ADJUSTABLE = {"pump": {"speed": (0.0, 2.0)}, "valve": {"opening": (0.0, 1.0)}}
OBSERVABLE_FIELDS = {
    "edge": {"flow_m3_s", "head_drop_m", "velocity_m_s", "pressure_drop_pa"},
    "node": {"head_m", "pressure_pa_gauge"},
}


def observe(result, observables):
    """Extract scalar observables (SI) from one solve; missing values are None, never guessed."""
    values = []
    for o in observables:
        item = (result.get(o["scope"] + "s") or {}).get(o["id"]) or {}
        value = item.get(o["field"])
        values.append(float(value) if isinstance(value, (int, float)) and math.isfinite(value) else None)
    return values


def issue_refs(result):
    """Distinct (code, object) pairs of one solve, sorted; messages stay with the full solve result."""
    pairs = sorted({(i.get("code", ""), i.get("object_id") or "") for i in result.get("issues") or []})
    return [dict(code=code, object_id=oid or None) for code, oid in pairs]


def scan(model, variables, observables=None, progress=None):
    """Independent steady solves at Cartesian grid. No temporal state.

    With ``observables`` each record keeps only those values (compact form for the desktop);
    without, the full result is kept (historic API/CLI behaviour).
    """
    size = 1
    for v in variables: size *= len(v["values"])
    if size > MAX_SCAN_POINTS:
        raise ValueError("单批扫描限 1000 点；请拆分批次")
    records, fluid = [], None
    for combination in itertools.product(*(v["values"] for v in variables)):
        changes = [dict(id=v["id"], field=v["field"], value=float(value)) for v,value in zip(variables, combination)]
        m = patched_model(model, changes)
        try:
            r = solve(m)
        except ModelError as exc:
            r = {"status":"invalid_model", "issues":exc.issues, "input_hash":model_hash(m)}
        if observables is None:
            records.append({"changes":changes, "result":r})
        else:
            fluid = fluid or r.get("fluid")
            converged = r["status"] in ("converged", "demand_unsatisfied")
            records.append({"changes":changes, "status":r["status"],
                            "values":observe(r, observables) if converged else [None]*len(observables),
                            "issues":issue_refs(r)})
        if progress: progress(len(records), size)
    out = {"analysis":"independent_steady_scan", "base_input_hash":model_hash(model), "records":records}
    if observables is not None: out["fluid"] = fluid  # scans never change temperature
    return out


def _check_observables(model, observables):
    if not isinstance(observables, list) or not observables:
        raise ValueError("请至少选择一个观测量")
    ids = {"edge": {e["id"] for e in model["edges"]}, "node": {n["id"] for n in model["nodes"]}}
    clean = []
    for o in observables:
        scope, oid, field = (o or {}).get("scope"), (o or {}).get("id"), (o or {}).get("field")
        if scope not in OBSERVABLE_FIELDS or oid not in ids[scope] or field not in OBSERVABLE_FIELDS[scope]:
            raise ValueError(f"观测量无效：{scope}/{oid}/{field}")
        clean.append(dict(scope=scope, id=oid, field=field))
    return clean


def _check_adjustable(model, v):
    edges = {e["id"]: e for e in model["edges"]}
    e = edges.get(v.get("id"))
    if e is None:
        raise ValueError(f"参数对象不存在：{v.get('id')}")
    limits = ADJUSTABLE.get(e["kind"], {}).get(v.get("field"))
    if limits is None:
        raise ValueError("可调参数仅限泵相对转速和阀开度；不修改设计参数")
    return limits


def check_request(request):
    """Validate and normalise a desktop analysis request; raises ValueError with a Chinese message.

    scan: {kind, model, variables:[{id, field, values:[...]}] (1–2), observables:[{scope, id, field}]}
    """
    if not isinstance(request, dict) or request.get("kind") not in ("scan", "accessibility"):
        raise ValueError("不支持的分析类型")
    model = request.get("model")
    if not isinstance(model, dict) or not isinstance(model.get("edges"), list) or not isinstance(model.get("nodes"), list):
        raise ValueError("分析请求缺少模型")
    if request["kind"] == "accessibility":
        if request.get("variables"):
            raise ValueError("调节量搜索尚未开放；当前只做固定工作点检查")
        return dict(kind="accessibility", model=model, constraints=_check_constraints(model, request.get("constraints")),
                    variables=[], total=1)
    variables = request.get("variables")
    if not isinstance(variables, list) or not 1 <= len(variables) <= 2:
        raise ValueError("扫描参数为 1–2 个")
    clean, size, seen = [], 1, set()
    for v in variables:
        low, high = _check_adjustable(model, v)
        key = (v["id"], v["field"])
        if key in seen: raise ValueError("同一参数不能重复扫描")
        seen.add(key)
        values = v.get("values")
        if not isinstance(values, list) or not values:
            raise ValueError("扫描取值不能为空")
        if any(not isinstance(x, (int, float)) or isinstance(x, bool) or not math.isfinite(x) for x in values):
            raise ValueError("扫描取值必须是有限数值")
        if any(not low <= x <= high for x in values):
            raise ValueError(f"扫描取值超出允许范围 {low}–{high}")
        size *= len(values)
        clean.append(dict(id=v["id"], field=v["field"], values=[float(x) for x in values]))
    if size > MAX_SCAN_POINTS:
        raise ValueError("单批扫描限 1000 点；请拆分批次")
    return dict(kind="scan", model=model, variables=clean,
                observables=_check_observables(model, request.get("observables")), total=size)


def _check_constraints(model, constraints):
    """Constraints on edge results (SI): min_flow/max_flow [m³/s], min_head [m] head drop; non-negative."""
    if not isinstance(constraints, list) or not constraints:
        raise ValueError("请至少设置一条约束")
    edges = {e["id"] for e in model["edges"]}
    clean, seen = [], set()
    for c in constraints:
        if not isinstance(c, dict) or c.get("id") not in edges:
            raise ValueError(f"约束对象不存在或不是支路：{(c or {}).get('id') if isinstance(c, dict) else c}")
        keys = set(c) - {"id"}
        if not keys or not keys <= set(CONSTRAINT_KINDS):
            raise ValueError("约束仅支持 min_flow、max_flow、min_head，且至少一项")
        item = {"id": c["id"]}
        for key in sorted(keys):
            value = c[key]
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                raise ValueError("约束值必须是有限数值")
            if value < 0:
                raise ValueError("约束值不能为负")
            if (c["id"], key) in seen:
                raise ValueError(f"同一支路的同类约束重复：{c['id']} {key}")
            seen.add((c["id"], key))
            item[key] = float(value)
        clean.append(item)
    bounds = {}
    for c in clean:
        for key in ("min_flow", "max_flow"):
            if key in c: bounds.setdefault(c["id"], {})[key] = c[key]
    for oid, b in bounds.items():
        if "min_flow" in b and "max_flow" in b and b["min_flow"] > b["max_flow"]:
            raise ValueError(f"{oid} 的流量下限大于上限")
    return clean


def run_request(request, progress=None):
    """Run a validated desktop analysis request. ``progress(done, total)`` is called per solve."""
    req = check_request(request)
    if req["kind"] == "accessibility":
        result = accessibility(req["model"], req["constraints"])
        if progress: progress(1, 1)
        result.update(kind="accessibility", constraints=req["constraints"], fluid=result["result"].get("fluid"),
                      checks=constraint_checks(result["result"], req["constraints"]))
        return result
    result = scan(req["model"], req["variables"], req["observables"], progress)
    result.update(kind="scan", variables=req["variables"], observables=req["observables"])
    return result


CONSTRAINT_KINDS = {"min_flow": "flow_m3_s", "min_head": "head_drop_m", "max_flow": "flow_m3_s"}


def constraint_checks(result, constraints):
    """Every constraint with actual/required values; ``satisfied`` False carries a relative violation.

    Returns None when the point has no qualified hydraulic solution (nothing can be checked).
    """
    if result["status"] != "converged":
        return None
    checks=[]
    for c in constraints:
        r = result["edges"].get(c["id"])
        if r is None:
            raise ValueError(f"约束引用失效：{c['id']}")
        for key in ("min_flow","min_head","max_flow"):
            if key not in c: continue
            actual, required = r[CONSTRAINT_KINDS[key]], c[key]
            if key == "max_flow":
                margin, tolerance = required-actual, 1e-9
            else:
                margin, tolerance = actual-required, 1e-7*max(1,abs(required))
            satisfied = margin >= -tolerance
            checks.append({"id":c["id"],"kind":key,"actual":actual,"required":required,
                           "violation":0 if satisfied else -margin/max(abs(required),1e-6),"satisfied":satisfied})
    return checks


def constraint_violations(result, constraints):
    checks = constraint_checks(result, constraints)
    if checks is None:
        return [{"id":None, "kind":"solver", "violation":1e6, "message":"该点评估未获得合格水力解"}]
    return [{k:v for k,v in c.items() if k != "satisfied"} for c in checks if not c["satisfied"]]


def accessibility(model, constraints, variables=None, *, max_iterations=50):
    """Fixed check or bounded LOCAL feasibility search; never a global no-solution claim."""
    variables = variables or []
    base = solve(model)
    violations = constraint_violations(base,constraints)
    if not variables:
        return {"mode":"fixed_operating_point", "conclusion":"feasible_at_this_point" if not violations else "not_satisfied_at_this_point", "violations":violations, "result":base, "global_guarantee":False}
    ids={e["id"]:e for e in model["edges"]}
    allowed={"pump":{"speed"}, "valve":{"opening"}}
    for v in variables:
        e=ids.get(v["id"])
        if not e or v["field"] not in allowed.get(e["kind"],set()):
            raise ValueError("可调变量仅限泵速和阀开度；不修改设计需求")
        absolute=(0,2) if v["field"]=="speed" else (0,1)
        if not absolute[0] <= v["lower"] < v["upper"] <= absolute[1]:
            raise ValueError("变量上下界无效")
    best = {"penalty":float("inf"),"result":base,"violations":violations,"values":None}
    def evaluate(x):
        changes=[dict(id=v["id"],field=v["field"],value=float(value)) for v,value in zip(variables,x)]
        try:
            r=solve(patched_model(model,changes))
            viol=constraint_violations(r,constraints)
            penalty=sum(c["violation"]**2 for c in viol)
        except ModelError:
            return 1e12
        if penalty < best["penalty"]:
            best.update(penalty=penalty,result=r,violations=viol,values=changes)
        return penalty
    bounds=[(v["lower"],v["upper"]) for v in variables]
    x0=[min(v["upper"],max(v["lower"],ids[v["id"]].get(v["field"],1))) for v in variables]
    evaluate(x0)
    # A deterministic midpoint and upper-bound start reduce, but do not remove,
    # dependence on the local solver. No claim of global optimization is made.
    for start in (x0,[(a+b)/2 for a,b in bounds],[b for a,b in bounds]):
        minimize(evaluate,start,method="Powell",bounds=bounds,options={"maxiter":max_iterations,"xtol":1e-5,"ftol":1e-8})
        if not best["violations"]: break
    return {"mode":"bounded_local_feasibility_search", "conclusion":"feasible_point_found" if not best["violations"] else "undetermined", "global_guarantee":False,
            "variables":variables,"changes":best["values"],"violations":best["violations"],"result":best["result"],
            "note":"局部搜索未找到可行点不代表全局不可行；建议检查最不利末端、扩大真实可用调节范围或复核泵阀数据"}


def sensitivity(model, edge_id, field, step, observable_edge, observable_field="flow_m3_s"):
    if step <= 0: raise ValueError("差分步长必须为正")
    edge=next(e for e in model["edges"] if e["id"]==edge_id)
    value=edge[field]
    points=[]
    for offset in (-step,step):
        points.append(solve(patched_model(model,[dict(id=edge_id,field=field,value=value+offset)])))
    if any(r["status"]!="converged" for r in points):
        return {"status":"undetermined","points":points}
    return {"status":"central_difference", "derivative":(points[1]["edges"][observable_edge][observable_field]-points[0]["edges"][observable_edge][observable_field])/(2*step),"step":step,"points":points}
