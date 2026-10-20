"""Steady incompressible network solver, independent of UI and file format."""
from __future__ import annotations
import hashlib
import json
import math
import time
from datetime import datetime, timezone
import numpy as np
from scipy.optimize import least_squares
from scipy.sparse import lil_matrix
from .physics import G, water, loss, pump_head
from .validation import validate, ModelError, active_edge

ALGORITHM = "sparse-head-flow-trf-v1"
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
    pattern = lil_matrix((nh + nq, nh + nq), dtype=int)
    for j, e in enumerate(edges):
        for node in (e["source"], e["target"]):
            if node in hi:
                pattern[hi[node], nh+j] = 1
                pattern[nh+j, hi[node]] = 1
        pattern[nh+j, nh+j] = 1
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
    q0 = np.ones(nq)
    for j, e in enumerate(edges):
        if e['source'] in fixed and e['target'] in fixed and e['kind'] not in ('pump', 'flow_control'):
            q0[j] = np.sign(fixed[e['source']] - fixed[e['target']])
    if len(set(fixed.values())) == 1 and not any(n.get('demand',0) for n in nodes) and not any(e['kind'] in ('pump','flow_control') for e in edges):
        q0[:] = 0
    x0 = np.r_[np.full(nh, np.mean(list(fixed.values())) / hs), q0]
    try:
        if nh+nq:
            # SciPy LSMR's 2D trust subspace is undefined for one unknown.
            # Use its mature dense factorization for 1–2 unknowns only.
            sparse_options = dict(jac_sparsity=pattern.tocsr(), tr_solver='lsmr', tr_options={'atol':1e-12,'btol':1e-12}) if nh+nq > 2 else dict(tr_solver='exact')
            opt = least_squares(residual, x0, method="trf", x_scale="jac",
                                ftol=1e-12, xtol=1e-12, gtol=1e-12, max_nfev=max_nfev, **sparse_options)
            heads, flows = unpack(opt.x)
            evaluations = int(opt.nfev)
            termination = str(opt.message)
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
        expected = loss(e, q, nu)
        if e["kind"] == "flow_control":
            err = abs(q-e.get("set_flow", .01)) / qs * hs
        elif e.get("check_valve", e["kind"] == "pump") and q < 1e-9:
            err = max(0, dh-expected, -q/qs*hs)
        else:
            err = abs(dh-expected)
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
