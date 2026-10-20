import copy
import math
import pytest
from openhydronet import solve
from openhydronet.validation import ModelError
from openhydronet.physics import G,water


def network(edges, heads=None, elevations=None, demands=None):
    names=sorted({e[k] for e in edges for k in ('source','target')})
    heads=heads or {'a':30}
    return dict(nodes=[dict(id=k,head=heads.get(k),elevation=(elevations or {}).get(k,0),demand=(demands or {}).get(k,0)) for k in names],edges=edges,fluid=dict(temperature=20))


def resistance(i,s,t,r):return dict(id=i,source=s,target=t,kind='resistance',resistance=r)


def good(r):
    assert r['status']=='converged',r
    assert r['residuals']['mass_m3_s']<1e-8
    assert r['residuals']['energy_m']<1e-5
    return r


def test_single_resistance_analytic():
    r=good(solve(network([resistance('e','a','b',1e5)],{'a':40,'b':30})))
    assert r['edges']['e']['flow_m3_s']==pytest.approx(.01,rel=1e-6)


def test_series_analytic():
    m=network([resistance('e1','a','b',1e5),resistance('e2','b','c',3e5)],{'a':40,'c':30})
    r=good(solve(m));assert r['edges']['e1']['flow_m3_s']==pytest.approx(.005,rel=1e-6)
    assert r['nodes']['b']['head_m']==pytest.approx(37.5,abs=1e-5)


def test_parallel_analytic():
    r=good(solve(network([resistance('e1','a','b',1e5),resistance('e2','a','b',4e5)],{'a':40,'b':30})))
    assert r['edges']['e1']['flow_m3_s']==pytest.approx(.01,rel=1e-6)
    assert r['edges']['e2']['flow_m3_s']==pytest.approx(.005,rel=1e-6)


def test_symmetric_multi_loop_independent():
    es=[resistance('ab','a','b',1e5),resistance('ac','a','c',1e5),resistance('bd','b','d',1e5),resistance('cd','c','d',1e5),resistance('bc','b','c',1e5)]
    r=good(solve(network(es,{'a':50,'d':30})))
    for key in ('ab','ac','bd','cd'):assert r['edges'][key]['flow_m3_s']==pytest.approx(.01,rel=1e-5)
    assert r['edges']['bc']['flow_m3_s']==pytest.approx(0,abs=1e-8)


def test_laminar_pipe_independent_poiseuille():
    _,nu=water(20);length=20;d=.02;q=1e-6
    dh=128*nu*length*q/(math.pi*G*d**4)
    e=dict(id='p',kind='pipe',source='a',target='b',length=length,diameter=d,roughness=0,zeta=0)
    r=good(solve(network([e],{'a':30+dh,'b':30})))
    assert r['edges']['p']['flow_m3_s']==pytest.approx(q,rel=2e-5)


def test_turbulent_against_independent_colebrook():
    # Independent fixed-point Colebrook, not the Haaland used by production.
    q=.01;d=.1;l=100;eps=.0001;_,nu=water(20)
    v=q/(math.pi*d*d/4);re=v*d/nu;f=.02
    for _ in range(50):f=(-2*math.log10(eps/(3.7*d)+2.51/(re*math.sqrt(f))))**-2
    dh=f*l/d*v*v/(2*G)
    e=dict(id='p',kind='pipe',source='a',target='b',length=l,diameter=d,roughness=eps,zeta=0)
    r=good(solve(network([e],{'a':30+dh,'b':30})))
    assert r['edges']['p']['flow_m3_s']==pytest.approx(q,rel=.015)


@pytest.mark.parametrize('speed,count',[(1,1),(.7,1),(1,2),(.7,3)])
def test_pump_intersection_and_affinity(speed,count):
    # H=36*n²-100000*(Q/count)²; R=200000; closed loop exact intersection.
    pump=dict(id='pump',kind='pump',source='a',target='b',curve=[36,0,-100000],speed=speed,parallel=count)
    m=network([pump,resistance('r','b','a',200000)])
    q=math.sqrt(36*speed**2/(200000+100000/count**2))
    r=good(solve(m));assert r['edges']['r']['flow_m3_s']==pytest.approx(q,rel=1e-5)
    assert r['edges']['pump']['input_power_w'] is None


