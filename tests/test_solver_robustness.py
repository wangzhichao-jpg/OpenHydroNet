"""Original manufactured networks, not transcribed/derived paper tables.

Choose heads and resistances first; compute signed flows and node withdrawals
with elementary arithmetic. Thus both expected flows and heads are known
without calling the production loss law or another numerical optimizer.
"""
import copy
import math

import pytest

from openhydronet import solve
from openhydronet.solver import model_hash


def manufactured(groups=1, reverse=False, flow_scale=1.0):
    heads = {'reference': 80.0}
    pairs = [(0,1),(1,2),(2,3),(3,4),(4,5),(0,3),(1,4),(2,5),(0,5),(1,3)]
    resistances = [11.,7e3,2e7,9e4,6e8,3e3,8e5,4e6,5e2,2e2]
    edges, expected, demand = [], {}, {'reference': 0.0}

    def branch(key, source, target, resistance):
        resistance /= flow_scale**2
        if reverse:
            source, target = target, source
        dh = heads[source]-heads[target]
        q = math.copysign(math.sqrt(abs(dh)/resistance), dh)
        edges.append(dict(id=key, source=source, target=target,
                          kind='resistance', resistance=resistance))
        expected[key] = q
        demand[source] -= q
        demand[target] += q

    for group in range(groups):
        ids = ['reference']+[f'g{group}n{i}' for i in range(1,6)]
        for i in range(1,6):
            heads[ids[i]] = 80.0-3*i
            demand[ids[i]] = 0.0
        for j, ((a,b), resistance) in enumerate(zip(pairs, resistances)):
            branch(f'g{group}e{j}', ids[a], ids[b], resistance)
        if group:
            branch(f'bridge{group}', f'g{group-1}n3', ids[2], 1e4)
    model = dict(nodes=[dict(id=key, head=80.0 if key=='reference' else None,
                             demand=0.0 if key=='reference' else demand[key], elevation=0)
                        for key in heads], edges=edges, fluid=dict(temperature=20))
    return model, heads, expected


@pytest.mark.parametrize('groups,reverse,scale', [
    (1,False,1.0), (1,True,1.0), (1,False,1e-5),
    (12,False,1.0), (12,True,1.0), (12,True,1e-5),
])
def test_manufactured_high_contrast_signed_network(groups, reverse, scale):
    model, heads, flows = manufactured(groups, reverse, scale)
    before = copy.deepcopy(model)
    result = solve(model)
    assert result['status'] == 'converged', result
    assert result['input_hash'] == model_hash(before)
    assert model == before
    assert result['iterations'] <= 600
    balance = {n['id']:n['demand'] for n in model['nodes']}
    for edge in model['edges']:
        q = result['edges'][edge['id']]['flow_m3_s']
        assert q == pytest.approx(flows[edge['id']], rel=2e-5, abs=1e-14)
        source, target = edge['source'], edge['target']
        balance[source] += q; balance[target] -= q
        drop = result['nodes'][source]['head_m']-result['nodes'][target]['head_m']
        assert abs(drop-edge['resistance']*q*abs(q)) < 1e-5
    assert max(abs(value) for key,value in balance.items() if key!='reference') < 1e-8
    for key, expected in heads.items():
        assert result['nodes'][key]['head_m'] == pytest.approx(expected, abs=1e-5)


@pytest.mark.parametrize('reverse', [False, True])
def test_high_contrast_network_with_only_positive_withdrawals(reverse):
    heads = {f'n{i}':100.0-i for i in range(6)}
    specs = [(0,1,.5),(1,2,.2),(2,3,.08),(3,4,.0005),(4,5,.0001),
             (0,2,.02),(1,3,.006),(2,4,.0002),(3,5,.00005),(0,5,.002)]
    edges, expected = [], {}
    demand = dict.fromkeys(heads,0.0)
    for i,(a,b,q) in enumerate(specs):
        source,target=f'n{a}',f'n{b}'
        resistance=(heads[source]-heads[target])/q**2
        demand[source]-=q; demand[target]+=q
        if reverse:
            source,target=target,source
            q=-q
        edges.append(dict(id=f'e{i}',source=source,target=target,
                          kind='resistance',resistance=resistance))
        expected[f'e{i}']=q
    assert all(value>0 for key,value in demand.items() if key!='n0')
    assert max(e['resistance'] for e in edges)/min(e['resistance'] for e in edges)>1e8
    model=dict(nodes=[dict(id=key,head=100.0 if key=='n0' else None,
                           demand=0.0 if key=='n0' else demand[key]) for key in heads],edges=edges)
    result=solve(model)
    assert result['status']=='converged',result
    for key,q in expected.items():
        assert result['edges'][key]['flow_m3_s']==pytest.approx(q,rel=1e-5)
    for key,h in heads.items():
        assert result['nodes'][key]['head_m']==pytest.approx(h,abs=1e-5)


def test_failure_budget_and_timeout_are_not_silently_promoted():
    model, _, _ = manufactured()
    result = solve(model, max_nfev=1)
    assert result['status'] == 'numerical_failure'
    assert result['iterations'] == 1
    assert result['residuals']['energy_m'] > 1e-5
    assert solve(model, timeout=0)['status'] == 'timeout'


def test_zero_flow_high_resistance_and_reverse_check_remain_physical():
    model = dict(nodes=[dict(id='a',head=30),dict(id='b',head=40)],edges=[
        dict(id='blocked',source='a',target='b',kind='resistance',resistance=6e8,check_valve=True),
        dict(id='reverse',source='a',target='b',kind='resistance',resistance=11),
    ])
    result = solve(model)
    assert result['status'] == 'converged', result
    assert abs(result['edges']['blocked']['flow_m3_s']) < 1e-9
    assert result['edges']['reverse']['flow_m3_s'] == pytest.approx(-math.sqrt(10/11),rel=1e-6)
