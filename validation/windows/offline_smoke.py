"""Offline checks using the bundled interpreter; never certifies manual UI cases."""
import argparse
import copy
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import struct
import sys
import traceback


def run(app_dir, output, reference_path, allow_non_windows=False):
    app_dir, output = Path(app_dir).resolve(), Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    is_windows = sys.platform == "win32"
    report = {
        "status": "failed", "windows_host": is_windows,
        "scope": "bundled Python/dependencies, steady solver and XLSX only; manual UI not verified",
        "manual_ui_verified": False, "python_version": platform.python_version(),
        "python_bits": struct.calcsize("P") * 8, "checks": [],
    }

    def check(name, condition, detail=None):
        report["checks"].append({"name": name, "passed": bool(condition), "detail": detail})
        if not condition:
            raise AssertionError(name)

    try:
        check("Windows host or explicit developer-only mode", is_windows or allow_non_windows)
        check("64-bit interpreter", report["python_bits"] == 64)
        import openhydronet
        from openhydronet.tableio import read_table, workbook_export
        import base64
        import numpy
        import scipy
        import openpyxl
        import et_xmlfile
        import defusedxml
        reference = json.loads(Path(reference_path).read_text(encoding="utf-8-sig"))
        report["software_version"] = openhydronet.__version__
        report["dependencies"] = {name: importlib.metadata.version(name) for name in
                                  ("numpy", "scipy", "openpyxl", "et-xmlfile", "defusedxml")}
        check("software version", openhydronet.__version__ == reference["version"], openhydronet.__version__)
        for name, version in reference["dependencies"].items():
            check("dependency " + name, report["dependencies"][name] == version, report["dependencies"][name])
        if is_windows:
            check("bundled interpreter is used", Path(sys.executable).resolve() == (app_dir / "runtime/python.exe").resolve())
        project = openhydronet.load_project(app_dir / "examples/closed-loop.ohn.json")
        for temperature in (20, 80):
            current = copy.deepcopy(project)
            current["model"]["fluid"]["temperature"] = temperature
            unchanged = copy.deepcopy(current["model"])
            result = openhydronet.solve(current["model"])
            (output / f"result-{temperature}c.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            expected = reference["cases"][str(temperature)]
            check(f"{temperature} C input is unchanged", current["model"] == unchanged)
            check(f"{temperature} C converged", result["status"] == "converged", result["status"])
            check(f"{temperature} C mass residual", result["residuals"]["mass_m3_s"] <= 1e-8, result["residuals"]["mass_m3_s"])
            check(f"{temperature} C energy residual", result["residuals"]["energy_m"] <= 1e-5, result["residuals"]["energy_m"])
            check(f"{temperature} C input hash", result["input_hash"] == expected["input_hash"])
            for oid in ("PU1", "T1", "T2"):
                actual = result["edges"][oid]["flow_m3_s"]
                check(f"{temperature} C {oid} reference flow", math.isclose(actual, expected["flows_m3_s"][oid], rel_tol=1e-5, abs_tol=1e-9), actual)
            check(f"{temperature} C pump head", math.isclose(result["edges"]["PU1"]["pump_head_m"], expected["pump_head_m"], rel_tol=1e-5, abs_tol=1e-6))
            check(f"{temperature} C no invented electrical power", result["edges"]["PU1"]["input_power_w"] is None)
            if temperature == 20:
                for name, value in (("parameters.xlsx", None), ("results.xlsx", result)):
                    data = workbook_export(current, value)
                    (output / name).write_bytes(data)
                    table = read_table({"format": "xlsx", "content_base64": base64.b64encode(data).decode(), "sheet": "管段"})
                    ids = {row["id"] for row in table["rows"]}
                    check(name + " actual XLSX parse", data[:2] == b"PK" and ids == {"P1", "P2", "P3", "P4"}, sorted(ids))
        report["status"] = "passed" if is_windows else "passed_developer_check_only"
    except Exception as error:
        text = "".join(traceback.format_exception(type(error), error, error.__traceback__))
        for private in (str(app_dir), str(output), str(Path.home())):
            text = text.replace(private, "<LOCAL_PATH>")
        report["error"] = text
    (output / "check-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for file in sorted(output.glob("*")):
        if file.is_file():
            print(file.name + " SHA256 " + hashlib.sha256(file.read_bytes()).hexdigest())
    print("STATUS: " + report["status"])
    return 0 if report["status"].startswith("passed") else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--allow-non-windows", action="store_true", help="developer-only; cannot produce Windows passed status")
    args = parser.parse_args()
    return run(args.app_dir, args.out, args.reference, args.allow_non_windows)


if __name__ == "__main__":
    sys.exit(main())
