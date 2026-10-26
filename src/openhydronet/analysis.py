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
MAX_SEARCH_EVALUATIONS = 800
DEFAULT_STEP = 0.01  # settable precision of pump speed and valve opening (SPEC-001 D8)
DEFAULT_DIFF_STEP = 0.005  # finite-difference step for sensitivity (speed ratio / opening fraction)
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


def _is_number(x):
    """A finite real number (bool excluded)."""
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def check_request(request):
    """Validate and normalise a desktop analysis request; raises ValueError with a Chinese message.

    Common fields: {kind, model}; per-kind fields are documented on ``_check_<kind>``. The normalised
    request carries ``total`` = expected number of solves, used for progress.
    """
    checker = {"scan": _check_scan, "sensitivity": _check_sensitivity,
               "accessibility": _check_accessibility, "balance": _check_balance}.get(request.get("kind") if isinstance(request, dict) else None)
    if checker is None:
        raise ValueError("不支持的分析类型")
    model = request.get("model")
    if not isinstance(model, dict) or not isinstance(model.get("edges"), list) or not isinstance(model.get("nodes"), list):
        raise ValueError("分析请求缺少模型")
    return dict(checker(model, request), kind=request["kind"], model=model)


def _check_scan(model, request):
    """scan: variables [{id, field, values}] (1–2, Cartesian, ≤1000 points), observables [{scope, id, field}]."""
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
        if not all(_is_number(x) for x in values):
            raise ValueError("扫描取值必须是有限数值")
        if any(not low <= x <= high for x in values):
            raise ValueError(f"扫描取值超出允许范围 {low}–{high}")
        size *= len(values)
        clean.append(dict(id=v["id"], field=v["field"], values=[float(x) for x in values]))
    if size > MAX_SCAN_POINTS:
        raise ValueError("单批扫描限 1000 点；请拆分批次")
    return dict(variables=clean, observables=_check_observables(model, request.get("observables")), total=size)


def _check_sensitivity(model, request):
    """sensitivity: parameters [{id, field}] (≥1), step (0 < step ≤ 0.1, default 0.005), observables."""
    parameters = request.get("parameters")
    if not isinstance(parameters, list) or not parameters:
        raise ValueError("请至少选择一个参数")
    clean, seen = [], set()
    for p in parameters:
        if not isinstance(p, dict): raise ValueError("参数格式无效")
        _check_adjustable(model, p)
        if (p["id"], p["field"]) in seen: raise ValueError(f"参数重复：{p['id']}")
        seen.add((p["id"], p["field"]))
        clean.append(dict(id=p["id"], field=p["field"]))
    step = request.get("step", DEFAULT_DIFF_STEP)
    if not _is_number(step) or not 0 < step <= .1:
        raise ValueError("差分步长须大于 0 且不超过 0.1")
    return dict(parameters=clean, step=float(step), observables=_check_observables(model, request.get("observables")),
                total=1+2*len(clean))


def _check_balance(model, request):
    """balance (SPEC-002): mode 'variable'|'fixed', pump (variable: the pump whose speed is adjusted),
    lower/upper speed bounds, speed (fixed mode, optional), step (settable precision), tolerance (verification)."""
    mode = request.get("mode", "variable")
    if mode not in ("variable", "fixed"):
        raise ValueError("平衡模式只能是 variable（泵速参与）或 fixed（泵速固定）")
    pumps = [e["id"] for e in model["edges"] if e["kind"] == "pump"]
    pump = request.get("pump")
    if pump is None and len(pumps) == 1:
        pump = pumps[0]
    if pump is not None and pump not in pumps:
        raise ValueError(f"调速对象必须是泵：{pump}")
    if mode == "variable" and pump is None:
        raise ValueError("请选择参与调速的泵")
    lower, upper = request.get("lower", .5), request.get("upper", 1.5)
    if not (_is_number(lower) and _is_number(upper)) or not 0 < lower < upper <= 2:
        raise ValueError("泵速范围无效：须满足 0 < 下限 < 上限 ≤ 2")
    speed = request.get("speed")
    if speed is not None and (not _is_number(speed) or not 0 < speed <= 2):
        raise ValueError("固定泵速须大于 0 且不超过 2")
    step = request.get("step", DEFAULT_STEP)
    if step is not None and (not _is_number(step) or not 0 < step <= .1):
        raise ValueError("设定精度须大于 0 且不超过 0.1")
    tolerance = request.get("tolerance", .05)
    if not _is_number(tolerance) or not 0 < tolerance <= .5:
        raise ValueError("验证容差须大于 0 且不超过 50%")
    from .balancing import BISECTION_STEPS
    return dict(mode=mode, pump=pump, lower=float(lower), upper=float(upper), speed=speed, step=step,
                tolerance=float(tolerance), total=3 + (2 + BISECTION_STEPS if mode == "variable" else 0))


