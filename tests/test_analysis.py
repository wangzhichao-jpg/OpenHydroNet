import copy
import math
import pytest
from openhydronet import solve
from openhydronet.analysis import scan,accessibility,sensitivity
from openhydronet.expansion import expand_single_line
from test_solver import network,resistance


def loop():return network([dict(id='pump',kind='pump',source='a',target='b',curve=[36,0,-100000],speed=1),dict(id='load',kind='terminal',source='b',target='a',design_flow=.01,design_head=20)])


def test_scan_are_independent_steady_points():
    m=loop();before=copy.deepcopy(m)
    r=scan(m,[dict(id='pump',field='speed',values=[.5,1])])
    assert r['analysis']=='independent_steady_scan' and m==before
    flows=[x['result']['edges']['load']['flow_m3_s'] for x in r['records']]
    assert flows[1]/flows[0]==pytest.approx(2,rel=1e-5)


def test_accessibility_fixed_feasible_and_failed():
    assert accessibility(loop(),[dict(id='load',min_flow=.005)])['conclusion']=='feasible_at_this_point'
    assert accessibility(loop(),[dict(id='load',min_flow=.1)])['conclusion']=='not_satisfied_at_this_point'


def test_local_search_never_claims_global_infeasibility():
    r=accessibility(loop(),[dict(id='load',min_flow=.1)],[dict(id='pump',field='speed',lower=.5,upper=1)])
    assert r['conclusion']=='undetermined' and r['global_guarantee'] is False
    r=accessibility(loop(),[dict(id='load',min_flow=.013)],[dict(id='pump',field='speed',lower=.5,upper=1.5)])
    assert r['conclusion']=='feasible_point_found'


def test_sensitivity_against_exact_derivative():
    r=sensitivity(loop(),'pump','speed',.001,'load')
    assert r['derivative']==pytest.approx(math.sqrt(36/300000),rel=1e-4)


def test_single_line_expands_to_independent_equivalent():
    d=dict(nodes=[dict(id='a'),dict(id='b')],edges=[resistance('pipe','a','b',1e5)],source=dict(node='a',head=30,pump=dict(id='pump',curve=[36,0,-100000])),terminals=[dict(id='load',node='b',design_flow=.01,design_head=10)])
    x=expand_single_line(d);r=solve(x['model'])
    # Two R=100000 pipes and R=100000 terminal, pump quadratic=100000.
    assert r['status']=='converged'
    assert r['edges']['load']['flow_m3_s']==pytest.approx(math.sqrt(36/400000),rel=1e-5)
    assert x['mapping']['pipe']==['pipe::s','pipe::r']
    assert r['edges']['pipe::s']['flow_m3_s']==pytest.approx(r['edges']['pipe::r']['flow_m3_s'],rel=1e-5)
