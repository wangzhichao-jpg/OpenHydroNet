"""T-005: accessibility constraints and fixed operating-point check through the desktop request API."""
import pytest
from openhydronet.analysis import check_request, run_request, constraint_violations
from openhydronet.server import Jobs
from test_analysis import loop
from test_analysis_jobs import example, wait

DESIGN = [dict(id='T1', min_flow=.004), dict(id='T2', min_flow=.004)]


def request(constraints=DESIGN, model=None, **extra):
    return dict(kind='accessibility', model=model or example(), constraints=constraints, **extra)


def test_fixed_check_reports_every_constraint_and_conclusion():
    calls = []
    r = run_request(request(), progress=lambda d, t: calls.append((d, t)))
    assert r['kind'] == 'accessibility' and r['mode'] == 'fixed_operating_point'
    assert r['conclusion'] == 'not_satisfied_at_this_point' and r['global_guarantee'] is False
    checks = {(c['id'], c['kind']): c for c in r['checks']}
    assert set(checks) == {('T1', 'min_flow'), ('T2', 'min_flow')}
    assert checks[('T1', 'min_flow')]['satisfied'] is True and checks[('T1', 'min_flow')]['violation'] == 0
    t2 = checks[('T2', 'min_flow')]
    assert t2['satisfied'] is False and t2['required'] == .004 and t2['actual'] == pytest.approx(13.679 / 3600, rel=1e-3)
    assert [v['id'] for v in r['violations']] == ['T2']
    assert r['result']['edges']['T2']  # full point kept so it can become a scenario later (T-007)
    assert r['fluid']['density_kg_m3'] > 990 and calls == [(1, 1)]


def test_fixed_check_satisfied_and_max_flow_and_min_head():
    r = run_request(request([dict(id='T1', min_flow=.003, max_flow=.005), dict(id='T2', min_head=7)]))
    assert r['conclusion'] == 'feasible_at_this_point' and r['violations'] == []
    assert all(c['satisfied'] for c in r['checks']) and len(r['checks']) == 3
    r = run_request(request([dict(id='T1', max_flow=.004)]))
    assert r['conclusion'] == 'not_satisfied_at_this_point' and r['violations'][0]['kind'] == 'max_flow'


def test_checks_and_violations_agree_with_historic_api():
    from openhydronet import solve
    m = loop()
    res = solve(m)
    cs = [dict(id='load', min_flow=.1), dict(id='load', max_flow=1)]
    assert constraint_violations(res, cs) == [
        {k: v for k, v in c.items() if k != 'satisfied'}
        for c in run_request(request(cs, m))['checks'] if not c['satisfied']]


@pytest.mark.parametrize('constraints,message', [
    ([], '约束'),
    ([dict(id='nope', min_flow=.1)], '不存在'),
    ([dict(id='s1', min_flow=.1)], '不存在'),           # nodes are not constraint targets
    ([dict(id='T1')], '约束'),
    ([dict(id='T1', min_flow=float('inf'))], '有限'),
    ([dict(id='T1', min_flow='1')], '有限'),
    ([dict(id='T1', min_flow=-.1)], '负'),
    ([dict(id='T1', min_flow=.1), dict(id='T1', min_flow=.2)], '重复'),
    ([dict(id='T1', min_flow=.2, max_flow=.1)], '下限'),
    ([dict(id='T1', min_flow=.1, secret=1)], '约束'),
])
def test_invalid_constraints_rejected_in_chinese(constraints, message):
    with pytest.raises(ValueError, match=message):
        check_request(request(constraints))


def test_fixed_check_runs_as_analysis_job():
    jobs = Jobs()
    try:
        job = jobs.start_analysis(request(), 'owner')
        assert job['progress'] == dict(done=0, total=1)
        done = wait(jobs, job['id'])
        assert done['status'] == 'completed', done
        assert done['result']['conclusion'] == 'not_satisfied_at_this_point'
    finally:
        jobs.shutdown()


def test_invalid_model_fails_with_one_chinese_line_not_a_traceback():
    m = example()
    m['nodes'] = [n for n in m['nodes'] if n['id'] != 's2']  # dangling edges
    jobs = Jobs()
    try:
        done = wait(jobs, jobs.start_analysis(request(model=m), 'o')['id'])
        assert done['status'] == 'failed' and done['error'].startswith('模型检查未通过'), done
        assert 'Traceback' not in done['error']
    finally:
        jobs.shutdown()
