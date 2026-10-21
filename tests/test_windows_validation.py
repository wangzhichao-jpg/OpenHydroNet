"""Acceptance helpers: Linux developer checks never count as Windows UI acceptance."""
import importlib.util
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]


def module(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


kit = module(ROOT / "tools/prepare_windows_validation.py")
smoke = module(ROOT / "validation/windows/offline_smoke.py")


def test_feedback_defaults_are_not_executed():
    csv, text = kit.feedback_text()
    assert csv.count(",未执行,") == 18
    assert text.count("结果：未执行") == 18
    assert {code for _, code, _ in kit.CASES} == {f"W{i:02d}" for i in range(1, 13)} | {f"X{i:02d}" for i in range(1, 7)}


def test_reject_altered_software_before_packaging(tmp_path):
    path = tmp_path / "wrong.zip"
    path.write_bytes(b"not the signed-off preview")
    with pytest.raises(RuntimeError, match="摘要不符"):
        kit.check_payload(path)


def test_windows_text_encoding_and_cmd_isolation(tmp_path):
    path = tmp_path / "guide.txt"
    kit.write_windows(path, "中文\n第二行\n")
    assert path.read_bytes().startswith(b"\xef\xbb\xbf")
    assert path.read_bytes().endswith("第二行\r\n".encode())
    command = kit.command_files()["03-启动隔离测试.cmd"]
    assert "setlocal DisableDelayedExpansion" in command
    assert "OHN_PROFILE=%~dp0feedback\\test-profile" in command
    assert "start \"\" /wait" in command
    for text in kit.command_files().values():
        assert "ExecutionPolicy" not in text
        assert "taskkill" not in text.lower()


@pytest.mark.skipif(sys.platform == "win32", reason="checks non-Windows rejection specifically")
def test_linux_cannot_report_windows_passed(tmp_path):
    out = tmp_path / "denied"
    assert smoke.run(ROOT, out, tmp_path / "not-needed.json") == 1
    report = json.loads((out / "check-result.json").read_text())
    assert report["status"] == "failed"
    assert report["windows_host"] is False
    assert report["manual_ui_verified"] is False


@pytest.mark.skipif(sys.platform == "win32", reason="developer-mode check on existing Linux environment")
def test_offline_developer_smoke_and_reference(tmp_path):
    ref = tmp_path / "reference.json"
    ref.write_text(json.dumps(kit.reference_data()))
    out = tmp_path / "outputs"
    assert smoke.run(ROOT, out, ref, allow_non_windows=True) == 0
    report = json.loads((out / "check-result.json").read_text())
    assert report["status"] == "passed_developer_check_only"
    assert report["windows_host"] is False
    assert report["manual_ui_verified"] is False
    assert len(report["checks"]) >= 25
    assert (out / "parameters.xlsx").read_bytes()[:2] == b"PK"
    assert (out / "result-80c.json").exists()
    with pytest.raises(FileExistsError):
        smoke.run(ROOT, out, ref, allow_non_windows=True)
