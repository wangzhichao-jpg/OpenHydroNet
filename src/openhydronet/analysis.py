"""Steady scenarios and bounded local feasibility search, not transients."""
import copy
import itertools
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


def scan(model, variables):
    """Independent steady solves at Cartesian grid. No temporal state."""
    size = 1
    for v in variables: size *= len(v["values"])
    if size > 1000:
        raise ValueError("单批扫描限 1000 点；请拆分批次")
    records = []
    for combination in itertools.product(*(v["values"] for v in variables)):
        changes = [dict(id=v["id"], field=v["field"], value=float(value)) for v,value in zip(variables, combination)]
        m = patched_model(model, changes)
        try:
            r = solve(m)
        except ModelError as exc:
            r = {"status":"invalid_model", "issues":exc.issues, "input_hash":model_hash(m)}
        records.append({"changes":changes, "result":r})
    return {"analysis":"independent_steady_scan", "base_input_hash":model_hash(model), "records":records}


def constraint_violations(result, constraints):
    violations=[]
    if result["status"] != "converged":
        return [{"id":None, "kind":"solver", "violation":1e6, "message":"该点评估未获得合格水力解"}]
    for c in constraints:
        r = result["edges"].get(c["id"])
        if r is None:
            raise ValueError(f"约束引用失效：{c['id']}")
        for key, field in (("min_flow","flow_m3_s"),("min_head","head_drop_m")):
            if key in c:
                margin=r[field]-c[key]
                if margin < -1e-7*max(1,abs(c[key])):
                    violations.append({"id":c["id"],"kind":key,"actual":r[field],"required":c[key],"violation":-margin/max(abs(c[key]),1e-6)})
        if "max_flow" in c:
            margin=c["max_flow"]-r["flow_m3_s"]
            if margin < -1e-9:
                violations.append({"id":c["id"],"kind":"max_flow","actual":r["flow_m3_s"],"required":c["max_flow"],"violation":-margin/max(abs(c["max_flow"]),1e-6)})
    return violations


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