def test_elevation_does_not_add_to_circulating_head():
    es=[dict(id='pump',kind='pump',source='a',target='b',curve=[25,0,-100000]),resistance('r','b','a',100000)]
    r1=good(solve(network(es)));r2=good(solve(network(es,elevations={'b':100})))
    assert r1['edges']['r']['flow_m3_s']==pytest.approx(r2['edges']['r']['flow_m3_s'],abs=1e-9)
    assert r2['nodes']['b']['pressure_pa_gauge']<r1['nodes']['b']['pressure_pa_gauge']


def test_reverse_flow():
    r=good(solve(network([resistance('e','a','b',1e5)],{'a':30,'b':40})))
    assert r['edges']['e']['flow_m3_s']==pytest.approx(-.01,rel=1e-6)


def test_makeup_leak_boundary_mass():
    m=network([resistance('e','a','b',1e5)],demands={'b':.002})
    r=good(solve(m));assert r['nodes']['a']['boundary_supply_m3_s']==pytest.approx(.002,abs=1e-8)
    m['nodes'][1]['demand']=-.002
    r=good(solve(m));assert r['edges']['e']['flow_m3_s']==pytest.approx(-.002,abs=1e-8)


def test_closed_valve_changes_topology():
    e=dict(id='v',kind='valve',source='a',target='b',opening=0,kv=50)
    with pytest.raises(ModelError,match='定压参考'):solve(network([e]))
    r=good(solve(network([e],{'a':30,'b':50})))
    assert r['edges']['v']['flow_m3_s']==0


def test_valve_throttle():
    e=dict(id='v',kind='valve',source='a',target='b',opening=1,kv=60)
    m=network([e],{'a':40,'b':30});r1=good(solve(m));m['edges'][0]['opening']=.5;r2=good(solve(m))
    assert r2['edges']['v']['flow_m3_s']/r1['edges']['v']['flow_m3_s']==pytest.approx(.5,rel=1e-6)


def test_check_valve_blocks_reverse():
    e=resistance('e','a','b',1e5);e['check_valve']=True
    r=good(solve(network([e],{'a':30,'b':40})))
    assert abs(r['edges']['e']['flow_m3_s'])<1e-9


def test_ideal_flow_control_insufficient_head():
    e=dict(id='fc',kind='flow_control',source='a',target='b',set_flow=.01,min_head=3)
    r=solve(network([e],{'a':30,'b':31}))
    assert r['status']=='demand_unsatisfied'


def test_provable_ideal_boundary_conflict():
    e=dict(id='p',kind='pump',source='a',target='b',curve=[10],check_valve=False)
    r=solve(network([e],{'a':30,'b':50}))
    assert r['status']=='boundary_conflict'


def test_invalid_references_and_no_mutation():
    m=network([resistance('e','a','b',1e5)],{'a':40,'b':30});before=copy.deepcopy(m)
    solve(m);assert m==before
    m['edges'][0]['target']='missing'
    with pytest.raises(ModelError,match='引用'):solve(m)


def test_nonfinite_and_negative_parameters():
    for value in (-1,float('nan'),0):
        e=dict(id='p',kind='pipe',source='a',target='b',diameter=value)
        with pytest.raises(ModelError):solve(network([e]))


def test_disconnected_subnet():
    with pytest.raises(ModelError,match='定压参考'):
        solve(network([resistance('e','a','b',1e5),resistance('e2','c','d',1e5)]))


def test_zero_flow():
    r=good(solve(network([resistance('e','a','b',1e5)],{'a':30,'b':30})))
    assert abs(r['edges']['e']['flow_m3_s'])<1e-7
