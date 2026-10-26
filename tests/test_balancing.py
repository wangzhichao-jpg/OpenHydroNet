"""T-011: hydraulic balancing by the designated-flow method (SPEC-002)."""
import copy
import math
import pytest
from openhydronet.balancing import pair_balancing_valves, balance
from openhydronet.analysis import check_request, run_request
from openhydronet.physics import G
from test_solver import network
from test_analysis_jobs import example

KV_REQ = 36 / math.sqrt(10 * 1000 * G / 1e5)   # Kv that drops exactly 10 m at 0.01 m³/s


def loop(kv=2 * KV_REQ, characteristic='linear', rangeability=50):
    """Constant-head pump (20 m) → valve → terminal (0.01 m³/s at 10 m). Hand-calculable."""
    return network([
        dict(id='pump', kind='pump', source='a', target='b', curve=[20, 0, 0], speed=1),
        dict(id='v', kind='valve', source='b', target='c', kv=kv, opening=1,
             characteristic=characteristic, rangeability=rangeability),
        dict(id='t', kind='terminal', source='c', target='a', design_flow=.01, design_head=10),
    ])


def by_terminal(r):
    return {p['terminal']: p for p in r['pairs']}


def test_example_pairs_each_terminal_with_its_own_valve():
    pairs = pair_balancing_valves(example())
    assert [(p['terminal'], p['valve'], p['orientation']) for p in pairs['paired']] == [('T1', 'V1', 1), ('T2', 'V2', 1)]
    assert pairs['unpaired'] == [] and pairs['ambiguous'] == []


def test_unpaired_ambiguous_and_reversed_valves():
    m = example()
    edges = {e['id']: e for e in m['edges']}
    edges['V1'].update(kind='resistance', resistance=1000)     # T1 has no valve now
    edges['P3'].update(kind='valve', kv=85, opening=1)            # T2 chain now holds two valves
    p = pair_balancing_valves(m)
    assert p['paired'] == [] and p['unpaired'] == ['T1']
    assert p['ambiguous'] == [dict(terminal='T2', valves=['P3', 'V2'])]
    m = example()
    v2 = next(e for e in m['edges'] if e['id'] == 'V2')
    v2['source'], v2['target'] = v2['target'], v2['source']
    assert pair_balancing_valves(m)['paired'][1] == dict(terminal='T2', valve='V2', orientation=-1)


def test_hand_calculated_opening_and_minimum_speed():
    fixed = balance(loop(), mode='fixed', step=None)
    assert fixed['conclusion'] == 'balanced'
    assert by_terminal(fixed)['t']['opening'] == pytest.approx(.5, rel=1e-6)
    assert by_terminal(fixed)['t']['required_kv'] == pytest.approx(KV_REQ, rel=1e-6)
    assert by_terminal(fixed)['t']['verified_flow_m3_s'] == pytest.approx(.01, rel=1e-6)
    var = balance(loop(), pump='pump', lower=.5, upper=1.5, step=None)
    assert var['speed']['balanced'] == pytest.approx(math.sqrt(12.5 / 20), rel=1e-4)
    assert by_terminal(var)['t']['opening'] == pytest.approx(1, abs=1e-4) and var['index_terminal'] == 't'


def test_equal_percentage_inverse_round_trips_through_the_solver():
    r = balance(loop(kv=4 * KV_REQ, characteristic='equal_percentage'), mode='fixed', step=None)
    assert by_terminal(r)['t']['opening'] == pytest.approx(1 + math.log(.25) / math.log(50), rel=1e-6)
    assert by_terminal(r)['t']['verified_flow_m3_s'] == pytest.approx(.01, rel=1e-6)


def test_example_fixed_speed_only_valves():
    r = balance(example(), mode='fixed')
    p = by_terminal(r)
    assert r['conclusion'] == 'balanced' and r['speed']['balanced'] == 1
    assert p['T1']['opening_exact'] == pytest.approx(.203, abs=.002) and p['T1']['opening'] == .2
    assert p['T2']['opening_exact'] == pytest.approx(.397, abs=.002) and p['T2']['opening'] == .4
    assert all(abs(x['deviation']) <= .05 for x in r['pairs'])


