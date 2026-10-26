# OpenHydroNet

**离线、中文、可解释的供热与空调水系统稳态分析工作台。**

> 当前版本：`0.1.0-preview.3`。本项目正处于功能持续演进的开源预览阶段，提供开箱即用的离线水力计算、拓扑建模与工况对比能力，适合方案比选、教学科研与工程辅助设计。在安全关键或实际工程设计中，建议结合工程规范独立复核。

OpenHydroNet is an offline, open-source hydraulic network workbench featuring a desktop GUI and an independent Python solver. It is designed for steady-state analysis, equipment matching, and scenario comparison of heating and cooling water networks.

## 当前可以实际做什么

- 从双末端闭式循环示例、最小系统向导或空白画布开始。
- 用端口连线建立拓扑，拖放节点和设备；正交连线、网格吸附、搜索、框选、多选、复制/粘贴、对齐、撤销/重做、管段拆分和插阀。
- 在非模态属性面板编辑管道、泵、Kv 阀和末端，检查连通分量及输入。
- 用独立进程进行等温稳态计算；查看流量、流速、节点表压、水压图和带定位的问题列表。
- 调整泵速/阀位、保存工况快照、比较绝对值/差值/百分比；旧结果自动标记过期。
- 原子保存公开 JSON 工程，退出保存/放弃/取消和恢复字节备份；导出 CSV、SVG/PNG、真实 XLSX，桌面可输出 PDF。
- 管理工程自带泵阀库，拟合二/三次 Q-H 曲线、记录来源/RMSE/区间；应用数据副本而不破坏设备 ID、连接和运行设置。
- 对已有节点/设备进行 CSV/XLSX 列/单位映射、变化与错误预览、整体应用/撤销；不猜测拓扑。跨温度质量流量比较使用各工况各自密度。
- 在 Python API/CLI 中进行单线对称展开、独立稳态扫描、有界局部可行性搜索和有限差分敏感性。上述 API 不代表相应桌面工作流已全部实现。

没有遥测、强制账号、许可证服务器、付费解锁或联网计算要求。启动后不需要外部互联网；进程通信仅使用会话认证的本机回环地址。

## preview.3 修复与验收状态

- 高阻比网络使用稀疏牛顿/回溯与 TRF 回退；有符号损失和物理残差门槛不变。新增独立自建解析回归，不将论文结果反算 R 当作现场精度验证。
- 修复 Windows 反馈中的 PDF 空值和过期状态文案。[preview.2 Windows 条件验收回执](docs/WINDOWS_FEEDBACK_PREVIEW2.md)：10 项 P0、5 项 P1 通过，但真实断网、部分 DPI 档位等仍未完成；新版不自动继承旧版结论。
- 新版 120/300 s 视频已实际重录：神经中文、逐句时间轴、最终音轨回识别/响度/整片解码通过，已交用户百度网盘；真人试听仍待确认。详见视频交付记录，历史包和视频不覆盖。

## 界面效果

![桌面工作台：公开示例的实际计算与分析结果](docs/images/workbench-preview-2.png)

上图为桌面工作台在公开示例下的实际计算与交互界面截图。另见 [设备库曲线拟合](docs/images/library-preview-2.png) 和 [参数映射导入](docs/images/import-preview-2.png)。

## 开发启动（已在 Linux 实际验证）

需要 Python 3.12、Node.js 22 和 npm。已验证 NumPy 2.4.3、SciPy 1.17.1、openpyxl 3.1.5；Node 依赖由 `package-lock.json` 锁定。默认优先国内镜像，保持 TLS 验证。

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple -e . pytest==9.0.2
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm ci --registry=https://registry.npmmirror.com
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run setup:desktop
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
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:features
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:lifecycle
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:jobs
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

- 源码仓库：[GitHub](https://github.com/wangzhichao-jpg/OpenHydroNet) ｜ [Gitee 镜像](https://gitee.com/bigtaurus/OpenHydroNet)。
- Windows x64 便携包构建：`python tools/download_windows.py` → `npm run build` → `python tools/build_windows.py`（构建细节见 [构建说明](docs/BUILD.md)）。
- 所有打包构建产物输出至 `artifacts/` 目录。
- 功能演示与操作说明视频参见 [媒体与视频记录](media/README.md)。

## 文档

- [中文用户手册](docs/USER_MANUAL.md) · [设备库/曲线/表格导入](docs/LIBRARY_TABLES.md) · [公式与模型](docs/MODELS.md)
- [可直接委派的 CNKI 检索任务](docs/RESEARCH_TASKS_CNKI.md)：优先找可重建的完整水力网络算例，不编造缺失参数。
- [验证记录](docs/VALIDATION.md) · [功能覆盖矩阵](docs/HACNET_PARITY_MATRIX.md)
- [项目状态与续作入口](docs/PROJECT_STATUS.md) · [本次实际交付审计](docs/DELIVERY_AUDIT.md) · [架构决策](docs/DECISIONS.md)
- [构建说明](docs/BUILD.md) · [已知限制](docs/KNOWN_LIMITATIONS.md)
- [路线图](docs/ROADMAP.md) · [发布检查](docs/RELEASE_CHECKLIST.md)
- [依赖许可](docs/DEPENDENCIES.md) · [贡献指南](CONTRIBUTING.md)

## 作者与引用

项目负责人：[王智超](https://github.com/wangzhichao-jpg)（ORCID [0000-0001-6662-835X](https://orcid.org/0000-0001-6662-835X)）。

在论文或工程报告中使用本软件，请按 [CITATION.cff](CITATION.cff) 引用（GitHub 页面右侧 **Cite this repository** 可直接导出 BibTeX/APA）。如果对你有帮助，欢迎在 GitHub 或 [Gitee](https://gitee.com/bigtaurus/OpenHydroNet) 点 Star，方便更多同行找到它。问题反馈与公开数据交流请提 [Issue](https://github.com/wangzhichao-jpg/OpenHydroNet/issues)。

### Author and citation

Project lead: [Zhichao Wang](https://github.com/wangzhichao-jpg) (ORCID [0000-0001-6662-835X](https://orcid.org/0000-0001-6662-835X)).

If you use this software in a paper or an engineering report, please cite it as described in [CITATION.cff](CITATION.cff) (the **Cite this repository** button on GitHub exports BibTeX/APA). If it is useful to you, a star on GitHub or [Gitee](https://gitee.com/bigtaurus/OpenHydroNet) helps other engineers find it. Questions, bug reports and discussions: [Issues](https://github.com/wangzhichao-jpg/OpenHydroNet/issues).

## 许可证与声明

项目开源代码和文档采用 [Apache-2.0](LICENSE) 许可证。内置第三方运行时及依赖均遵循其各自开源协议（详见 [依赖说明](docs/DEPENDENCIES.md) 与第三方声明清单）。演示算例与设备性能参数均为独立构造的通用测试与教学数据，不包含任何商业私有或未授权信息。
