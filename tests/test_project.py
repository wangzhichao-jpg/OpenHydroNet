import json
import subprocess
import sys
from pathlib import Path
import pytest
from openhydronet.project import save_project,load_project,ProjectError,migrate
from openhydronet.export import result_csv,report_html
from openhydronet import solve

ROOT=Path(__file__).resolve().parents[1]


def test_project_roundtrip_and_no_tmp(tmp_path):
    p=load_project(ROOT/'examples/closed-loop.ohn.json')
    out=tmp_path/'中文工程.ohn.json';save_project(out,p)
    assert load_project(out)==p
    assert len(list(tmp_path.iterdir()))==1
    assert migrate(p)==p


def test_unknown_version_rejected(tmp_path):
    p=load_project(ROOT/'examples/closed-loop.ohn.json');p['schema_version']=99
    with pytest.raises(ProjectError,match='版本'):save_project(tmp_path/'x',p)


def test_nonfinite_save_rejected(tmp_path):
    p=load_project(ROOT/'examples/closed-loop.ohn.json');p['model']['nodes'][0]['head']=float('nan')
    with pytest.raises(ProjectError):save_project(tmp_path/'x',p)


def test_exports_escape_spreadsheet_html():
    p=load_project(ROOT/'examples/closed-loop.ohn.json');p['model']['edges'][0]['name']='=SUM(1,2)<script>'
    r=solve(p['model']);text=result_csv(p['model'],r)
    assert "'=SUM" in text
    h=report_html(p,r);assert '&lt;script&gt;' in h and '<script>' not in h
    assert r['input_hash'] in h


def test_report_missing_power_is_a_dash_not_python_none():
    import csv
    import io
    p=load_project(ROOT/'examples/closed-loop.ohn.json')
    result=solve(p['model'])
    assert result['edges']['PU1']['input_power_w'] is None
    h=report_html(p,result)
    assert '<td>None</td>' not in h
    assert '<td>—</td>' in h
    # Machine-readable exports keep genuinely missing numbers empty, not a string.
    rows=list(csv.reader(io.StringIO(result_csv(p['model'],result).lstrip('\ufeff'))))
    assert next(row for row in rows[1:] if row[0]=='PU1')[-1]==''
    result['edges']['PU1']['input_power_w']=0.0
    assert '<td>0</td>' in report_html(p,result)
    assert result['input_hash'] in h


def test_cli_end_to_end(tmp_path):
    out=tmp_path/'result.json'
    r=subprocess.run([sys.executable,'-m','openhydronet.cli','solve',str(ROOT/'examples/closed-loop.ohn.json'),'-o',str(out)],capture_output=True,text=True)
    assert r.returncode==0,r.stderr
    assert json.loads(out.read_text())['status']=='converged'


def test_report_assumptions_section_is_a_readable_chinese_table():
    """T-020 (W4-03): no raw JSON in “假设和验证”; values come from the result itself."""
    import re
    from openhydronet import load_project, solve
    p = load_project('examples/closed-loop.ohn.json')
    r = solve(p['model'])
    h = report_html(p, r)
    section = h[h.index('<h2>假设和验证</h2>'):h.index('<h2>支路结果</h2>')]
    for raw in ('"residuals"', '"mass_tolerance_m3_s"', '"density_kg_m3"', '"assumptions"', '<pre>'):
        assert raw not in section, raw
    for label in ('水温', '密度', '运动黏度', '质量残差', '能量残差', '质量容差', '能量容差', '稳态不可压单相液态水',
                  '用户末端 2', '末端流量低于设计需求', '警告'):
        assert label in section, label
    assert '998.2336' in section and '20 ℃' in section
    assert '状态：计算通过（converged）' in h
    assert re.search(r'1\.148e-0?9 m', section), section
    assert '完整输入（SI）' in h and '<pre>' in h[h.index('完整输入（SI）'):]   # full SI input kept as an appendix