def _check_accessibility(model, request):
    """accessibility: constraints [{id, min_flow|max_flow|min_head}], optional variables [{id, field, lower, upper, step}]."""
    variables = _check_search_variables(model, request.get("variables") or [], DEFAULT_STEP)
    return dict(constraints=_check_constraints(model, request.get("constraints")), variables=variables,
                total=MAX_SEARCH_EVALUATIONS if variables else 1)


def _check_search_variables(model, variables, default_step=None):
    """Adjustable operating parameters with bounds inside their physical limits (SPEC-001 D3).

    ``step`` is the settable precision (SPEC-001 D8); without it the result is not rounded.
    """
    if not isinstance(variables, list):
        raise ValueError("调节量格式无效")
    clean, seen = [], set()
    for v in variables:
        if not isinstance(v, dict):
            raise ValueError("调节量格式无效")
        low, high = _check_adjustable(model, v)
        if (v["id"], v["field"]) in seen:
            raise ValueError(f"调节量重复：{v['id']}")
        seen.add((v["id"], v["field"]))
        lower, upper = v.get("lower"), v.get("upper")
        if not (_is_number(lower) and _is_number(upper)) or not low <= lower < upper <= high:
            raise ValueError(f"{v['id']} 的调节上下界无效：须满足 {low:g} ≤ 下界 < 上界 ≤ {high:g}")
        item = dict(id=v["id"], field=v["field"], lower=float(lower), upper=float(upper))
        step = v.get("step", default_step)
        if step is not None:
            if not _is_number(step) or not 0 < step <= upper - lower:
                raise ValueError(f"{v['id']} 的设定精度无效：须大于 0 且不超过上下界宽度")
            item["step"] = float(step)
        clean.append(item)
    return clean


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
            if not _is_number(value):
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
    return {"scan": _run_scan, "sensitivity": _run_sensitivity, "accessibility": _run_accessibility,
            "balance": _run_balance}[req["kind"]](req, progress)


def _run_balance(req, progress):
    from .balancing import balance
    params = {k: req[k] for k in ("mode", "pump", "lower", "upper", "speed", "step", "tolerance")}
    return dict(balance(req["model"], progress=progress, **params), kind="balance")


def _run_scan(req, progress):
    result = scan(req["model"], req["variables"], req["observables"], progress)
    result.update(kind="scan", variables=req["variables"], observables=req["observables"])
    return result


def _run_sensitivity(req, progress):
    return sensitivity_matrix(req["model"], req["parameters"], req["observables"], req["step"], progress)


def _run_accessibility(req, progress):
    result = accessibility(req["model"], req["constraints"], req["variables"], progress=progress)
    if progress and not req["variables"]: progress(1, 1)
    result.update(kind="accessibility", constraints=req["constraints"], fluid=result["result"].get("fluid"),
                  checks=constraint_checks(result["result"], req["constraints"]))
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


class _BudgetExhausted(Exception):
    pass


