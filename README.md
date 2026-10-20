# OpenHydroNet

**离线、中文、可解释的供热与空调水系统稳态分析工作台。**

> 当前版本：`0.1.0-preview.1`。这是正在开发的开源预览版，**尚未全面覆盖或超过 HACNet**，不应未经独立复核直接用于安全关键设计。OpenHydroNet 是工作名称，尚未完成商标和仓库名称可用性核查。

OpenHydroNet is an offline, open-source hydraulic network workbench with a Chinese desktop interface and an independent Python solver. This is a development preview, not a certified engineering product.

## 当前可以实际做什么

- 从双末端闭式循环示例、最小系统向导或空白画布开始。
- 用端口连线建立拓扑，拖放节点和设备；正交连线、网格吸附、搜索、框选、多选、复制/粘贴、对齐、撤销/重做、管段拆分和插阀。
- 在非模态属性面板编辑管道、泵、Kv 阀和末端，检查连通分量及输入。
- 用独立进程进行等温稳态计算；查看流量、流速、节点表压、水压图和带定位的问题列表。
- 调整泵速/阀位、保存工况快照、比较绝对值/差值/百分比；旧结果自动标记过期。
- 原子保存公开 JSON 工程，恢复草稿，导出 CSV、SVG/PNG；桌面版可输出实际 PDF 计算报告。
- 在 Python API/CLI 中进行单线对称展开、独立稳态扫描、有界局部可行性搜索和有限差分敏感性。上述 API 不代表相应桌面工作流已全部实现。

没有遥测、强制账号、许可证服务器、付费解锁或联网计算要求。启动后不需要外部互联网；进程通信仅使用会话认证的本机回环地址。

## 开发启动（已在 Linux 实际验证）

需要 Python 3.12、Node.js 22 和 npm。已验证 NumPy 2.4.3、SciPy 1.17.1；Node 依赖由 `package-lock.json` 锁定。默认优先国内镜像，保持 TLS 验证。

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple -e . pytest==9.0.2
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm ci --registry=https://registry.npmmirror.com
npm run build
OHN_PYTHON="$PWD/.venv/bin/python" npm run desktop
```

Windows 开发模式用 `py -3.12 -m venv .venv`、`.venv\Scripts\python -m pip ...`，并设置环境变量 `OHN_PYTHON` 为该 Python 的绝对路径。Windows 便携包预期携带运行时，不需要另装 Python；实际运行验收状态请看 `docs/PROJECT_STATUS.md`，不能把组装成功视作 Windows 已验证。

本环境复用已有系统科学计算包时：直接 `npm run build && npm run desktop`。不需要启动额外云服务、CFD 软件或 Docker。

## 独立计算与验证

```bash
PYTHONPATH=src python3 -m openhydronet.cli solve examples/closed-loop.ohn.json -o result.json
PYTHONPATH=src OPENBLAS_NUM_THREADS=1 python3 -m pytest -q
npm run test:commands
# 有图形桌面时直接运行；Linux 无显示器可使用已安装的 Xvfb
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:ui
PYTHONPATH=src python3 tools/benchmark.py
```

```python
from openhydronet import load_project, solve
project = load_project('examples/closed-loop.ohn.json')
result = solve(project['model'])
assert result['status'] == 'converged'
print(result['residuals'], result['input_hash'])
```

## 公开示例：应该看到什么

默认 20 ℃、泵相对转速 1.0 时：循环流量约 **31.178 m³/h**；泵扬程约 **18.499 m**；末端 T1 约 **17.500 m³/h**，T2 约 **13.679 m³/h**。T2 低于设计需求，问题列表应提示它。没有整机效率数据，输入功率应显示“—”，而非猜测值。数值为本实现的回归参考，独立解析验证见验证文档。

## 构建和发布

- Windows x64 组装：`python3 tools/download_windows.py` → `npm run build` → 干净提交后 `python3 tools/build_windows.py`。长下载/构建应按 `docs/BUILD.md` 的 systemd 用户任务和锁方式运行。
- 所有实际产物在 `artifacts/`；不将该目录的测试截图或安装包自动提交到源码仓库。
- GitHub 主仓库/Gitee 镜像位置**尚未由用户确认，也尚未发布**。本 README 不提供虚构下载链接。
- 两条视频的制作、实际输出和审核状态见 [视频交付记录](media/README.md)；在没有有效发布地址前不放下载二维码。

## 文档

- [中文用户手册](docs/USER_MANUAL.md) · [公式与模型](docs/MODELS.md)
- [验证记录](docs/VALIDATION.md) · [功能覆盖矩阵](docs/HACNET_PARITY_MATRIX.md)
- [项目状态与续作入口](docs/PROJECT_STATUS.md) · [架构决策](docs/DECISIONS.md)
- [构建说明](docs/BUILD.md) · [已知限制](docs/KNOWN_LIMITATIONS.md)
- [路线图](docs/ROADMAP.md) · [发布检查](docs/RELEASE_CHECKLIST.md)
- [依赖许可](docs/DEPENDENCIES.md) · [贡献指南](CONTRIBUTING.md)

## 许可与参考资料

项目独立代码和文档使用 [Apache-2.0](LICENSE)。第三方运行时保留自身许可和声明。本项目根据用户提供说明书独立概括功能需求，**不分发原说明书、嵌入截图、原软件代码或品牌素材**，不承诺兼容其未公开工程文件格式。全部示例为人工构造，不包含真实工程机密或未经授权的厂家数据。
