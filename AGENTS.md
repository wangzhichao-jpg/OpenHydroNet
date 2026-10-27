# AGENTS.md — 给编码 agent 的入口

OpenHydroNet：离线中文供热/空调水系统稳态水力工作台。Python 内核 + React Flow 界面 + Electron 桌面。
术语一律以 [GLOSSARY.md](GLOSSARY.md) 为准；命名变量、函数、文件时使用其中的词。

## 分工（ADR-009）
- 本机 SER8 只做**代码开发**：内核、界面、测试、规范与任务卡。
- 视频、配音、宣传、网盘交付、Windows 打包分发在用户 PC 端完成。不要在 SER8 上新增媒体/交付工作。

## 常用命令
```bash
PYTHONPATH=src OPENBLAS_NUM_THREADS=1 python3 -m pytest -q       # 内核/协议，约 4 s
npm run test:commands                                            # TS 单元 + Node 存储
npm run build && npm run format:check
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:ui          # 另有 graph/lifecycle/features/jobs/analysis/startup（startup 仅 Linux）
```
每套 E2E 单独启动真实 Electron；不要并行跑两套（共享端口/配置目录）。

## 目录
- `src/openhydronet/`：SI 内核。`solver.py` 求解，`analysis.py` 扫描/敏感性/可及性，`server.py` 本机协议，`cli.py` 子进程入口。
- `web/src/`：界面。`App.tsx` 是历史单体（约 2100 行）——**新功能写成独立模块/组件**，只在 App 中挂载，不要继续加大它。
- 分析页（SPEC-001）：`analysis.ts` 纯函数（换算/请求/表格/CSV，均有单元测试）；`useAnalysisJob.ts` 的 `useFrozenAnalysis`（任务 + 冻结模型 + 过期）；`AnalysisStatus.tsx`（进度/取消/错误/过期）；子页 `ScanView`+`ScanResult`+`RangeFields`、`SensitivityView`、`AccessibilityView`+`ConstraintEditor`+`SearchVariablesEditor`+`AccessibilityResult`。内核入口 `analysis.check_request` / `run_request` 按 kind 分派到 `_check_*` / `_run_*`。
- `tests/`：`test_*.py` 内核，`*.test.cjs`/`web/src/*.test.ts` 单元，`ui.*.cjs` 真实 Electron E2E。
- `docs/specs/` 规范，`docs/tickets/` 任务卡（本地任务跟踪），`docs/DECISIONS.md` ADR。

## 工作流
1. 需求先追问澄清（只问需要用户取舍的问题），结论写入 GLOSSARY/ADR。
2. 写规范 `docs/specs/SPEC-NNN-*.md`：做什么、不做什么、完成标准。
3. 拆任务卡 `docs/tickets/`：按用户可见功能纵向拆，写验收标准与 `blocked_by`。
4. 每张卡 TDD：先写失败测试再实现；一卡一提交，提交信息引用卡号。
5. 完成后两路审查：代码规范 / 对照规范逐条核对，分开做。
6. 一个阶段结束做复盘，把绕路和重复错误写回本文件。

## 硬性规则
- 内核全部 SI（m、s、m³/s、Pa）；显示单位只在界面换算。
- 不得为了让测试通过而修改输入、放宽残差门槛或伪造数据；局部搜索失败只能报“未确定”，不能报“不可行”。
- 新结论要有测试入口；未实现的不写“完成”。覆盖矩阵状态只能如实升级。
- 不提交 `.local/`、`artifacts/`、参考说明书原文、CNKI 全文、凭据。
- 下载优先国内镜像（pip 清华、npm npmmirror），保持 TLS 校验；长任务用 systemd 用户任务 + `.local/*.lock`。
- 远程：`origin`=GitHub（HTTPS），`gitee`=Gitee（SSH 别名 `gitee-ohn`）。两端保持同一提交。
- 发版：先在 main 手动触发 CI 预检 `windows-candidate` → 通过后对同一提交打附注标签并 `tools/push-remotes.sh <标签>` → 用标签 CI 产物经 `tools/draft_release.py` 建草稿（不发布，发布由 PC 在 Windows 回归后完成）。
- 推送一律用 `tools/push-remotes.sh`（仅快进、自动重试、推送后用 ls-remote 核对两端 HEAD）。
- **不改写已推送的历史**（禁止对 main 变基、改作者后强推）。PC 与 SER8 开工前先 `git pull --ff-only`，只做快进推送；作者统一为 `wangzhichao-jpg <wangzhichao@chinaibee.com>`。
- README 双语：`README.md` 英文（GitHub 默认），`README.zh-CN.md` 中文；改动功能说明时两份同步。

## 复盘记录（持续追加）
- 2026-10-27 preview.5：发版前在 main 手动触发候选包流程，抓到 CI 上才出现的 E2E 竞态（点“退出”后程序先于点击确认关闭）——先预检再打标签的做法再次避免了废标签。会关闭应用的点击只容忍“已关闭”错误，退出与否另行断言。
- 2026-10-27 preview.4：从未运行过的 CI 任务首跑即暴露 bug（`artifacts/` 在全新检出中不存在）；GitHub 境外机器访问清华镜像超时 → 发版前先手动触发一次候选包流程；CI 与 `download_windows.py` 均为“国内源优先、官方源备用”，版本锁定与校验不变。
- 2026-10-27 preview.4：标签 CI 因托管 Xvfb 偶发截图失败而整体失败，SER8 的 token 无 Actions 权限无法重跑 → E2E 截图统一用 `tests/e2e-util.cjs` 的 `shot`（有限重试）；建议给 token 增加 Actions 读写。另：曾误称 CI 与本地组装包字节一致，实际 BUILD_MANIFEST 含组装主机，结论须先核对再写。
- 2026-10-26 T-013：GitHub 推送偶发失败，但命令只打印 `tail -1` 且未检查退出码，几乎漏掉 → 新增 `tools/push-remotes.sh`，推送后核对远程 HEAD。
- 2026-10-26 T-003：Playwright `getByText` 也会匹配 SVG `<title>` 提示文字，导致多重匹配 → 在具体容器内定位并用 `{ exact: true }`。
- 2026-10-26 T-002：新组件的 CSS 类名 `.legend` 与已有画布色标重名，图例跑到窗口右上角且测试未发现 → 新样式类名用功能前缀（如 `scan-`、`analysis-`），新增可见元素都加 `inPanelView` 位置断言。
- 2026-10-26 T-006：用脚本按字符串替换代码时，prettier 已改过换行，导致匹配失败、补丁未生效，但后续测试仍通过（跑的是旧代码），已发生两次 → 改代码优先用精确编辑工具；脚本替换必须在失败时中止后续命令（`set -e` / `&&`）。
- 2026-10-26 T-005：Playwright `getByLabel` 默认子串匹配，会同时命中“删除约束 …”按钮 → 输入框定位用 `{ exact: true }`。显示单位下的可编辑值一律按 SI 存储。
- 2026-10-26 推送：PC 端两次改写已推送历史（改作者），SER8 新提交两次需变基 → 增加“不改写已推送历史”约定。公开仓库上用 `git ls-remote` 不能验证凭据，改用带 token 的 API 请求。
- 2026-10-26 T-001：Playwright 的“可见”不检查滚动位置，界面溢出曾漏检 → E2E 用 `inPanelView` 断言关键元素在面板视口内，并查看截图。
- 2026-10-26：媒体/交付收据曾占用约一半提交，产品缺口停滞 → 已移交 PC 端。大提交（>3000 行）难审查 → 一卡一提交。
