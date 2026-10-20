"""公开公式见 docs/MODELS.md。Q m³/s，H m，压力 Pa，温度 ℃。"""
import math
import numpy as np

G = 9.80665


def water(temperature=20.0):
    if not 0 <= temperature <= 100:
        raise ValueError("水温限 0–100 ℃；本版本不覆盖加压高温水或防冻液")
    t = float(temperature)
    rho = 1000 * (1 - (t + 288.9414) / (508929.2 * (t + 68.12963)) * (t - 3.9863) ** 2)
    mu = 2.414e-5 * 10 ** (247.8 / (t + 133.15))
    return rho, mu / rho


def friction_factor(reynolds, relative_roughness):
    r = abs(reynolds)
    if r == 0:
        return 0.0
    lam = 64 / r
    if r <= 2300:
        return lam
    # Haaland explicit turbulent approximation; transition is a defined blend.
    turb = (-1.8 * math.log10((relative_roughness / 3.7) ** 1.11 + 6.9 / r)) ** -2
    if r >= 4000:
        return turb
    x = (r - 2300) / 1700
    s = x * x * (3 - 2 * x)
    return (1 - s) * lam + s * turb


def pump_head(edge, q):
    speed = edge.get("speed", 1.0)
    count = edge.get("parallel", 1)
    if speed <= 0:
        return 0.0
    return speed ** 2 * float(np.polynomial.polynomial.polyval(q / (count * speed), edge.get("curve", [25, 0, -50000])))


def loss(edge, q, nu):
    kind = edge["kind"]
    if kind == "pump":
        return -pump_head(edge, q)
    if kind in ("resistance", "terminal"):
        r = edge.get("resistance", 1e5) if kind == "resistance" else edge.get("design_head", 10) / edge.get("design_flow", .01) ** 2
        return r * q * abs(q)
    if kind == "valve":
        opening = edge.get("opening", 1)
        if opening <= 0:
            return 0.0  # removed by active_edges, never used to approximate a shut valve
        shape = edge.get("characteristic", "linear")
        fraction = opening if shape == "linear" else edge.get("rangeability", 50) ** (opening - 1)
        kv = edge.get("kv", 100) * fraction
        # Kv: water flow m³/h at 1 bar, head independent of density under this convention.
        return (3600 * q / kv) * abs(3600 * q / kv) * 1e5 / (1000 * G)
    if kind == "flow_control":
        return 0.0
    d = edge.get("diameter", .1)
    length = edge.get("length", 100)
    area = math.pi * d * d / 4
    v = q / area
    re = abs(v) * d / nu
    # Analytic laminar formula at zero avoids a singular f = 64/Re.
    if re <= 2300:
        major = 128 * nu * length * q / (math.pi * G * d ** 4)
    else:
        f = friction_factor(re, edge.get("roughness", .00005) / d)
        major = f * length / d * v * abs(v) / (2 * G)
    if edge.get("local_mode", "zeta") == "ratio":
        return major * (1 + edge.get("local_ratio", 0))
    return major + edge.get("zeta", 0) * v * abs(v) / (2 * G)


def flow_to_si(value, unit, density):
    factors = {"m3/h": 1 / 3600, "m3/s": 1, "L/s": .001, "kg/h": 1 / (3600 * density), "t/h": 1000 / (3600 * density)}
    return value * factors[unit]


def flow_from_si(value, unit, density):
    return value / flow_to_si(1, unit, density)


def fit_pump(flows, heads, degree=2):
    q, h = np.asarray(flows, dtype=float), np.asarray(heads, dtype=float)
    if degree not in (2, 3) or len(q) < degree + 1 or len(q) != len(h):
        raise ValueError("二次拟合至少三点，三次拟合至少四点；流量和扬程长度必须一致")
    if not np.isfinite(q).all() or not np.isfinite(h).all() or np.min(q) < 0 or len(np.unique(q)) != len(q):
        raise ValueError("拟合数据必须有限、流量非负且不重复")
    c = np.polynomial.polynomial.polyfit(q, h, degree)
    rmse = np.sqrt(np.mean((np.polynomial.polynomial.polyval(q, c) - h) ** 2))
    return {"curve": c.tolist(), "rmse_m": float(rmse), "valid_flow": [float(min(q)), float(max(q))], "source": "用户拟合数据，非厂家认证"}
