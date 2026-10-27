# OpenHydroNet

[ **English** | [简体中文](README.zh-CN.md) ]

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Python: >=3.12](https://img.shields.io/badge/Python->=3.12-brightgreen.svg)](pyproject.toml)
[![GitHub Repo](https://img.shields.io/badge/GitHub-OpenHydroNet-181717?logo=github)](https://github.com/wangzhichao-jpg/OpenHydroNet)
[![Gitee Mirror](https://img.shields.io/badge/Gitee-OpenHydroNet-C71D23?logo=gitee)](https://gitee.com/bigtaurus/OpenHydroNet)

**An offline, interpretable steady-state analysis workbench for district heating and HVAC hydronic networks.**

> **Current Version**: `0.1.0-preview.5`. This open-source preview provides an out-of-the-box offline hydraulic solver, topology modeling canvas, and multi-scenario comparison tools for preliminary scheme design, academic research, and engineering calculations. For mission-critical or final construction documentation, independent engineering review against applicable codes is recommended.

OpenHydroNet is an open-source hydronic network engineering software designed for district heating distribution systems and central air-conditioning chilled/hot water loops. It combines a modern cross-platform desktop graphical user interface (Electron + React Flow) with a robust, physics-transparent Python numerical solver.

Repositories: [GitHub](https://github.com/wangzhichao-jpg/OpenHydroNet) · [Gitee Mirror](https://gitee.com/bigtaurus/OpenHydroNet)

---

## Key Capabilities

- **Interactive Visual Modeling**: Start from scratch, from the built-in dual-terminal closed-loop template, or via the minimal system wizard. Features port-to-port routing, orthogonal snapping, multi-selection, alignment, copy/paste, undo/redo, pipe splitting, and in-line valve insertion.
- **Physical Parameter & Device Editing**: Non-modal inspection panels for real-time editing of pipelines, centrifugal pumps, Kv control valves, and thermal consumer terminals, complete with connectivity validation and boundary checks.
- **Robust Steady-State Numerical Solver**: Runs as an isolated worker process. Employs a sparse Newton-Raphson scheme with norm-residual backtracking and Trust-Region-Reflective (TRF) fallback. Computes branch volumetric/mass flow rates, fluid velocities, nodal pressures, hydraulic gradient profiles, and diagnostic issue lists.
- **Multi-Scenario Comparison**: Adjust pump speeds and valve authority on the fly, take scenario snapshots, and analyze absolute values, deltas, and percentage deviations against baseline conditions.
- **Integrated Equipment Library**: Built-in pump and valve catalog supporting discrete OEM test-point entry, quadratic/cubic $Q-H$ characteristic curve fitting with RMSE reporting, and bounded operational ranges.
- **Tabular Data Mapping & Interoperability**: Bi-directional CSV/Excel mapping for existing nodes and branches with difference preview and rollback. Supports export to open JSON projects, CSV datasets, SVG/PNG schematics, PDF calculation reports, and multi-tab XLSX workbooks.
- **Analysis Workspace** *(first released in 0.1.0-preview.5)*: One- and two-parameter steady sweeps with charts and CSV export, a sensitivity matrix ranking which pump/valve adjustment matters most, and hydraulic accessibility — constraint checks plus a bounded local search that adjusts as little as possible and rounds to settable precision — and hydraulic balancing by the designated-flow method (balancing-valve openings, lowest pump speed, index circuit, verified by a real solve). Local search results carry no global guarantee.
- **Scriptable Python Core & CLI**: Automated single-line expansion, batch parameter sweeps, bounded local feasibility searches, and finite-difference sensitivity analysis.
- **Privacy-First & Fully Offline**: No telemetry, no mandatory cloud accounts, and no license servers. Computations run entirely on your local machine with communication strictly bound to authenticated loopback sockets.

---

## Desktop GUI Showcase

![OpenHydroNet Desktop Workbench: Steady-State Hydronic Analysis](docs/images/workbench-preview-2.png)

*The desktop interface displaying solved flow rates, pressure distribution, and diagnostic alerts on the benchmark closed-loop model.*  
See also: [Pump Curve Fitting](docs/images/library-preview-2.png) and [Tabular Parameter Mapping](docs/images/import-preview-2.png).

---

## Getting Started

### Prerequisites

- **Python**: `>= 3.12` (with scientific packages NumPy, SciPy, openpyxl)
- **Node.js**: `>= 22` and **npm**

### Local Development Setup

```bash
# 1. Clone repository
git clone https://github.com/wangzhichao-jpg/OpenHydroNet.git
cd OpenHydroNet

# 2. Setup Python virtual environment
python3 -m venv .venv
.venv/bin/python -m pip install -e . pytest==9.0.2

# 3. Setup frontend dependencies and build
npm ci
npm run setup:desktop
npm run build

# 4. Launch the desktop application
OHN_PYTHON="$PWD/.venv/bin/python" npm run desktop
```

*For Windows development, create a venv using `py -3.12 -m venv .venv` and point the `OHN_PYTHON` environment variable to `.venv\Scripts\python.exe`.*

---

## Python API & CLI Usage

### Command-Line Interface

```bash
# Solve a project file and output results as JSON
python -m openhydronet.cli solve examples/closed-loop.ohn.json -o result.json

# Run test suite & benchmarks
OPENBLAS_NUM_THREADS=1 pytest -q
npm run test:commands
npm run test:ui
python tools/benchmark.py
```

### Scripting with Python

```python
from openhydronet import load_project, solve

# Load standard JSON project
project = load_project("examples/closed-loop.ohn.json")

# Execute isothermal steady-state simulation
result = solve(project["model"])

assert result["status"] == "converged"
print("Max mass & energy residuals:", result["residuals"])
for branch_id, metrics in result["branches"].items():
    print(f"Branch {branch_id}: Flow = {metrics['flow_rate_m3_h']:.3f} m³/h")
```

---

## Benchmark Reference (Closed-Loop Model)

Under standard water conditions (20 °C) with pump speed ratio 1.0:
- **Total Loop Flow**: ~**31.178 m³/h**
- **Pump Developed Head**: ~**18.499 m**
- **Terminal T1 Branch Flow**: ~**17.500 m³/h**
- **Terminal T2 Branch Flow**: ~**13.679 m³/h** *(triggers a low-flow warning in the diagnostic panel as it is below the design target)*

---

## Build & Distribution

- Source Repositories: [GitHub](https://github.com/wangzhichao-jpg/OpenHydroNet) | [Gitee Mirror](https://gitee.com/bigtaurus/OpenHydroNet)
- For standalone Windows x64 portable package assembly instructions, see [Build Documentation](docs/BUILD.md).
- Video tutorials and feature demonstrations are cataloged in [Media & Video Records](media/README.md).

---

## Documentation

- [User Manual (Chinese)](docs/USER_MANUAL.md) · [Device Library & Table Mapping](docs/LIBRARY_TABLES.md) · [Physical Models & Numerical Formulations](docs/MODELS.md)
- [Validation & Verification Baselines](docs/VALIDATION.md) · [Feature Parity Matrix](docs/HACNET_PARITY_MATRIX.md)
- [Project Status](docs/PROJECT_STATUS.md) · [Architecture Decision Records (ADR)](docs/DECISIONS.md) · [Known Limitations](docs/KNOWN_LIMITATIONS.md)
- [Roadmap](docs/ROADMAP.md) · [Dependencies & Licenses](docs/DEPENDENCIES.md) · [Contributing Guide](CONTRIBUTING.md)

---

## Author and Citation

Project Lead: [Zhichao Wang](https://github.com/wangzhichao-jpg) (ORCID: [0000-0001-6662-835X](https://orcid.org/0000-0001-6662-835X)), Jianke Huanneng Technology Co., Ltd. (National Air-Conditioning Equipment Quality Inspection Center).  
Contact & Inquiries: [wangzhichao@chinaibee.com](mailto:wangzhichao@chinaibee.com).

If you use this software in an academic paper, thesis, or technical report, please cite it as described in [CITATION.cff](CITATION.cff) (the **Cite this repository** button on the GitHub repository sidebar provides one-click export for BibTeX and APA formats).

If this project is helpful to your research or engineering workflows, a star on GitHub or [Gitee](https://gitee.com/bigtaurus/OpenHydroNet) helps other engineers find it. Bug reports, feature suggestions, and benchmark data discussions are welcome via [GitHub Issues](https://github.com/wangzhichao-jpg/OpenHydroNet/issues).

### 作者与引用

项目负责人：[王智超](https://github.com/wangzhichao-jpg)（ORCID [0000-0001-6662-835X](https://orcid.org/0000-0001-6662-835X)），建科环能科技有限公司（国家空调设备质量检验检测中心）。  
联系邮箱：[wangzhichao@chinaibee.com](mailto:wangzhichao@chinaibee.com)。

---

## License & Notices

OpenHydroNet's original source code and documentation are released under the [Apache-2.0 License](LICENSE). Third-party runtime dependencies (including Electron, NumPy, SciPy, React Flow, etc.) retain their respective open-source licenses (see [Dependencies Audit](docs/DEPENDENCIES.md) and notice files). All included demo models and performance points are synthetic datasets designed for testing and educational purposes.
