"""T-004: sensitivity matrix (adjustable parameters × observables) through the desktop request API."""
import math
import pytest
from openhydronet.analysis import check_request, run_request, sensitivity
from test_analysis import loop
from test_analysis_jobs import example

T2 = dict(scope='edge', id='T2', field='flow_m3_s')
T1 = dict(scope='edge', id='T1', field='flow_m3_s')
PARAMS = [dict(id='PU1', field='speed'), dict(id='V1', field='opening'), dict(id='V2', field='opening')]


def request(parameters=PARAMS, observables=(T1, T2), model=None, **extra):
    return dict(kind='sensitivity', model=model or example(), parameters=list(parameters),
                observables=list(observables), **extra)


def test_matches_exact_derivative_and_unit_elasticity_on_analytic_loop():
    # Q = n·sqrt(36/300000): dQ/dn is that constant and the elasticity is exactly 1.
    r = run_request(request([dict(id='pump', field='speed')], [dict(scope='edge', id='load', field='flow_m3_s')], loop()))
    p = r['parameters'][0]
    assert p['method'] == 'central' and p['status'] == 'ok'
    assert p['derivatives'][0] == pytest.approx(math.sqrt(36 / 300000), rel=1e-4)
    assert p['elasticities'][0] == pytest.approx(1, rel=1e-4)


def test_matrix_on_example_signs_methods_and_progress():
    calls = []
    r = run_request(request(), progress=lambda d, t: calls.append((d, t)))
    assert r['kind'] == 'sensitivity' and r['base_status'] in ('converged', 'demand_unsatisfied')
    assert calls == [(i, 7) for i in range(1, 8)]          # 1 base + 2 per parameter
    by = {p['id']: p for p in r['parameters']}
    assert by['PU1']['method'] == 'central'
    assert by['V1']['method'] == 'backward' and by['V2']['method'] == 'backward'  # opening 1 is the upper limit
    t1, t2 = 0, 1
    assert by['PU1']['elasticities'][t2] == pytest.approx(1, abs=.05)  # nearly proportional
    assert by['V1']['elasticities'][t2] < 0 < by['V2']['elasticities'][t2]  # opening V1 steals from T2
    assert r['base_values'][t2] == pytest.approx(13.679 / 3600, rel=1e-3)
    assert r['fluid']['density_kg_m3'] > 990


def test_zero_base_value_has_no_elasticity():
    m = example()
    v2 = next(e for e in m['edges'] if e['id'] == 'V2')
    v2['opening'] = 0  # closed: T2 flow is 0, its elasticity is undefined (not 0, not infinite)
    r = run_request(request([dict(id='PU1', field='speed')], [T2], m))
    assert r['base_values'][0] == 0 and r['parameters'][0]['elasticities'] == [None]


@pytest.mark.parametrize('change,message', [
    (dict(parameters=[]), '参数'),
    (dict(parameters=[dict(id='P1', field='diameter')]), '仅限'),
    (dict(parameters=[PARAMS[0], PARAMS[0]]), '重复'),
    (dict(step=0), '步长'),
    (dict(step=.6), '步长'),
    (dict(observables=[]), '观测量'),
])
def test_invalid_sensitivity_requests_rejected(change, message):
    with pytest.raises(ValueError, match=message):
        check_request(request(**change))


def test_historic_sensitivity_reports_missing_edge_in_chinese():
    with pytest.raises(ValueError, match='不存在'):
        sensitivity(loop(), 'nope', 'speed', .001, 'load')
