"""Steady incompressible network solver, independent of UI and file format."""
from __future__ import annotations
import hashlib
import json
import math
import time
import warnings as numerical_warnings
from datetime import datetime, timezone
import numpy as np
from scipy.optimize import least_squares
from scipy.sparse import coo_matrix, diags
from scipy.sparse.linalg import spsolve, MatrixRankWarning
from .physics import G, water, loss, pump_head
from .validation import validate, ModelError, active_edge

ALGORITHM = "sparse-head-flow-newton-trf-v2"
from .version import VERSION
MASS_TOL = 1e-8
HEAD_TOL = 1e-5


def model_hash(model):
    return hashlib.sha256(json.dumps(model, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def solve(model, *, max_nfev=600, timeout=30.0):
    """Solve SI model without mutation. Throws ModelError for invalid topology/input.

    H = z + p_g/(rho*g). A positive nodal demand removes fluid.
    Result statuses: converged, demand_unsatisfied, boundary_conflict,
    numerical_failure, timeout. Local failure is NOT proof of infeasibility.
    """
    if isinstance(max_nfev, bool) or not isinstance(max_nfev, (int, np.integer)) or max_nfev < 1:
        raise ValueError('max_nfev 必须是正整数')
    start = time.perf_counter()
    issues = validate(model)
    if issues:
        raise ModelError(issues)
    nodes = model["nodes"]
    all_edges = model["edges"]
    edges = [e for e in all_edges if active_edge(e)]
    rho, nu = water(model.get("fluid", {}).get("temperature", 20))
    unknown_nodes = [n for n in nodes if n.get("head") is None]
    hi = {n["id"]: i for i, n in enumerate(unknown_nodes)}
    fixed = {n["id"]: n["head"] for n in nodes if n.get("head") is not None}
    ni = {n["id"]: n for n in nodes}
    nh, nq = len(hi), len(edges)
    # Scaling is numerical only and does not alter the physical input.
    qs = max([.001] + [abs(n.get("demand", 0)) for n in nodes] + [e.get("design_flow", e.get("set_flow", 0)) for e in edges])
    hs = max(10.0, np.ptp(list(fixed.values())) if len(fixed) > 1 else 10.0,
             max([0] + [abs(e.get("curve", [25])[0]) * e.get("speed", 1)**2 for e in edges if e["kind"] == "pump"]))
    def unpack(x):
        heads = {**fixed, **{key: float(x[i] * hs) for key, i in hi.items()}}
        return heads, x[nh:] * qs
    def residual(x):
        if time.perf_counter() - start > timeout:
            raise TimeoutError("计算超时；可取消任务并检查边界及设备曲线")
        heads, flows = unpack(x)
        r = np.zeros(nh+nq)
        for n in unknown_nodes:
            r[hi[n["id"]]] = n.get("demand", 0) / qs
        for j, (e, q) in enumerate(zip(edges, flows)):
            s, t = e["source"], e["target"]
            if s in hi:
                r[hi[s]] += q / qs
            if t in hi:
                r[hi[t]] -= q / qs
            dh = heads[s] - heads[t]
            if e["kind"] == "flow_control":
                r[nh+j] = (q - e.get("set_flow", .01)) / qs
            elif e.get("check_valve", e["kind"] == "pump"):
                # Fischer–Burmeister complementarity: Q>=0, downstream surplus>=0.
                a, b = q/qs, (loss(e, q, nu) - dh)/hs
                r[nh+j] = math.hypot(a, b) - a - b
            else:
                r[nh+j] = (dh - loss(e, q, nu)) / hs
        return r
    def jacobian(x):
        # Differentiate only the scalar branch law, not the full network.
        # This is a numerical derivative, NOT a minimum physical flow/resistance.
        heads, flows = unpack(x)
        rr, cc, vv = [], [], []
        for j, (e, q) in enumerate(zip(edges, flows)):
            delta = math.sqrt(np.finfo(float).eps) * max(abs(q), qs*.001)
            slope = (loss(e, q+delta, nu)-loss(e, q-delta, nu))/(2*delta)
            hfactor, qfactor = 1.0, -slope*qs/hs
            if e['kind'] == 'flow_control':
                hfactor, qfactor = 0.0, 1.0
            elif e.get('check_valve', e['kind'] == 'pump'):
                a = q/qs
                b = (loss(e, q, nu)-heads[e['source']]+heads[e['target']])/hs
                radius = math.hypot(a, b)
                da = a/radius-1 if radius else -1.0
                db = b/radius-1 if radius else -1.0
                hfactor, qfactor = -db, da+db*slope*qs/hs
            for node, sign in ((e['source'], 1.0), (e['target'], -1.0)):
                if node in hi:
                    rr.extend((hi[node], nh+j)); cc.extend((nh+j, hi[node]))
                    vv.extend((sign, sign*hfactor))
            rr.append(nh+j); cc.append(nh+j); vv.append(qfactor)
        return coo_matrix((vv, (rr, cc)), shape=(nh+nq, nh+nq)).tocsr()

    def energy_error(e, q, dh):
        if e['kind'] == 'flow_control':
            return abs(q-e.get('set_flow', .01))/qs*hs
        expected = loss(e, q, nu)
        if e.get('check_valve', e['kind'] == 'pump') and q < 1e-9:
            return max(0, dh-expected, -q/qs*hs)
        return abs(dh-expected)

    def acceptable(x, r):
        # Stop by physical residuals, never by an optimizer's success flag.
        heads, flows = unpack(x)
        return (np.max(np.abs(r[:nh]), initial=0)*qs <= MASS_TOL*.01
                and max((energy_error(e, q, heads[e['source']]-heads[e['target']])
                         for e, q in zip(edges, flows)), default=0) <= HEAD_TOL*.01)

    q0 = np.ones(nq)
    for j, e in enumerate(edges):
        if e['source'] in fixed and e['target'] in fixed and e['kind'] not in ('pump', 'flow_control'):
            q0[j] = np.sign(fixed[e['source']] - fixed[e['target']])
    if len(set(fixed.values())) == 1 and not any(n.get('demand',0) for n in nodes) and not any(e['kind'] in ('pump','flow_control') for e in edges):
        q0[:] = 0
    x0 = np.r_[np.full(nh, np.mean(list(fixed.values())) / hs), q0]
    try:
        if nh+nq:
            # A full sparse Newton direction avoids LSMR's truncated/damped
            # direction on high-contrast networks. Equilibration changes only
            # the linear system; line search uses the ORIGINAL residual.
            x, r = x0, residual(x0)
            evaluations = 1
            newton_budget = min(80, max_nfev//2)
            while not acceptable(x, r) and evaluations < newton_budget:
                j = jacobian(x)
                row_scale = 1/np.maximum(abs(j).max(axis=1).toarray().ravel(), 1e-30)
                scaled = diags(row_scale) @ j
                col_scale = 1/np.maximum(abs(scaled).max(axis=0).toarray().ravel(), 1e-30)
                try:
                    with numerical_warnings.catch_warnings():
                        numerical_warnings.simplefilter('error', MatrixRankWarning)
                        step = col_scale*spsolve((scaled @ diags(col_scale)).tocsc(), -r*row_scale)
                except (MatrixRankWarning, RuntimeError, ValueError):
                    break  # Singular local linearization: use TRF, not a fake solution.
                if not np.isfinite(step).all():
                    break
                alpha, norm = 1.0, np.linalg.norm(r)
                accepted = False
                while evaluations < newton_budget and alpha >= 2**-12:
                    candidate = x+alpha*step
                    trial = residual(candidate)
                    evaluations += 1
                    if np.isfinite(trial).all() and (np.linalg.norm(trial) < (1-1e-4*alpha)*norm or acceptable(candidate, trial)):
                        x, r, accepted = candidate, trial, True
                        break
                    alpha *= .5
                if not accepted:
                    break
            termination = 'sparse Newton: physical residual tolerances satisfied'
            if not acceptable(x, r) and evaluations < max_nfev:
                # Dense TRF is deliberately bounded. Large models stay sparse;
                # no unbounded dense null-space or incidence factorization.
                options = dict(tr_solver='exact', jac=lambda v: jacobian(v).toarray()) if nh+nq <= 128 else dict(
                    tr_solver='lsmr', jac=jacobian,
                    tr_options={'atol':1e-12, 'btol':1e-12, 'maxiter':max(100, 2*(nh+nq))})
                opt = least_squares(residual, x, method='trf', x_scale='jac',
                                    ftol=1e-12, xtol=1e-12, gtol=1e-12,
                                    max_nfev=max_nfev-evaluations, **options)
                x = opt.x
                evaluations += int(opt.nfev)
                termination = 'Newton/TRF: '+str(opt.message)
            elif not acceptable(x, r):
                termination = 'evaluation budget exhausted; residuals must be checked'
            heads, flows = unpack(x)
        else:
            heads, flows = fixed, np.array([])
            evaluations, termination = 0, "isolated fixed boundary"
    except TimeoutError as exc:
        return {"status": "timeout", "issues": [{"code": "TIMEOUT", "message": str(exc)}], "input_hash": model_hash(model), "algorithm": ALGORITHM, "version": VERSION}
    balance = {n["id"]: n.get("demand", 0.0) for n in nodes}
    energy_errors = []
    er = {}
    warnings = []
    for e, q0 in zip(edges, flows):
        q = float(q0)
        # A near-zero complementarity solution is kept as computed, not clamped.
        s, t = e["source"], e["target"]
        balance[s] += q
        balance[t] -= q
        dh = heads[s] - heads[t]
        err = energy_error(e, q, dh)
        energy_errors.append(err)
        result = {"flow_m3_s": q, "flow_m3_h": q*3600, "mass_flow_kg_h": q*rho*3600,
                  "head_drop_m": float(dh), "pressure_drop_pa": float(dh*rho*G),
                  "energy_residual_m": float(err), "state": "closed_check" if q < 1e-9 and e.get("check_valve", e["kind"]=="pump") else "open"}
        if e["kind"] == "pipe":
            result["velocity_m_s"] = q / (math.pi*e.get("diameter", .1)**2/4)
            result["reynolds"] = abs(result["velocity_m_s"])*e.get("diameter", .1)/nu
            if abs(result["velocity_m_s"]) > 3:
                warnings.append(dict(code="HIGH_VELOCITY", object_id=e["id"], message="流速超过示例检查阈值 3 m/s；不是统一设计规范限值", severity="warning"))
        if e["kind"] == "pump":
            gain = pump_head(e, q)
            result["pump_head_m"] = gain
            result["hydraulic_power_w"] = float(rho*G*max(0, q*gain))
            result["input_power_w"] = result["hydraulic_power_w"]/e["efficiency"] if e.get("efficiency") else None
            if e.get("valid_flow"):
                per_pump = q/(e.get("speed",1)*e.get("parallel",1))
                if not e["valid_flow"][0] <= per_pump <= e["valid_flow"][1]:
                    warnings.append(dict(code="PUMP_EXTRAPOLATION", object_id=e["id"], message="工作点超出泵拟合数据范围，属于外推", severity="warning"))
            if gain < 0:
                warnings.append(dict(code="NEGATIVE_PUMP_HEAD", object_id=e["id"], message="泵处于负扬程曲线外推区；不得用于设备选型", severity="warning"))
        er[e["id"]] = result
    for e in all_edges:
        if e["id"] not in er:
            er[e["id"]] = {"flow_m3_s": 0.0, "flow_m3_h": 0.0, "mass_flow_kg_h": 0.0,
                           "head_drop_m": float(heads[e["source"]]-heads[e["target"]]), "state": "closed"}
    mass_error = max([0.0] + [abs(balance[n["id"]]) for n in unknown_nodes])
    head_error = max([0.0] + energy_errors)
    status = "converged" if mass_error <= MASS_TOL and head_error <= HEAD_TOL else "numerical_failure"
    if status == "numerical_failure":
        # Only directly prescribed ideal constant-head pumps provide this proof.
        conflicts = [e for e in edges if e["kind"] == "pump" and len(e.get("curve",[]))==1
                     and not e.get("check_valve", True) and e["source"] in fixed and e["target"] in fixed
                     and abs(fixed[e["target"]]-fixed[e["source"]]-pump_head(e,0)) > HEAD_TOL]
        if conflicts:
            status = "boundary_conflict"
            warnings += [dict(code="BOUNDARY_CONFLICT", object_id=e["id"], message="两端定压差与理想恒扬程泵矛盾", severity="error") for e in conflicts]
        else:
            warnings.append(dict(code="RESIDUAL", object_id=None, message="残差未达标；这是数值失败，不是全局无解证明", severity="error"))
    nr = {}
    temp = model.get("fluid", {}).get("temperature",20)
    # Antoine saturation approximation for water 1–100°C, only a screening aid.
    pv = 133.322368*10**(8.07131 - 1730.63/(233.426+max(1,temp)))
    for n in nodes:
        h = heads[n["id"]]
        p = (h-n.get("elevation",0))*rho*G
        absolute = p+model.get("fluid",{}).get("atmospheric_pressure",101325)
        nr[n["id"]] = {"head_m": float(h), "pressure_pa_gauge": float(p), "pressure_pa_absolute": float(absolute),
                         "elevation_m": n.get("elevation",0), "boundary_supply_m3_s": float(balance[n["id"]]) if n["id"] in fixed else None,
                         "mass_residual_m3_s": float(balance[n["id"]]) if n["id"] not in fixed else 0}
        if absolute <= pv:
            warnings.append(dict(code="VAPOUR_SCREEN", object_id=n["id"], message="绝压低于近似饱和压力：单相液态假设失效。此检查不代替泵 NPSH 校核", severity="warning"))
    unsatisfied = []
    if status == "converged":
        for e in edges:
            r = er[e["id"]]
            if e["kind"] == "terminal" and (r["flow_m3_s"] < e.get("design_flow",.01)*(1-e.get("demand_tolerance",.05))):
                unsatisfied.append(dict(code="TERMINAL_DEMAND", object_id=e["id"], message="末端流量低于设计需求，固定工况不满足", severity="warning"))
            if e["kind"] == "flow_control" and r["head_drop_m"] < e.get("min_head",0)-HEAD_TOL:
                unsatisfied.append(dict(code="CONTROL_HEAD", object_id=e["id"], message="理想流控所需压差不足；不能将强制流量当作真实可用工作点", severity="error"))
        if any(i["code"]=="CONTROL_HEAD" for i in unsatisfied):
            status = "demand_unsatisfied"
    return {"status": status, "nodes": nr, "edges": er, "issues": warnings+unsatisfied,
            "residuals": {"mass_m3_s": float(mass_error), "energy_m": float(head_error), "mass_tolerance_m3_s": MASS_TOL, "energy_tolerance_m": HEAD_TOL},
            "fluid": {"density_kg_m3": rho, "kinematic_viscosity_m2_s": nu, "temperature_c": temp},
            "iterations": evaluations, "termination": termination, "elapsed_s": time.perf_counter()-start,
            "algorithm": ALGORITHM, "version": VERSION, "input_hash": model_hash(model),
            "calculated_at": datetime.now(timezone.utc).isoformat(), "assumptions": ["稳态不可压单相液态水", "节点压力采用表压，H=z+p/(rho*g)", "不含水锤、CFD 或时间状态"]}
