"""T-006: bounded local feasibility search through the desktop request API."""
import pytest
from openhydronet.analysis import accessibility, check_request, run_request
from test_accessibility_request import DESIGN, request
from test_analysis_jobs import example

VARS = [dict(id='PU1', field='speed', lower=.6, upper=1.3),
        dict(id='V1', field='opening', lower=.1, upper=1),
        dict(id='V2', field='opening', lower=.1, upper=1)]


def test_search_finds_documented_pump_speed_and_reports_progress():
    calls = []
    r = run_request(request(DESIGN, variables=VARS), progress=lambda d, t: calls.append((d, t)))
    assert r['mode'] == 'bounded_local_feasibility_search' and r['conclusion'] == 'feasible_point_found'
    assert r['global_guarantee'] is False
    first = next(c['value'] for c in r['first_feasible_changes'] if c['id'] == 'PU1')
    assert 1.12 < first < 1.16  # plain feasibility search; T-009 then pulls it back (see test_accessibility_refine)
    assert all(c['satisfied'] for c in r['checks']) and r['violations'] == []
    assert r['result']['edges']['T2']['flow_m3_s'] >= .004 * (1 - 1e-6)
    assert calls and all(t == r['max_evaluations'] for _, t in calls)
    assert [d for d, _ in calls] == list(range(1, len(calls) + 1)) and len(calls) == r['evaluations']
    assert r['budget_exhausted'] is False


def test_unreachable_target_is_undetermined_with_closest_point_and_bounded_budget():
    r = run_request(request([dict(id='T2', min_flow=.01)], variables=VARS))
    assert r['conclusion'] == 'undetermined' and r['global_guarantee'] is False
    assert r['evaluations'] <= r['max_evaluations'] == 800
    assert r['checks'] and not r['checks'][0]['satisfied']  # closest point found, still not satisfying
    assert r['changes'] is not None


def test_budget_stops_search_and_never_claims_more_than_undetermined():
    r = accessibility(example(), [dict(id='T2', min_flow=.01)], VARS, max_evaluations=7)
    assert r['evaluations'] == 7 and r['budget_exhausted'] is True and r['conclusion'] == 'undetermined'


@pytest.mark.parametrize('variables,message', [
    ([dict(id='P1', field='diameter', lower=.05, upper=.1)], '仅限'),
    ([dict(id='nope', field='speed', lower=.5, upper=1)], '不存在'),
    ([dict(id='PU1', field='speed', lower=1, upper=1)], '上下界'),
    ([dict(id='PU1', field='speed', lower=.5, upper=2.5)], '上下界'),
    ([dict(id='V1', field='opening', lower=-.1, upper=1)], '上下界'),
    ([dict(id='PU1', field='speed', lower='a', upper=1)], '上下界'),
    ([VARS[0], VARS[0]], '重复'),
])
def test_invalid_search_variables_rejected(variables, message):
    with pytest.raises(ValueError, match=message):
        check_request(request(DESIGN, variables=variables))


def test_job_progress_total_is_the_evaluation_budget():
    req = check_request(request(DESIGN, variables=VARS))
    assert req['total'] == 800 and len(req['variables']) == 3
