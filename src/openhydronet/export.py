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


def report_html(project,result):
    esc=lambda s:html.escape(str(s))
    table='<table><thead><tr>'+''.join('<th>'+esc(label)+'</th>' for _,label in COLUMNS)+'</tr></thead><tbody>'
    for row in rows(project["model"],result):
        table+='<tr>'+''.join('<td>'+esc('—' if row.get(k) is None or row.get(k)=='' else format(row[k],'.7g') if isinstance(row[k],(int,float)) else row[k])+'</td>' for k,_ in COLUMNS)+'</tr>'
    table+='</tbody></table>'
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OpenHydroNet 计算报告</title><style>body{font-family:system-ui,sans-serif;margin:30px;color:#172b40}table{border-collapse:collapse;font-size:11px;width:100%}th,td{border:1px solid #c8d2df;padding:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px}h2{break-before:auto}@media print{body{margin:0}tr{break-inside:avoid}}</style><h1>'+esc(project.get('name','未命名工程'))+' · 计算报告</h1><p>OpenHydroNet '+esc(result.get('version'))+' | '+esc(result.get('calculated_at'))+'</p><p>状态：'+esc(result.get('status'))+'；算法：'+esc(result.get('algorithm'))+'</p><p>物理输入 SHA-256：'+esc(result.get('input_hash'))+'</p><h2>假设和验证</h2><pre>'+esc(json.dumps({k:result.get(k) for k in ('assumptions','fluid','residuals','issues')},ensure_ascii=False,indent=2))+'</pre><h2>支路结果</h2>'+table+'<p>无效率数据时不提供输入功率；水力功率不等于整机电功率。压力水头不等于总水头。</p><h2>完整输入（SI）</h2><pre>'+esc(json.dumps(project['model'],ensure_ascii=False,indent=2))+'</pre></html>'
