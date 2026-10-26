"""Hydraulic balancing by the designated-flow method (SPEC-002). Deterministic, not a search.

1. Pair every terminal that has a design flow with the single valve in its series chain.
2. Replace each paired valve by an ideal flow controller at the design flow and solve once: the
   controller's head drop is the head the valve has to burn.
3. Invert the valve characteristic for the opening (linear / equal percentage).
4. Variable speed: bisect the lowest pump speed at which no valve needs to open beyond 1; the valve
   left fully open marks the index circuit. Fixed speed: valves only.
5. Round to the settable step and verify by solving the original model with the new settings.
Verification is a real solve; inverted values are never reported as the achieved flows.
"""
import copy
import math
from collections import defaultdict
from .solver import solve
from .physics import G

USABLE = ("converged", "demand_unsatisfied")
SMALL_OPENING = 0.2          # SPEC-002 D4: below this the valve is likely oversized
BISECTION_STEPS = 30


def pair_balancing_valves(model):
    """Terminals with a design flow → {paired:[{terminal, valve, orientation}], unpaired:[ids], ambiguous:[...]}.

    The series chain of a terminal continues through nodes with exactly two edges, no demand and no fixed
    head. ``orientation`` is +1 when the valve points in the terminal's flow direction, -1 otherwise.
    """
    nodes = {n["id"]: n for n in model["nodes"]}
    adjacent = defaultdict(list)
    for e in model["edges"]:
        adjacent[e["source"]].append(e)
        adjacent[e["target"]].append(e)

    def passthrough(nid):
        n = nodes.get(nid, {})
        return len(adjacent[nid]) == 2 and n.get("head") is None and not n.get("demand")

    def walk(edge, node, forward):
        """Edges after ``edge`` through pass-through nodes; orientation relative to the terminal flow."""
        found, seen = [], {edge["id"]}
        while passthrough(node):
            others = [e for e in adjacent[node] if e["id"] != edge["id"]]
            if len(others) != 1 or others[0]["id"] in seen:
                break
            nxt = others[0]
            seen.add(nxt["id"])
            leaves_node = nxt["source"] == node
            found.append((nxt, 1 if leaves_node == forward else -1))
            node = nxt["target"] if leaves_node else nxt["source"]
            edge = nxt
        return found

    paired, unpaired, ambiguous = [], [], []
    for t in model["edges"]:
        if t["kind"] != "terminal" or not (isinstance(t.get("design_flow"), (int, float)) and t["design_flow"] > 0):
            continue
        chain = walk(t, t["target"], True) + walk(t, t["source"], False)
        valves = sorted((e["id"], o) for e, o in chain if e["kind"] == "valve")
        if len(valves) == 1:
            paired.append(dict(terminal=t["id"], valve=valves[0][0], orientation=valves[0][1]))
        elif not valves:
            unpaired.append(t["id"])
        else:
            ambiguous.append(dict(terminal=t["id"], valves=[v for v, _ in valves]))
    return dict(paired=paired, unpaired=unpaired, ambiguous=ambiguous)


def _kv_loss(q, kv):
    """Head [m] dropped by a valve of flow coefficient ``kv`` [m³/h at 1 bar] at ``q`` [m³/s]."""
    return (3600 * q / kv) ** 2 * 1e5 / (1000 * G)


def _opening_for(valve, q, head):
    """Opening that drops ``head`` at ``q``; status ok / small_opening / needs_more_head / cannot_throttle."""
    kv_max = valve.get("kv", 100)
    if head <= 0:
        return dict(status="needs_more_head", opening_exact=None, required_kv=None,
                    missing_head_m=_kv_loss(q, kv_max) - head)
    kv = 3600 * q / math.sqrt(head * 1000 * G / 1e5)
    if valve.get("characteristic", "linear") == "linear":
        u = kv / kv_max
    else:
        u = 1 + math.log(kv / kv_max) / math.log(valve.get("rangeability", 50))
    out = dict(opening_exact=u, required_kv=kv, missing_head_m=0.0)
    if u > 1 + 1e-9:
        return dict(out, status="needs_more_head", missing_head_m=_kv_loss(q, kv_max) - head)
    if u <= 0:
        return dict(out, status="cannot_throttle")
    return dict(out, status="small_opening" if u < SMALL_OPENING else "ok")


class _Counter:
    def __init__(self, total, progress):
        self.done, self.total, self.progress = 0, total, progress

    def solve(self, model):
        r = solve(model)
        self.done += 1
        if self.progress: self.progress(self.done, self.total)
        return r


def _required(model, pairs, pump, speed, counter):
    """Head each paired valve must drop at ``speed`` with every paired terminal at its design flow."""
    m = copy.deepcopy(model)
    edges = {e["id"]: e for e in m["edges"]}
    if pump: edges[pump]["speed"] = speed
    for p in pairs:
        v = edges[p["valve"]]
        v["kind"], v["set_flow"], v["min_head"] = "flow_control", edges[p["terminal"]]["design_flow"], 0
        if p["orientation"] < 0:       # controllers take a positive set flow: point them along the flow
            v["source"], v["target"] = v["target"], v["source"]
    r = counter.solve(m)
    if r["status"] not in USABLE:
        return r["status"], None
    original = {e["id"]: e for e in model["edges"]}
    out = {}
    for p in pairs:
        q = original[p["terminal"]]["design_flow"]
        head = r["edges"][p["valve"]]["head_drop_m"]
        out[p["terminal"]] = dict(_opening_for(original[p["valve"]], q, head), valve_head_m=head)
    return r["status"], out