def accessibility(model, constraints, variables=None, *, max_iterations=50, max_evaluations=MAX_SEARCH_EVALUATIONS,
                  progress=None):
    """Fixed check or bounded LOCAL feasibility search; never a global no-solution claim.

    The search stops after ``max_evaluations`` solves (``budget_exhausted``); ``progress(done, max_evaluations)``
    is called per solve.
    """
    variables = variables or []
    base = solve(model)
    violations = constraint_violations(base,constraints)
    if not variables:
        return {"mode":"fixed_operating_point", "conclusion":"feasible_at_this_point" if not violations else "not_satisfied_at_this_point", "violations":violations, "result":base, "global_guarantee":False}
    variables=_check_search_variables(model,variables)
    ids={e["id"]:e for e in model["edges"]}
    evaluations = [0]

    def point(x):
        """One counted solve at adjustment vector ``x``; a failed model gives result None."""
        if evaluations[0] >= max_evaluations:
            raise _BudgetExhausted
        evaluations[0] += 1
        changes=[dict(id=v["id"],field=v["field"],value=float(value)) for v,value in zip(variables,x)]
        try:
            r=solve(patched_model(model,changes))
            viol=constraint_violations(r,constraints)
            penalty=sum(c["violation"]**2 for c in viol)
        except ModelError:
            r, viol, penalty = None, None, 1e12
        if progress: progress(evaluations[0], max_evaluations)
        return dict(x=[float(v) for v in x], changes=changes, result=r, violations=viol, penalty=penalty)

    def feasible(p):
        return p["result"] is not None and not p["violations"]

    best = {"penalty":float("inf"), "point":None}
    def evaluate(x):
        p=point(x)
        if p["result"] is not None and p["penalty"] < best["penalty"]:
            best.update(penalty=p["penalty"], point=p)
        return p["penalty"]

    bounds=[(v["lower"],v["upper"]) for v in variables]
    x0=[min(v["upper"],max(v["lower"],ids[v["id"]].get(v["field"],1))) for v in variables]
    exhausted = False
    try:
        evaluate(x0)
        # A deterministic midpoint and upper-bound start reduce, but do not remove,
        # dependence on the local solver. No claim of global optimization is made.
        for start in (x0,[(a+b)/2 for a,b in bounds],[b for a,b in bounds]):
            minimize(evaluate,start,method="Powell",bounds=bounds,options={"maxiter":max_iterations,"xtol":1e-5,"ftol":1e-8})
            if best["point"] and feasible(best["point"]): break
    except _BudgetExhausted:
        exhausted = True
    found = best["point"]
    out = {"mode":"bounded_local_feasibility_search", "global_guarantee":False, "variables":variables,
           "max_evaluations":max_evaluations,
           "note":"局部搜索未找到可行点不代表全局不可行；建议检查最不利末端、扩大真实可用调节范围或复核泵阀数据"}
    if found is None or not feasible(found):
        out.update(conclusion="undetermined", objective="feasibility", first_feasible_changes=None, refinement=None,
                   changes=found and found["changes"], unrounded_changes=found and found["changes"],
                   violations=found["violations"] if found else constraint_violations(base,constraints),
                   result=found["result"] if found else base, rounding={"status":"not_applicable"},
                   evaluations=evaluations[0], budget_exhausted=exhausted)
        return out
    # SPEC-001 D7/D8: adjust as little as possible, then round to the settable step. Every accepted
    # point is re-solved and must satisfy all constraints, so the returned point is always verified.
    state = {"cur": found}
    started = evaluations[0]
    rounding = {"status": "not_verified"}
    try:
        _pull_back(point, feasible, x0, state)
        rounding = _round_to_steps(point, feasible, x0, variables, state)
    except _BudgetExhausted:
        exhausted = True
    final = state.get("final", state["cur"])
    out.update(conclusion="feasible_point_found", objective="min_change_local",
               first_feasible_changes=found["changes"], unrounded_changes=state["cur"]["changes"],
               changes=final["changes"], violations=final["violations"], result=final["result"], rounding=rounding,
               refinement={"started_at":started, "evaluations":evaluations[0]-started},
               evaluations=evaluations[0], budget_exhausted=exhausted)
    return out


def _pull_back(point, feasible, x0, state, line_steps=12, coordinate_steps=10, rounds=2):
    """Move the feasible point ``state['cur']`` back towards the current values ``x0`` while it stays feasible.

    Bisection on the segment x0→cur, then on each coordinate. Local improvement only, not a proven minimum.
    """
    cur = state["cur"]
    if all(abs(a-b) < 1e-12 for a, b in zip(cur["x"], x0)):
        return
    lo, hi, end = 0.0, 1.0, cur["x"]
    for _ in range(line_steps):
        t = (lo+hi)/2
        p = point([a+t*(b-a) for a, b in zip(x0, end)])
        if feasible(p): hi, state["cur"] = t, p
        else: lo = t
    for _ in range(rounds):
        for i in range(len(x0)):
            base = state["cur"]["x"]
            if abs(base[i]-x0[i]) < 1e-12: continue
            lo, hi = 0.0, 1.0
            for _ in range(coordinate_steps):
                s = (lo+hi)/2
                x = list(base); x[i] = x0[i]+s*(base[i]-x0[i])
                p = point(x)
                if feasible(p): hi, state["cur"] = s, p
                else: lo = s


