import copy
import json
from pathlib import Path
import pytest
from openhydronet.project import check_project, ProjectError
from openhydronet.validation import validate

@pytest.fixture
def project():
    return json.loads((Path(__file__).resolve().parents[1]/'examples/closed-loop.ohn.json').read_text(encoding='utf-8'))

@pytest.mark.parametrize('change',[
    lambda p:p.update(name={}),
    lambda p:p['model']['nodes'][0].update(name=[]),
    lambda p:p['model']['edges'][0].update(source=[]),
    lambda p:p['layout'].update(s0={'x':'bad','y':0}),
    lambda p:p['model']['fluid'].update(temperature=-1),
    lambda p:p['preferences'].update(flow_unit='unknown'),
    lambda p:p.update(library=[None]),
    lambda p:p['model']['edges'][0].update(closed='false'),
    lambda p:p['model']['edges'][4].update(curve=[True]),
])
def test_corrupt_input_reports_error_instead_of_crashing_renderer(project,change):
    change(project)
    with pytest.raises(ProjectError):check_project(project)


def test_optional_container_defaults_are_explicit_and_nonmutating(project):
    for field in ('layout','preferences','library','scenarios'):project.pop(field)
    original=copy.deepcopy(project);r=check_project(project)
    assert project==original
    assert r['preferences']=={'flow_unit':'m3/h','scenario':'heating'}
    assert r['library']==[]


def test_device_state_and_curve_range_are_never_coerced(project):
    model=project['model'];model['edges'][0]['closed']='false'
    assert any(x['code']=='STATE' for x in validate(model))
    model['edges'][0]['closed']=False
    model['edges'][4]['valid_flow']=[.02,.01]
    assert any(x['code']=='CURVE_RANGE' for x in validate(model))
