"""Assemble an offline, isolated Windows acceptance kit; do not execute Windows code."""
import copy
import csv
from datetime import datetime, timezone
import hashlib
import html
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.1.0-preview.2"
SOFTWARE = f"OpenHydroNet-{VERSION}-win-x64"
EXPECTED_SHA256 = "cb01685e7d13678e97649ae34091a1c43315bb636533d5689ff9f1c09199128f"
KIT = f"OpenHydroNet-{VERSION}-Windows-validation"
CASES = [
    ("P0", "W01", "系统版本/x64/中文路径/软件校验"),
    ("P0", "W02", "随包 Python/依赖/20与80℃内核/XLSX"),
    ("P0", "W03", "首次启动/中文/离线"),
    ("P0", "W04", "原始教学网络数值/残差/问题/水压图"),
    ("P0", "W05", "参数修改/结果过期/移动不改物理参数"),
    ("P0", "W06", "中文路径保存/退出/重开/重算"),
    ("P0", "W07", "焦点提交/取消退出/取消保存/保存退出"),
    ("P0", "W08", "非整数和无效输入保护/Esc放弃"),
    ("P0", "W09", "CSV/PDF/SVG/PNG/真实XLSX导出"),
    ("P0", "W10", "100/125/150%高DPI与可选多屏"),
    ("P0", "W11", "退出后本包进程快照/无残留"),
    ("P0", "W12", "0℃与20→80℃质量流量比较"),
    ("P1", "X01", "泵库/拟合/rpm/库JSON副本/删除独立性"),
    ("P1", "X02", "阀库应用保留开度和端点"),
    ("P1", "X03", "CSV/XLSX单位映射/撤销/拒绝错误行"),
    ("P1", "X04", "真实拖放/端口/复制/撤销/交叉不连接"),
    ("P1", "X05", "计算取消与切换工程/迟到任务"),
    ("P1", "X06", "隔离配置中的可选异常退出/草稿恢复"),
]


def digest(file):
    h = hashlib.sha256()
    with Path(file).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def check_payload(file):
    if digest(file) != EXPECTED_SHA256:
        raise RuntimeError("原版 Windows 软件 ZIP 摘要不符，拒绝制作验收包")
    with ZipFile(file) as z:
        if z.testzip() is not None:
            raise RuntimeError("原版 Windows ZIP CRC 失败")
        manifest = json.loads(z.read(SOFTWARE + "/BUILD_MANIFEST.json"))
        if manifest["version"] != VERSION or manifest["commit"] != "09739362c27b9ac87a4c40e3808ad3b0caf3a0f3":
            raise RuntimeError("实际软件版本/提交不符")
    return manifest


def reference_data():
    sys.path.insert(0, str(ROOT / "src"))
    from openhydronet import load_project, solve
    from openhydronet.version import VERSION as reference_version
    reference = {"version": reference_version, "origin": "Same-implementation Linux numerical reference, not independent external solver or Windows execution",
                 "dependencies": {"numpy": "2.4.3", "scipy": "1.17.1", "openpyxl": "3.1.5", "et-xmlfile": "2.0.0", "defusedxml": "0.7.1"}, "cases": {}}
    p = load_project(ROOT / "examples/closed-loop.ohn.json")
    for temperature in (20, 80):
        model = copy.deepcopy(p["model"])
        model["fluid"]["temperature"] = temperature
        r = solve(model)
        if r["status"] != "converged":
            raise RuntimeError("Linux参考算例未收敛")
        reference["cases"][str(temperature)] = {
            "input_hash": r["input_hash"], "flows_m3_s": {k: r["edges"][k]["flow_m3_s"] for k in ("PU1", "T1", "T2")},
            "pump_head_m": r["edges"]["PU1"]["pump_head_m"], "fluid": r["fluid"], "residuals": r["residuals"],
        }
    return reference


def feedback_text():
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(["优先级", "编号", "验证项目", "结果(未执行/通过/失败/跳过)", "实际表现与报错", "截图或文件", "备注"])
    for priority, code, title in CASES:
        writer.writerow([priority, code, title, "未执行", "", "", ""])
    text = "Windows版本/内部版本号：\n系统类型（x64或其他）：\n显示缩放：\n中文路径：\n是否断网：\n安全软件拦截情况：\n测试日期：\n不填写用户名、电脑名、序列号、产品密钥或密码。\n\n"
    for priority, code, title in CASES:
        text += f"{priority} {code} {title}\n结果：未执行\n实际表现/报错：\n截图/文件：\n\n"
    return output.getvalue(), text


