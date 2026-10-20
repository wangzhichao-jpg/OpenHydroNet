import math
import pytest
from openhydronet.physics import water,flow_to_si,flow_from_si,friction_factor,loss,G,fit_pump


def test_water_units_and_pressure():
    rho,nu=water(20)
    assert rho==pytest.approx(998.2,rel=.001)
    assert nu==pytest.approx(1.004e-6,rel=.015)
    assert rho*G*10==pytest.approx(97890,rel=.002)
    for unit in ('m3/h','m3/s','kg/h','t/h','L/s'):
        assert flow_from_si(flow_to_si(100,unit,rho),unit,rho)==pytest.approx(100)
    assert flow_to_si(rho*36,'kg/h',rho)==pytest.approx(.01)
    assert flow_to_si(36,'m3/h',rho)==pytest.approx(.01)


def test_friction_regions_continuity():
    assert friction_factor(1000,.001)==pytest.approx(.064)
    for boundary in (2300,4000):
        assert friction_factor(boundary-.001,.001)==pytest.approx(friction_factor(boundary+.001,.001),rel=1e-5)
    assert friction_factor(0,0)==0


def test_local_loss_and_ratio():
    _,nu=water(20)
    base=dict(kind='pipe',length=100,diameter=.1,roughness=.00005)
    q=.01;h=loss(base,q,nu)
    assert loss({**base,'local_mode':'ratio','local_ratio':.3},q,nu)==pytest.approx(h*1.3)
    a=math.pi*.1*.1/4
    assert loss({**base,'zeta':2},q,nu)-h==pytest.approx(2*(q/a)**2/(2*G))
    assert loss(base,-q,nu)==pytest.approx(-h)


def test_pump_fit_independent_points():
    q=[0,.004,.008,.012];h=[30-100000*x*x for x in q]
    r=fit_pump(q,h)
    assert r['curve']==pytest.approx([30,0,-100000],abs=1e-7)
    assert r['rmse_m']<1e-10
    with pytest.raises(ValueError):fit_pump([0,0,.1],[1,2,3])
