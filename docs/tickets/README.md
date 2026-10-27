# 任务卡（本地任务跟踪）

规则：按用户可见功能纵向拆分；每张卡有验收标准和 `blocked_by`；一卡一提交，提交信息以卡号开头（如 `T-001: ...`）。
状态：`todo` / `doing` / `done`。可并行 = 依赖已完成且不改同一文件。

## SPEC-001 扫描、敏感性、可及性界面

| 卡 | 标题 | blocked_by | 主要文件 | 状态 |
|---|---|---|---|---|
| [T-001](T-001.md) | 单参数扫描端到端（任务通道 + 分析页 + 结果表） | — | analysis.py, cli.py, server.py, analysis.ts, AnalysisPanel.tsx, ScanView.tsx | done |
| [T-002](T-002.md) | 扫描曲线图与 CSV 导出 | T-001 | ScanView.tsx, LineChart.tsx, analysis.ts | done |
| [T-003](T-003.md) | 双参数扫描 | T-002 | ScanView.tsx | done |
| [T-004](T-004.md) | 敏感性分析（调节量 × 观测量矩阵） | T-001 | analysis.py, SensitivityView.tsx | done |
| [T-005](T-005.md) | 可及性：约束编辑与固定检查 | T-001 | AccessibilityView.tsx | done |
| [T-006](T-006.md) | 可及性：有界局部搜索 | T-005 | AccessibilityView.tsx, analysis.py | done |
| [T-007](T-007.md) | 可行点保存为工况 / 应用到工程 | T-006 | AccessibilityView.tsx, App.tsx | done |
| [T-009](T-009.md) | 可及性改进：尽量少调整与设定精度 | T-007 | analysis.py, AccessibilityView.tsx | done |
| [T-008](T-008.md) | 文档、覆盖矩阵、CI 收尾 | T-002..T-007 | docs/, ci.yml | done |
| [T-010](T-010.md) | 分析模块整理（深模块化，纯重构） | T-008 | AnalysisPanel 相关、analysis.py | done |

SPEC-001 及后续重构 T-010 已完成（2026-10-26）。

## SPEC-002 水力平衡辅助

| 卡 | 标题 | blocked_by | 主要文件 | 状态 |
|---|---|---|---|---|
| [T-011](T-011.md) | 平衡内核：配对、流量设定法、最低泵速、取整验证 | — | balancing.py, analysis.py | done |
| [T-012](T-012.md) | 水力平衡子页 | T-011 | BalanceView.tsx, balance.ts | done |
| [T-013](T-013.md) | 保存为工况 / 应用 | T-012 | BalanceResult.tsx, App.tsx | done |
| [T-014](T-014.md) | 文档、矩阵、收尾审查 | T-013 | docs/ | done |

## preview.5：preview.4 Windows 验收问题修复

| 卡 | 标题 | blocked_by | 主要文件 | 状态 |
|---|---|---|---|---|
| [T-022](T-022.md) | 记录 preview.4 Windows 验收结果 | — | docs/ | done |
| [T-015](T-015.md) | W4-06 首次冷启动超时（阻断） | — | desktop/main.cjs, backend-launcher.cjs, startup.html | done |
| [T-016](T-016.md) | W4-07 中文对话框标题与窗口图标 | T-015 | desktop/ | done |
| [T-017](T-017.md) | W4-05 运行按钮不可见 | — | workspaces.css | done |
| [T-018](T-018.md) | W4-01 撤销后状态栏仍显示过期 | — | App.tsx | todo |
| [T-019](T-019.md) | W4-02 功率显示精度不一致 | — | App.tsx, BalanceResult.tsx | todo |
| [T-020](T-020.md) | W4-03 PDF 假设与验证可读性 | — | export.py | todo |
| [T-021](T-021.md) | W4-04 未签名提示与 SHA-256 说明 | — | build_windows.py, USER_MANUAL | todo |
