# 任务卡（本地任务跟踪）

规则：按用户可见功能纵向拆分；每张卡有验收标准和 `blocked_by`；一卡一提交，提交信息以卡号开头（如 `T-001: ...`）。
状态：`todo` / `doing` / `done`。可并行 = 依赖已完成且不改同一文件。

## SPEC-001 扫描、敏感性、可及性界面

| 卡 | 标题 | blocked_by | 主要文件 | 状态 |
|---|---|---|---|---|
| [T-001](T-001.md) | 单参数扫描端到端（任务通道 + 分析页 + 结果表） | — | analysis.py, cli.py, server.py, analysis.ts, AnalysisPanel.tsx, ScanView.tsx | done |
| [T-002](T-002.md) | 扫描曲线图与 CSV 导出 | T-001 | ScanView.tsx, LineChart.tsx, analysis.ts | todo |
| [T-003](T-003.md) | 双参数扫描 | T-002 | ScanView.tsx | todo |
| [T-004](T-004.md) | 敏感性分析（多观测量） | T-001 | analysis.py, SensitivityView.tsx | todo |
| [T-005](T-005.md) | 可及性：约束编辑与固定检查 | T-001 | AccessibilityView.tsx | done |
| [T-006](T-006.md) | 可及性：有界局部搜索 | T-005 | AccessibilityView.tsx, analysis.py | done |
| [T-007](T-007.md) | 可行点保存为工况 / 应用到工程 | T-006 | AccessibilityView.tsx, App.tsx | todo |
| [T-008](T-008.md) | 文档、覆盖矩阵、CI 收尾 | T-002..T-007 | docs/, ci.yml | todo |

T-001 完成后，T-002、T-004、T-005 可由不同 agent 在独立 worktree 并行（文件不重叠）。
