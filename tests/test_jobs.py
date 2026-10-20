import json
from pathlib import Path
import pytest
from openhydronet.server import Jobs


def test_request_owners_isolate_deduplication_and_cancel():
    model=json.loads((Path(__file__).resolve().parents[1]/'examples/closed-loop.ohn.json').read_text(encoding='utf-8'))['model']
    jobs=Jobs()
    try:
        a=jobs.start(model,'owner-a');again=jobs.start(model,'owner-a');b=jobs.start(model,'owner-b')
        assert a['id']==again['id'];assert a['id']!=b['id'];assert a['input_hash']==b['input_hash']
        stopped=jobs.cancel(a['id']);assert stopped['process_stopped']
        assert jobs.items[b['id']]['status']!='cancelled'
    finally:jobs.shutdown()
    assert all(j['process'].poll() is not None for j in jobs.items.values())
    with pytest.raises(ValueError,match='退出'):jobs.start(model,'new')
