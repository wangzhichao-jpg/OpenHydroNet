"""Versioned projects, atomic writes and explicit format rejection."""
from __future__ import annotations
import copy
import json
import os
import tempfile
from pathlib import Path
from .validation import validate, ModelError


class ProjectError(ValueError):
    pass


def check_project(data, *, check_model=False):
    if not isinstance(data, dict) or data.get("format") != "openhydronet":
        raise ProjectError("不是 OpenHydroNet 工程文件")
    version = data.get("schema_version")
    if type(version) is not int or version != 1:
        raise ProjectError(f"不支持的工程版本 {version}；本版本仅支持 schema_version=1，不会猜测转换")
    if not isinstance(data.get("model"), dict):
        raise ProjectError("工程缺少物理模型")
    for key in ("nodes", "edges"):
        if not isinstance(data["model"].get(key), list) or not all(isinstance(x,dict) for x in data["model"][key]):
            raise ProjectError(f"model.{key} 必须是对象数组")
    if not isinstance(data.get("layout", {}), dict) or not isinstance(data.get("scenarios", []), list):
        raise ProjectError("布局或工况字段类型错误")
    # JSON roundtrip also rejects nonfinite inputs before any save or computation.
    try:
        json.dumps(data, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ProjectError("工程包含不支持的数据或非有限数") from exc
    if check_model:
        issues = validate(data["model"])
        if issues:
            raise ModelError(issues)
    return data


def load_project(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"), parse_constant=lambda x: (_ for _ in ()).throw(ProjectError(f"非法数值 {x}")))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ProjectError("工程不是有效 UTF-8 JSON；请尝试恢复草稿或备份") from exc
    return check_project(data)


def save_project(path, project):
    check_project(project)
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(project, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    # Same-directory replacement is atomic on supported local filesystems.
    fd, temporary = tempfile.mkstemp(prefix=f".{p.name}.", suffix=".tmp", dir=p.parent)
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            f.write(payload); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, p)
        if os.name != "nt":
            dfd = os.open(p.parent, os.O_DIRECTORY)
            try: os.fsync(dfd)
            finally: os.close(dfd)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    return str(p)


def migrate(data):
    """Version 1 is the first public schema; no fictional legacy migration."""
    return check_project(copy.deepcopy(data))