def _round_to_steps(point, feasible, x0, variables, state):
    """Round ``state['cur']`` to each variable's step inside its bounds; verify; set ``state['final']``."""
    steps = [v.get("step") for v in variables]
    if all(s is None for s in steps):
        return {"status": "skipped"}
    cur = state["cur"]["x"]
    def grid(i, value, away):
        step, v = steps[i], variables[i]
        if step is None: return value
        first, last = math.ceil(v["lower"]/step - 1e-9), math.floor(v["upper"]/step + 1e-9)
        if first > last: return value          # no settable value inside the bounds
        k = value/step
        if away and value > x0[i] + 1e-12: k = math.ceil(k - 1e-9)
        elif away and value < x0[i] - 1e-12: k = math.floor(k + 1e-9)
        else: k = round(k)
        return round(min(max(k, first), last)*step, 10)
    candidates = []
    for away in (False, True):
        c = [grid(i, value, away) for i, value in enumerate(cur)]
        if c not in candidates: candidates.append(c)
    info = {"steps": steps}
    if all(abs(a-b) < 1e-12 for a, b in zip(candidates[0], cur)):
        return dict(info, status="exact")
    tried = []
    for c in candidates:
        p = point(c)
        tried.append(p)
        if feasible(p):
            state["final"] = p
            return dict(info, status="rounded_feasible")
    return dict(info, status="rounded_infeasible", rounded_changes=tried[0]["changes"],
                rounded_violations=tried[0]["violations"] or [])


def sensitivity_matrix(model, parameters, observables, step=DEFAULT_DIFF_STEP, progress=None):
    """Finite-difference sensitivity of each observable to each adjustable parameter at the current point.

    Central difference when x±step stays inside the physical limits, otherwise one-sided (``method``).
    Elasticity = dY/dX · X/Y (percent change of Y per percent change of X); None when Y or X is 0.
    A local, linearised statement about this operating point only.
    """
    total, done = 1 + 2*len(parameters), [0]
    usable = ("converged", "demand_unsatisfied")
    def run(changes):
        try:
            r = solve(patched_model(model, changes))
        except ModelError as exc:
            r = {"status": "invalid_model", "issues": exc.issues}
        done[0] += 1
        if progress: progress(done[0], total)
        return r
    base = run([])
    base_values = observe(base, observables) if base["status"] in usable else [None]*len(observables)
    edges = {e["id"]: e for e in model["edges"]}
    rows = []
    for p in parameters:
        low, high = ADJUSTABLE[edges[p["id"]]["kind"]][p["field"]]
        x = float(edges[p["id"]].get(p["field"], 1))
        if low <= x-step and x+step <= high: a, b, method = x-step, x+step, "central"
        elif x+step <= high: a, b, method = x, x+step, "forward"
        else: a, b, method = x-step, x, "backward"
        ra, rb = (run([dict(id=p["id"], field=p["field"], value=v)]) for v in (a, b))
        row = dict(id=p["id"], field=p["field"], value=x, step=step, method=method,
                   point_statuses=[ra["status"], rb["status"]])
        if ra["status"] in usable and rb["status"] in usable and base["status"] in usable:
            ya, yb = observe(ra, observables), observe(rb, observables)
            derivatives = [None if A is None or B is None else (B-A)/(b-a) for A, B in zip(ya, yb)]
            elasticities = [None if d is None or y is None or abs(y) < 1e-12 or x == 0 else d*x/y
                            for d, y in zip(derivatives, base_values)]
            row.update(status="ok", derivatives=derivatives, elasticities=elasticities)
        else:
            row.update(status="undetermined", derivatives=[None]*len(observables), elasticities=[None]*len(observables))
        rows.append(row)
    return {"kind":"sensitivity", "analysis":"finite_difference_sensitivity", "observables":observables,
            "parameters":rows, "base_values":base_values, "base_status":base["status"], "fluid":base.get("fluid"),
            "base_input_hash":model_hash(model)}


def sensitivity(model, edge_id, field, step, observable_edge, observable_field="flow_m3_s"):
    if step <= 0: raise ValueError("差分步长必须为正")
    edge=next((e for e in model["edges"] if e["id"]==edge_id), None)
    if edge is None: raise ValueError(f"参数对象不存在：{edge_id}")
    value=edge[field]
    points=[]
    for offset in (-step,step):
        points.append(solve(patched_model(model,[dict(id=edge_id,field=field,value=value+offset)])))
    if any(r["status"]!="converged" for r in points):
        return {"status":"undetermined","points":points}
    return {"status":"central_difference", "derivative":(points[1]["edges"][observable_edge][observable_field]-points[0]["edges"][observable_edge][observable_field])/(2*step),"step":step,"points":points}
