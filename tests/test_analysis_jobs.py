"""T-001: analysis request validation, compact scan, CLI progress and analysis jobs."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path
import pytest
from openhydronet.analysis import check_request, run_request
from openhydronet.server import Jobs
from test_analysis import loop

ROOT = Path(__file__).resolve().parents[1]
FLOW = dict(scope='edge', id='load', field='flow_m3_s')


def example():
    return json.loads((ROOT / 'examples/closed-loop.ohn.json').read_text(encoding='utf-8'))['model']


def scan_request(model=None, values=(.5, 1), observables=(FLOW,), var_id='pump', field='speed'):
    return dict(kind='scan', model=model or loop(),
                variables=[dict(id=var_id, field=field, values=list(values))],
                observables=list(observables))


def test_compact_scan_returns_observables_only_and_reports_progress():
    calls = []
    r = run_request(scan_request(), progress=lambda done, total: calls.append((done, total)))
    assert r['analysis'] == 'independent_steady_scan' and r['kind'] == 'scan'
    assert r['observables'] == [FLOW] and len(r['base_input_hash']) > 8
    assert r['fluid']['density_kg_m3'] > 990  # mass-unit display uses the kernel's own density
    assert [set(x) for x in r['records']] == [{'changes', 'status', 'values', 'issues'}] * 2
    flows = [x['values'][0] for x in r['records']]
    assert flows[1] / flows[0] == pytest.approx(2, rel=1e-5)
    assert calls == [(1, 2), (2, 2)]


def test_node_observable_and_missing_values():
    m = loop()
    r = run_request(scan_request(m, observables=[dict(scope='node', id='a', field='head_m'),
                                                 dict(scope='edge', id='pump', field='velocity_m_s')]))
    head, velocity = r['records'][0]['values']
    assert isinstance(head, float) and velocity is None


@pytest.mark.parametrize('change,message', [
    (dict(field='diameter'), '仅限'),
    (dict(var_id='nope'), '不存在'),
    (dict(values=[]), '取值'),
    (dict(values=[float('nan')]), '有限'),
    (dict(values=[2.5]), '范围'),
    (dict(values=[i / 1000 for i in range(1001)]), '1000'),
    (dict(observables=[dict(scope='edge', id='nope', field='flow_m3_s')]), '观测量'),
    (dict(observables=[dict(scope='edge', id='load', field='secret')]), '观测量'),
    (dict(observables=[]), '观测量'),
])
def test_invalid_scan_requests_are_rejected_in_chinese(change, message):
    with pytest.raises(ValueError, match=message):
        check_request(scan_request(**change))


def test_unknown_kind_rejected():
    with pytest.raises(ValueError, match='分析类型'):
        check_request(dict(kind='optimize', model=loop()))


def test_scan_point_with_closed_valve_reports_status_not_crash():
    m = example()
    r = run_request(scan_request(m, values=[0, 1], var_id='V2', field='opening',
                                 observables=[dict(scope='edge', id='T2', field='flow_m3_s')]))
    statuses = [x['status'] for x in r['records']]
    assert len(statuses) == 2 and statuses[1] in ('converged', 'demand_unsatisfied')
    assert dict(code='TERMINAL_DEMAND', object_id='T2') in r['records'][1]['issues']


def test_cli_analyze_streams_progress_and_prints_result():
    req = scan_request(values=[.5, .75, 1])
    env = {**os.environ, 'PYTHONPATH': str(ROOT / 'src'), 'PYTHONIOENCODING': 'utf-8'}
    p = subprocess.run([sys.executable, '-m', 'openhydronet.cli', 'analyze', '-'], input=json.dumps(req),
                       capture_output=True, text=True, encoding='utf-8', env=env, timeout=60)
    assert p.returncode == 0, p.stderr
    lines = [json.loads(x) for x in p.stderr.splitlines() if x.strip()]
    assert [x['progress'] for x in lines] == [dict(done=i, total=3) for i in (1, 2, 3)]
    assert len(json.loads(p.stdout)['records']) == 3


def wait(jobs, key, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        with jobs.lock:
            job = jobs.public(jobs.items[key])
        if job['status'] != 'running':
            return job
        time.sleep(.05)
    raise AssertionError('analysis job did not finish')


def test_analysis_job_completes_with_progress_and_owner():
    jobs = Jobs()
    try:
        job = jobs.start_analysis(scan_request(values=[.5, 1]), 'owner-a')
        assert job['kind'] == 'analysis' and job['progress'] == dict(done=0, total=2)
        done = wait(jobs, job['id'])
        assert done['status'] == 'completed', done
        assert done['progress'] == dict(done=2, total=2)
        assert done['result']['request_owner'] == 'owner-a' and len(done['result']['records']) == 2
    finally:
        jobs.shutdown()


def test_analysis_job_rejects_invalid_request_before_spawning():
    jobs = Jobs()
    try:
        with pytest.raises(ValueError, match='仅限'):
            jobs.start_analysis(scan_request(field='diameter'), 'o')
        assert jobs.items == {}
    finally:
        jobs.shutdown()


def test_analysis_job_cancel_timeout_and_shared_limit():
    big = scan_request(example(), values=[.5 + i / 1000 for i in range(1000)],
                       var_id='PU1', observables=[dict(scope='edge', id='T2', field='flow_m3_s')])
    jobs = Jobs()
    try:
        a = jobs.start_analysis(big, 'a')
        b = jobs.start(example(), 'b')
        with pytest.raises(ValueError, match='两个'):
            jobs.start_analysis(big, 'c')
        stopped = jobs.cancel(a['id'])
        assert stopped['status'] == 'cancelled' and stopped['process_stopped']
        wait(jobs, b['id'])
        jobs.analysis_timeout = .3
        t = wait(jobs, jobs.start_analysis(big, 'd')['id'])
        assert t['status'] == 'timeout' and '300' not in t['error']
    finally:
        jobs.shutdown()
    assert all(j['process'].poll() is not None for j in jobs.items.values())


def test_two_parameter_scan_is_cartesian_with_first_parameter_outer():
    m = example()
    r = run_request(dict(kind='scan', model=m,
                         variables=[dict(id='PU1', field='speed', values=[.8, 1, 1.2]),
                                    dict(id='V2', field='opening', values=[.5, 1])],
                         observables=[dict(scope='edge', id='T2', field='flow_m3_s')]))
    assert [[c['value'] for c in x['changes']] for x in r['records']] == [
        [.8, .5], [.8, 1], [1, .5], [1, 1], [1.2, .5], [1.2, 1]]
    t2 = [x['values'][0] for x in r['records']]
    assert t2[1] > t2[0] and t2[3] > t2[2]  # opening V2 raises T2 at each speed
    assert t2[3] * 3600 == pytest.approx(13.679, abs=1e-3)


def test_two_parameter_scan_point_limit_uses_the_product():
    with pytest.raises(ValueError, match='1000'):
        check_request(dict(kind='scan', model=example(),
                           variables=[dict(id='PU1', field='speed', values=[1 + i / 1000 for i in range(40)]),
                                      dict(id='V2', field='opening', values=[i / 30 for i in range(30)])],
                           observables=[dict(scope='edge', id='T2', field='flow_m3_s')]))