def write_windows(file, text, bom=True):
    normalized = text.replace("\r\n", "\n").replace("\n", "\r\n")
    file.write_text(normalized, encoding="utf-8-sig" if bom else "utf-8", newline="")


def command_files():
    header = '@echo off\nchcp 65001 >nul\nsetlocal DisableDelayedExpansion\ncd /d "%~dp0"\n'
    clean = 'set "OHN_PYTHON="\nset "PYTHONHOME="\nset "PYTHONPATH="\nset "ELECTRON_RUN_AS_NODE="\nset "NODE_OPTIONS="\nset "OPENBLAS_NUM_THREADS=1"\n'
    return {
        "01-校验文件.cmd": header + 'powershell.exe -NoProfile -File "%~dp0tools\\prepare.ps1"\nset "RC=%ERRORLEVEL%"\necho If script policy blocks this step, use the manual guide. Do not disable security.\npause\nexit /b %RC%\n',
        "02-内核自动检查.cmd": header + clean + f'''set "APP=%~dp0app\\{SOFTWARE}\\resources\\app"
if not exist "%APP%\\runtime\\python.exe" goto missing
if not exist "%~dp0feedback" mkdir "%~dp0feedback"
:tag
set "TAG=%RANDOM%-%RANDOM%"
if exist "%~dp0feedback\\core-check-%TAG%" goto tag
if exist "%~dp0feedback\\core-launch-%TAG%.log" goto tag
"%APP%\\runtime\\python.exe" "%~dp0tools\\offline_smoke.py" --app-dir "%APP%" --out "%~dp0feedback\\core-check-%TAG%" --reference "%~dp0fixtures\\reference-linux.json" > "%~dp0feedback\\core-launch-%TAG%.log" 2>&1
set "RC=%ERRORLEVEL%"
type "%~dp0feedback\\core-launch-%TAG%.log"
echo See feedback\\core-check-%TAG% and core-launch-%TAG%.log. Exit code: %RC%
echo This check does not verify the desktop UI.
pause
exit /b %RC%
:missing
echo Bundled Python not found. Extract the full kit first; do not install a replacement Python.
pause
exit /b 1
''',
        "03-启动隔离测试.cmd": header + clean + f'''set "APP=%~dp0app\\{SOFTWARE}"
if not exist "%APP%\\OpenHydroNet.exe" goto missing
if not exist "%~dp0feedback" mkdir "%~dp0feedback"
set "OHN_PROFILE=%~dp0feedback\\test-profile"
:tag
set "TAG=%RANDOM%-%RANDOM%"
if exist "%~dp0feedback\\desktop-launch-%TAG%.log" goto tag
echo Starting the isolated test profile. Use only synthetic examples.
start "" /wait "%APP%\\OpenHydroNet.exe" > "%~dp0feedback\\desktop-launch-%TAG%.log" 2>&1
set "RC=%ERRORLEVEL%"
echo Main application returned. Exit code: %RC%
echo Close all test windows, wait 5 seconds, then run 04 to collect results.
pause
exit /b %RC%
:missing
echo OpenHydroNet.exe not found. Extract the full kit first.
pause
exit /b 1
''',
        "04-收集反馈.cmd": header + 'powershell.exe -NoProfile -File "%~dp0tools\\collect-results.ps1" -Label after-exit\nset "RC=%ERRORLEVEL%"\necho If script policy blocks collection, use manual feedback files and screenshots.\npause\nexit /b %RC%\n',
    }