def test_example_minimum_speed_with_index_circuit_and_lower_power():
    calls = []
    r = balance(example(), pump='PU1', lower=.5, upper=1.5, progress=lambda d, t: calls.append((d, t)))
    p = by_terminal(r)
    assert r['conclusion'] == 'balanced' and r['index_terminal'] == 'T2'
    assert r['speed']['exact'] == pytest.approx(.9752, abs=5e-4) and r['speed']['balanced'] == .98  # rounded up
    # Openings are recomputed at the rounded-up speed: V1 throttles a little more (0.22), V2 stays open.
    assert p['T1']['opening'] == .22 and p['T1']['opening_exact'] == pytest.approx(.2245, abs=.002)
    assert p['T2']['opening'] == 1
    assert all(abs(x['deviation']) <= .05 for x in r['pairs'])
    assert r['before']['terminals']['T1']['flow_m3_s'] > .0048 and r['before']['terminals']['T2']['flow_m3_s'] < .0038
    assert r['after']['pump']['hydraulic_power_w'] < r['before']['pump']['hydraulic_power_w']
    assert calls and [d for d, _ in calls] == list(range(1, len(calls) + 1)) and all(t == calls[0][1] for _, t in calls)


def test_pump_too_weak_is_reported_with_missing_head():
    r = balance(loop(), pump='pump', lower=.5, upper=.7, step=None)
    assert r['conclusion'] == 'not_achievable'
    assert by_terminal(r)['t']['status'] == 'needs_more_head' and by_terminal(r)['t']['missing_head_m'] > 0
    r = balance(loop(), mode='fixed', speed=.7, step=None)
    assert r['conclusion'] == 'not_achievable'


def test_valve_too_large_to_throttle_and_small_opening_warning():
    big = balance(loop(kv=100 * KV_REQ, characteristic='equal_percentage'), mode='fixed', step=None)
    assert big['conclusion'] == 'not_achievable' and by_terminal(big)['t']['status'] == 'cannot_throttle'
    small = balance(loop(kv=10 * KV_REQ), mode='fixed', step=None)   # linear, opening 0.1
    assert small['conclusion'] == 'balanced' and by_terminal(small)['t']['status'] == 'small_opening'


def test_unpaired_terminal_is_reported_with_its_resulting_flow():
    m = example()
    next(e for e in m['edges'] if e['id'] == 'V1').update(kind='resistance', resistance=1000)
    fixed = balance(m, mode='fixed')   # T1 is not throttled, so at speed 1 T2 falls short even fully open
    assert fixed['conclusion'] == 'not_achievable' and fixed['pairs'][0]['missing_head_m'] > 0
    r = balance(m, pump='PU1', lower=.5, upper=1.5)
    assert r['conclusion'] == 'balanced' and [p['terminal'] for p in r['pairs']] == ['T2']
    assert [u['terminal'] for u in r['unpaired']] == ['T1'] and r['unpaired'][0]['deviation'] > .05  # reported, not hidden


@pytest.mark.parametrize('change,message', [
    (dict(mode='weird'), '模式'),
    (dict(pump='V1'), '泵'),
    (dict(pump='nope'), '泵'),
    (dict(lower=1.2, upper=1.1), '泵速范围'),
    (dict(upper=2.5), '泵速范围'),
    (dict(step=0), '精度'),
    (dict(tolerance=0), '容差'),
    (dict(tolerance=.6), '容差'),
])
def test_invalid_balance_requests(change, message):
    req = dict(kind='balance', model=example(), mode='variable', pump='PU1', lower=.5, upper=1.5, step=.01, tolerance=.05)
    req.update(change)
    with pytest.raises(ValueError, match=message):
        check_request(req)


def test_balance_through_the_desktop_request_api():
    r = run_request(dict(kind='balance', model=example(), mode='variable', pump='PU1', lower=.5, upper=1.5))
    assert r['kind'] == 'balance' and r['index_terminal'] == 'T2' and r['tolerance'] == .05
    m = example()
    before = copy.deepcopy(m)
    run_request(dict(kind='balance', model=m, mode='fixed'))
    assert m == before   # never mutates the caller's model


def test_balance_runs_as_a_cancellable_analysis_job():
    from openhydronet.server import Jobs
    from test_analysis_jobs import wait
    jobs = Jobs()
    try:
        job = jobs.start_analysis(dict(kind='balance', model=example(), mode='variable', pump='PU1'), 'o')
        assert job['progress'] == dict(done=0, total=35)
        done = wait(jobs, job['id'])
        assert done['status'] == 'completed' and done['result']['conclusion'] == 'balanced'
    finally:
        jobs.shutdown()
