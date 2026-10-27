"""T-021 (W4-04): the getting-started text shipped in the Windows portable package."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build_module():
    spec = importlib.util.spec_from_file_location('build_windows', ROOT / 'tools/build_windows.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)   # importing must not assemble anything
    return module


def test_getting_started_explains_unsigned_warning_hash_check_and_slow_first_start():
    text = build_module().start_text('9.9.9-test')
    assert text.startswith('OpenHydroNet 9.9.9-test')
    for phrase in ('未知发布者', '代码签名', 'Get-FileHash', 'OpenHydroNet-9.9.9-test-win-x64.zip', 'SHA256',
                   '.sha256', '不要关闭', '首次启动', '重试', '验证计算.cmd', 'USER_MANUAL.md', 'KNOWN_LIMITATIONS.md'):
        assert phrase in text, phrase
