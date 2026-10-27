"""Public result exports. Formulas/inputs/provenance retained in HTML report."""
import csv
import html
import io
import json

COLUMNS = [("id","设备 ID"),("name","名称"),("kind","类型"),("flow_m3_h","流量 [m³/h]"),("mass_flow_kg_h","质量流量 [kg/h]"),("velocity_m_s","流速 [m/s]"),("head_drop_m","测压水头差 [m]"),("hydraulic_power_w","水力功率 [W]"),("input_power_w","估算输入功率 [W]")]


def rows(model,result):
    for e in model["edges"]:
        yield {**{k:e.get(k,"") for k in ("id","name","kind")},**result["edges"].get(e["id"],{})}


def result_csv(model,result):
    f=io.StringIO();writer=csv.writer(f);writer.writerow([label for _,label in COLUMNS])
    for row in rows(model,result):
        # Prefix formula-leading user labels; do not execute spreadsheet formulas.
        writer.writerow([("'"+str(row.get(k,""))) if isinstance(row.get(k),str) and row[k].startswith(("=","+","-","@","\t","\r")) else row.get(k,"") for k,_ in COLUMNS])
    return '\ufeff'+f.getvalue()


SEVERITY = {"error": "错误", "warning": "警告", "info": "提示"}
STATUS_TEXT = {"converged": "计算通过", "demand_unsatisfied": "控制需求不满足", "numerical_failure": "残差未达标",
               "invalid_model": "模型需修正", "boundary_conflict": "边界冲突", "timeout": "计算超时"}


def _num(value, unit="", digits=7):
    if not isinstance(value, (int, float)) or isinstance(value, bool): return "—"
    text = format(value, f".{digits}g") if abs(value) >= 1e-3 or value == 0 else format(value, ".4g")
    return text + (" " + unit if unit else "")


def assumptions_html(project, result):
    """T-020 (W4-03): fluid, residuals/tolerances, assumptions and issues as Chinese tables (no raw JSON)."""
    esc = lambda s: html.escape(str(s))
    fluid, res = result.get("fluid") or {}, result.get("residuals") or {}
    rows = [("水温", _num(fluid.get("temperature_c"), "℃")), ("密度", _num(fluid.get("density_kg_m3"), "kg/m³")),
            ("运动黏度", _num(fluid.get("kinematic_viscosity_m2_s"), "m²/s")),
            ("质量残差", _num(res.get("mass_m3_s"), "m³/s")), ("质量容差", _num(res.get("mass_tolerance_m3_s"), "m³/s")),
            ("能量残差", _num(res.get("energy_m"), "m")), ("能量容差", _num(res.get("energy_tolerance_m"), "m")),
            ("迭代次数", result.get("iterations", "—"))]
    out = '<table class="kv"><tbody>' + "".join(f"<tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>" for k, v in rows) + "</tbody></table>"
    out += "<h3>模型假设</h3><ul>" + "".join(f"<li>{esc(a)}</li>" for a in result.get("assumptions") or []) + "</ul>"
    names = {x["id"]: x.get("name") or x["id"] for x in project["model"]["nodes"] + project["model"]["edges"]}
    issues = result.get("issues") or []
    out += "<h3>问题列表</h3>"
    if issues:
        out += "<table><thead><tr><th>级别</th><th>对象</th><th>说明</th></tr></thead><tbody>" + "".join(
            f"<tr><td>{esc(SEVERITY.get(i.get('severity'), i.get('severity', '')))}</td>"
            f"<td>{esc(names.get(i.get('object_id'), i.get('object_id') or '全网'))}</td><td>{esc(i.get('message', ''))}</td></tr>"
            for i in issues) + "</tbody></table>"
    else:
        out += "<p>无</p>"
    return out


def report_html(project,result):
    esc=lambda s:html.escape(str(s))
    table='<table><thead><tr>'+''.join('<th>'+esc(label)+'</th>' for _,label in COLUMNS)+'</tr></thead><tbody>'
    for row in rows(project["model"],result):
        table+='<tr>'+''.join('<td>'+esc('—' if row.get(k) is None or row.get(k)=='' else format(row[k],'.7g') if isinstance(row[k],(int,float)) else row[k])+'</td>' for k,_ in COLUMNS)+'</tr>'
    table+='</tbody></table>'
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OpenHydroNet 计算报告</title><style>body{font-family:system-ui,sans-serif;margin:30px;color:#172b40}table{border-collapse:collapse;font-size:11px;width:100%;margin-bottom:10px}table.kv{width:auto}table.kv th{text-align:left;font-weight:normal;color:#4a6274;padding-right:18px}h3{font-size:13px;margin:12px 0 4px}th,td{border:1px solid #c8d2df;padding:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px}h2{break-before:auto}@media print{body{margin:0}tr{break-inside:avoid}}</style><h1>'+esc(project.get('name','未命名工程'))+' · 计算报告</h1><p>OpenHydroNet '+esc(result.get('version'))+' | '+esc(result.get('calculated_at'))+'</p><p>状态：'+esc(STATUS_TEXT.get(result.get('status'),'')+'（'+str(result.get('status'))+'）')+'；算法：'+esc(result.get('algorithm'))+'</p><p>物理输入 SHA-256：'+esc(result.get('input_hash'))+'</p><h2>假设和验证</h2>'+assumptions_html(project,result)+'<h2>支路结果</h2>'+table+'<p>无效率数据时不提供输入功率；水力功率不等于整机电功率。压力水头不等于总水头。</p><h2>完整输入（SI）</h2><pre>'+esc(json.dumps(project['model'],ensure_ascii=False,indent=2))+'</pre></html>'