def main():
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
        raise RuntimeError("请先提交验收辅助文件，记录真实干净源码来源")
    a = ROOT / "artifacts"
    target, archive = a / KIT, a / (KIT + ".zip")
    if target.exists() or archive.exists():
        raise FileExistsError("验收资料已存在，不自动覆盖；如需修改请另行归档/版本化")
    build = check_payload(a / (SOFTWARE + ".zip"))
    if reference_data()['version'] != VERSION:
        raise RuntimeError('此工具冻结于 preview.2；须切换原构建源码，不能拿新版内核冒充旧版参考值')
    source = ROOT / "validation/windows"
    guide = (source / "Windows验收说明.md").read_text()
    target.mkdir()
    for name in ("app", "tools", "fixtures", "docs", "evidence", "feedback"):
        (target / name).mkdir()
    with ZipFile(a / (SOFTWARE + ".zip")) as software:
        software.extractall(target / "app")
        for item in software.infolist():
            if not item.is_dir() and digest(target / "app" / item.filename) != hashlib.sha256(software.read(item)).hexdigest():
                raise RuntimeError("解压后的软件字节不一致：" + item.filename)
    write_windows(target / "00-请先阅读-Windows验收说明.txt", guide)
    (target / "00-请先阅读.html").write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Windows 实机验收</title><style>body{max-width:1080px;margin:32px auto;padding:0 20px;color:#153348;background:#f7fafc}pre{font:16px/1.8 "Microsoft YaHei","Noto Sans CJK SC",sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0;background:white}pre{font-size:11pt}}</style><pre>' + html.escape(guide) + '</pre></html>', encoding="utf-8")
    for name in ("prepare.ps1", "collect-results.ps1"):
        write_windows(target / "tools" / name, (source / name).read_text())
    shutil.copy2(source / "offline_smoke.py", target / "tools")
    for name, text in command_files().items():
        write_windows(target / name, text, bom=False)
    csv_text, txt_text = feedback_text()
    write_windows(target / "反馈记录.csv", csv_text)
    write_windows(target / "反馈记录.txt", txt_text)
    for name in ("closed-loop.ohn.json", "device-library.ohnlib.json", "parameter-update.csv"):
        shutil.copy2(ROOT / "examples" / name, target / "fixtures")
    for name, value in {
        "pump-points.txt": "0,32\n14.4,29.12\n28.8,20.48\n43.2,6.08\n",
        "pump-points-invalid.txt": "0,32\n14.4,31\nx,14\n",
        "reject-unknown-id.csv": "id,diameter_mm\nP2,50\nNOT_AN_EXISTING_ID,50\n",
        "reject-duplicate-id.csv": "id,diameter_mm\nP2,50\nP2,55\n",
        "reject-invalid-number.csv": "id,diameter_mm\nP2,50\nP3,not-a-number\n",
    }.items():
        write_windows(target / "fixtures" / name, value, bom=False)
    (target / "fixtures/reference-linux.json").write_text(json.dumps(reference_data(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name in ("USER_MANUAL.md", "LIBRARY_TABLES.md", "KNOWN_LIMITATIONS.md", "ACCEPTANCE.md"):
        shutil.copy2(ROOT / "docs" / name, target / "docs")
    for stem in ("VALIDATION", "WINDOWS_BUILD_MANIFEST", "RELEASE_AUDIT"):
        shutil.copy2(a / f"{stem}-{VERSION}.json", target / "evidence")
    shutil.copy2(ROOT / "LICENSE", target)
    write_windows(target / "feedback/本目录用途.txt", "此处产生本次测试的检查结果/隔离配置/日志，不自动上传。不要发送整个 test-profile。填写反馈并收集后，只发送自己检查过的 collected-* 和人工截图/教学文件。\n")
    files = [{"path": p.relative_to(target).as_posix(), "bytes": p.stat().st_size, "sha256": digest(p)} for p in sorted(target.rglob("*")) if p.is_file()]
    manifest = {"kit": KIT, "created_utc": datetime.now(timezone.utc).isoformat(), "software_version": VERSION,
                "software_commit": build["commit"], "kit_source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "assembly_host": sys.platform, "windows_execution_performed_here": False, "powershell_executed_here": False,
                "source_software_zip_sha256": EXPECTED_SHA256, "software_extracted_byte_identical": True,
                "scope": "User-run offline native acceptance kit; manual status initially not executed", "files": files}
    (target / "KIT_MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    included = [p for p in sorted(target.rglob("*")) if p.is_file()]
    (target / "SHA256SUMS").write_text(''.join(digest(p) + '  ' + p.relative_to(target).as_posix() + '\n' for p in included), encoding="utf-8", newline="\n")
    with ZipFile(archive, "w", ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(target.rglob("*")):
            if p.is_file():
                z.write(p, "OHN验收/" + p.relative_to(target).as_posix(), compress_type=ZIP_DEFLATED)
    with ZipFile(archive) as z:
        if z.testzip() is not None:
            raise RuntimeError("验收总包 ZIP CRC 失败")
    result = {"archive": str(archive.relative_to(ROOT)), "bytes": archive.stat().st_size, "sha256": digest(archive), "windows_executed": False}
    (a / (archive.name + ".sha256")).write_text(result["sha256"] + "  " + archive.name + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