def _round_opening(u, step):
    if step is None: return u
    return min(1.0, max(step, round(round(u / step) * step, 10)))


def _snapshot(result, pump, terminals):
    if result is None or result.get("status") not in USABLE:
        return None
    p = result["edges"].get(pump) if pump else None
    return {"status": result["status"],
            "pump": p and {"speed": None, "head_m": p.get("pump_head_m"), "flow_m3_s": p["flow_m3_s"],
                           "hydraulic_power_w": p.get("hydraulic_power_w")},
            "terminals": {t: {"flow_m3_s": result["edges"][t]["flow_m3_s"]} for t in terminals}}


def balance(model, *, mode="variable", pump=None, lower=0.5, upper=1.5, speed=None, step=0.01, tolerance=0.05,
            progress=None):
    """Balance ``model`` (not mutated). ``mode``: 'variable' (lowest pump speed) or 'fixed' (valves only)."""
    model = copy.deepcopy(model)
    edges = {e["id"]: e for e in model["edges"]}
    pumps = [e["id"] for e in model["edges"] if e["kind"] == "pump"]
    if pump is None and len(pumps) == 1: pump = pumps[0]
    pairing = pair_balancing_valves(model)
    pairs = pairing["paired"]
    terminals = [p["terminal"] for p in pairs] + pairing["unpaired"]
    current = float(edges[pump].get("speed", 1)) if pump else None
    counter = _Counter(3 + (2 + BISECTION_STEPS if mode == "variable" else 0), progress)
    before = _snapshot(counter.solve(model), pump, terminals)
    if before and before["pump"]: before["pump"]["speed"] = current
    out = dict(analysis="designated_flow_balancing", mode=mode, pump=pump, tolerance=tolerance, step=step,
               ambiguous=pairing["ambiguous"], before=before, after=None, index_terminal=None)

    def needs_more(state):
        return state is None or any(x["status"] == "needs_more_head" for x in state.values())

    bisected = False
    if mode == "fixed":
        exact = final = speed if speed is not None else current
        _, state = _required(model, pairs, pump, exact, counter)
    else:
        _, state = _required(model, pairs, pump, upper, counter)
        if needs_more(state):
            exact = final = upper
            if state:   # report the circuit that falls shortest
                out["index_terminal"] = max(state, key=lambda t: state[t]["missing_head_m"] or 0)
        else:
            _, low_state = _required(model, pairs, pump, lower, counter)
            if not needs_more(low_state):
                exact, state = lower, low_state
            else:
                lo, hi, hi_state = lower, upper, state
                for _ in range(BISECTION_STEPS):
                    mid = (lo + hi) / 2
                    _, st = _required(model, pairs, pump, mid, counter)
                    if needs_more(st): lo = mid
                    else: hi, hi_state = mid, st
                exact, state, bisected = hi, hi_state, True
            final = round(min(upper, math.ceil(exact / step - 1e-9) * step) if step else exact, 10)
            # The index circuit is the valve left (closest to) fully open at the lowest speed. Only a
            # bisected speed sits on that boundary; at the lower bound every valve still has reserve.
            if bisected:
                out["index_terminal"] = max(state, key=lambda t: state[t]["opening_exact"] or 0)
            if final != exact:
                _, state = _required(model, pairs, pump, final, counter)
    out["speed"] = dict(before=current, exact=exact, balanced=final)
    rows = []
    for p in pairs:
        s = (state or {}).get(p["terminal"], dict(status="unsolved", opening_exact=None, required_kv=None,
                                                    missing_head_m=None, valve_head_m=None))
        opening = None
        if s["status"] in ("ok", "small_opening"):
            index = bisected and p["terminal"] == out["index_terminal"]
            opening = 1.0 if index else _round_opening(s["opening_exact"], step)
        rows.append(dict(p, design_flow_m3_s=edges[p["terminal"]]["design_flow"], opening=opening, **s))
    out["pairs"] = rows
    if state is None or any(r["opening"] is None for r in rows):
        out.update(conclusion="not_achievable", unpaired=[dict(terminal=t, verified_flow_m3_s=None)
                                                          for t in pairing["unpaired"]])
        return out
    applied = copy.deepcopy(model)
    applied_edges = {e["id"]: e for e in applied["edges"]}
    if pump: applied_edges[pump]["speed"] = final
    for r in rows: applied_edges[r["valve"]]["opening"] = r["opening"]
    verify = counter.solve(applied)
    after = _snapshot(verify, pump, terminals)
    if after is None:
        out.update(conclusion="verification_failed", unpaired=[])
        return out
    if after["pump"]: after["pump"]["speed"] = final
    for r in rows:
        q = after["terminals"][r["terminal"]]["flow_m3_s"]
        r.update(verified_flow_m3_s=q, deviation=q / r["design_flow_m3_s"] - 1)
    out.update(after=after, changes=[dict(id=pump, field="speed", value=final)] if pump and mode == "variable" else [],
               unpaired=[dict(terminal=t, design_flow_m3_s=edges[t]["design_flow"],
                              verified_flow_m3_s=after["terminals"][t]["flow_m3_s"],
                              deviation=after["terminals"][t]["flow_m3_s"] / edges[t]["design_flow"] - 1)
                         for t in pairing["unpaired"]])
    out["changes"] += [dict(id=r["valve"], field="opening", value=r["opening"]) for r in rows]
    out["result"] = verify
    out["conclusion"] = "balanced" if all(abs(r["deviation"]) <= tolerance for r in rows) else "outside_tolerance"
    return out
