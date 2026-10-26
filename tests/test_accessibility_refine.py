"""T-009: after a feasible point is found, adjust as little as possible (local) and round to a settable step."""
import pytest
from openhydronet.analysis import accessibility, check_request, run_request
from test_accessibility_request import DESIGN, request
from test_analysis_jobs import example

# T2 flow is nearly proportional to pump speed here (pump curve a0 + a2·Q², no static head; Haaland friction
# varies slightly with Re): T2 = 13.679 m³/h at speed 1, and 14.4 m³/h needs speed ≈ 1.0514.
VARS = [dict(id='PU1', field='speed', lower=.6, upper=1.3),
        dict(id='V1', field='opening', lower=.1, upper=1),
        dict(id='V2', field='opening', lower=.1, upper=1)]


def values(changes):
    return {c['id']: c['value'] for c in changes}


def test_min_change_then_rounding_away_from_current_value():
    r = run_request(request(DESIGN, variables=VARS))
    assert r['conclusion'] == 'feasible_point_found' and r['objective'] == 'min_change_local'
    assert values(r['first_feasible_changes'])['PU1'] > 1.1          # the plain feasibility search overshoots
    assert 1.050 < values(r['unrounded_changes'])['PU1'] < 1.053     # pulled back towards the current value
    assert values(r['changes']) == {'PU1': 1.06, 'V1': 1.0, 'V2': 1.0}  # 1.05 fails, 1.06 is the settable value
    assert r['rounding']['status'] == 'rounded_feasible' and r['rounding']['steps'] == [.01, .01, .01]
    assert r['violations'] == [] and all(c['satisfied'] for c in r['checks'])
    assert r['result']['edges']['T2']['flow_m3_s'] >= .004   # result belongs to the final, rounded point
    assert r['evaluations'] <= r['max_evaluations']


def test_nearest_rounding_is_used_when_it_satisfies():
    r = run_request(request([dict(id='T2', min_flow=14.3 / 3600)], variables=VARS[:1]))
    assert values(r['changes']) == {'PU1': 1.05} and r['rounding']['status'] == 'rounded_feasible'


def test_rounding_that_breaks_a_constraint_is_reported_and_unrounded_value_kept():
    tight = [dict(VARS[0], upper=1.053)]   # 1.06 is outside the bounds, 1.05 is too low
    r = run_request(request(DESIGN, variables=tight))
    assert r['conclusion'] == 'feasible_point_found'
    assert r['rounding']['status'] == 'rounded_infeasible'
    assert values(r['rounding']['rounded_changes']) == {'PU1': 1.05}
    assert r['rounding']['rounded_violations'][0]['id'] == 'T2'
    assert 1.05 < values(r['changes'])['PU1'] <= 1.053 and r['violations'] == []


def test_already_feasible_point_needs_no_adjustment():
    r = run_request(request([dict(id='T1', min_flow=.004)], variables=VARS))
    assert values(r['changes']) == {'PU1': 1.0, 'V1': 1.0, 'V2': 1.0}
    assert r['rounding']['status'] == 'exact'


def test_budget_shortage_during_refinement_still_returns_a_feasible_point():
    first = accessibility(example(), DESIGN, [dict(v, step=.01) for v in VARS])
    budget = len(first['first_feasible_changes']) and first['refinement']['started_at'] + 3
    r = accessibility(example(), DESIGN, [dict(v, step=.01) for v in VARS], max_evaluations=budget)
    assert r['conclusion'] == 'feasible_point_found' and r['budget_exhausted'] is True
    assert r['violations'] == [] and r['evaluations'] == budget


def test_historic_api_without_steps_does_not_round():
    r = accessibility(example(), DESIGN, VARS)
    assert r['rounding']['status'] == 'skipped' and r['changes'] == r['unrounded_changes']


@pytest.mark.parametrize('step,message', [(0, '精度'), (-.01, '精度'), (1, '精度'), ('a', '精度')])
def test_invalid_step_rejected(step, message):
    with pytest.raises(ValueError, match=message):
        check_request(request(DESIGN, variables=[dict(VARS[0], step=step)]))


def test_desktop_requests_default_to_a_step_of_one_hundredth():
    assert [v['step'] for v in check_request(request(DESIGN, variables=VARS))['variables']] == [.01] * 3
