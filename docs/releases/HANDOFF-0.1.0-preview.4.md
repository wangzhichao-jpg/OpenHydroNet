# 0.1.0-preview.4 交接：SER8 → PC

按 ADR-009：SER8 完成代码、测试、版本号、标签与 CI 候选包；**Windows 真机验收、视频、Release 附件与网盘分发由 PC 完成**。PC 开工前先 `git pull --ff-only`，不要改写已推送历史或移动标签。

## SER8 已完成
| 项目 | 状态 / 值 |
|---|---|
| 版本号 | `0.1.0-preview.4`（package.json、package-lock、version.py、pyproject `0.1.0.dev4`、CITATION） |
| 标签 | `v0.1.0-preview.4`（附注标签），GitHub 与 Gitee 指向同一提交：见下方“候选包记录” |
| 测试 | Python 180、TS 52 + Node 11、6 套真实 Electron（Linux）；CI 同一提交 Ubuntu/Windows 全部通过 |
| 依赖审计 | npm audit 0；pip-audit（OSV）0（2026-10-27） |
| 发布说明 | [`v0.1.0-preview.4.md`](v0.1.0-preview.4.md)（中英，直接粘贴为两个平台 Release 正文） |
| Windows 候选包 | 标签触发 CI 任务 `windows-candidate` 在 Windows 上组装、随包 Python 求解公开示例、结构/隐私审计；产物名 `Windows-portable-candidate` |

## 候选包记录（2026-10-27）
| 项目 | 值 |
|---|---|
| 标签提交 | `fe8877876391b74ea6eeff43da6a87ebbcc0c097`（GitHub、Gitee 的 `v0.1.0-preview.4` 均已核对指向此提交） |
| SER8 本地组装（Linux） | `OpenHydroNet-0.1.0-preview.4-win-x64.zip`，220,399,409 字节，2,875 个文件，SHA-256 `53cb156364a931392cace7297f305a77e2d51b9f409e37f668cfeedd4d12ebe8`；`release_audit.py` 零问题（CRC、PE 头、必需文件、LICENSE、无私有资料）。未在 Windows 上运行。 |
| 依赖历史扫描 | 全部 71 个可达提交无凭据/私钥/私人路径迹象（启发式） |
| 标签 CI 运行 | [40480669800](https://github.com/wangzhichao-jpg/OpenHydroNet/actions/runs/40480669800)：**失败，非代码问题**。Ubuntu 真实界面测试截欢迎页时托管显示器偶发报 “Unable to capture screenshot”，Windows 测试随之被取消，`windows-candidate` 未运行。同一提交在 main 上的运行 40480656811 全部通过。截图重试已在 main 修复（不影响标签）。 |

| 构建流程修复后的 CI 验证 | 手动触发运行 [40486411710](https://github.com/wangzhichao-jpg/OpenHydroNet/actions/runs/40486411710)（main `9e491ab`）：Ubuntu/Windows 测试与 `windows-candidate` 全部通过。修复两处：`artifacts/` 在全新检出中不存在（`build_windows.py` 首次在 CI 运行即失败）；境外机器访问清华镜像超时（改为国内源优先、官方源备用）。 |
| Windows 上随包运行时实测 | 上述运行中，便携包内的 Python 在 Windows Server 上求解公开示例：converged，T2 = 13.679 m³/h，泵扬程 18.499 m，与 Linux 一致。CI 包 SHA-256 `f506fc510c89e66616cb0070b66fd0515f4f5b0ee27bbb3c4f2f2b01bfff86d4`，审计零问题。 |
| CI 包与标签包对比 | 2,875 个文件中仅 4 个不同：`BUILD_MANIFEST.json`（commit、assembly_host）、本交接文档、`python312._pth` 与 `开始使用.txt`（仅 Windows 写出的 CRLF 换行）。`src/`、`web/`、`desktop/`、`examples/` 逐字节相同。 |

**说明**：两处组装的 ZIP 字节不会完全相同——源文件因 `.gitattributes` 一致，但 `BUILD_MANIFEST.json` 记录组装主机（`linux` / `win32`）。**Release 附件请用 CI 在 Windows 上组装并做过随包求解的那份**，以它自带的 `.sha256` 为准；SER8 本地包仅作对照。

## PC 待办
### 1. 获取候选包（方案待用户选定）
- **方案 A（推荐）**：附件用 SER8 本地组装的标签包（构建清单 commit = 标签 `fe88778`）。应用代码与 CI 在 Windows 上实测过的包逐字节相同。由 SER8 建草稿 Release 并上传，PC 核对 SHA-256 `53cb1563…12ebe8` 后发布。
- **方案 B**：作废 preview.4 标签，以修复后的 main 发 preview.5，全程用 CI 包。
- 不要再重跑标签 `v0.1.0-preview.4` 的 CI：标签提交含已修复的构建 bug，重跑必然失败。

### 2. Windows 真机验收（新版，不继承旧结论）
在中文路径下解压，记录 Windows 版本、显示缩放、是否断网。每项记“通过 / 失败（截图）/ 跳过（原因）”。

**P0**
- [ ] 双击 `验证计算.cmd` 显示 SUCCESS；启动 `OpenHydroNet.exe`，打开公开示例，计算通过。
- [ ] 分析 → 参数扫描：PU1 泵速 0.6–1.4、5 点 → 表格 5 行、T2 单调上升；曲线显示；导出 CSV 到中文路径并用 Excel 打开无乱码。
- [ ] 参数扫描 1000 点运行中点“取消分析”→ 任务管理器中无残留 `python.exe`。
- [ ] 敏感性：默认设置 → 两个观测量的“影响最大”均为循环泵相对转速。
- [ ] 可及性：勾选泵速与两阀 → 建议泵速 1.06；“应用到当前工程”后 Ctrl+Z 恢复。
- [ ] 水力平衡：泵速参与 → 最不利环路用户末端 2、泵速 0.98、调节阀 1 开度 0.22；“保存为工况快照”后在工况对比页可见“平衡方案 1”。
- [ ] 分析运行中直接关闭窗口（选择放弃）→ 程序退出且无残留 `python.exe`。
- [ ] 保存工程 → 重新打开 → 计算结果一致；导出 PDF 成功。

**P1**
- [ ] 100% / 125% / 150% 缩放下分析页四个子页的表单与结果不重叠、按钮可见。
- [ ] 断网（拔网线/飞行模式）下完成上述 P0 流程。
- [ ] Windows 10 一台（如有）。

### 3. 视频（PC 端）
现有 preview.3 视频不包含分析与水力平衡。建议新增一条 2–3 分钟演示：扫描曲线 → 可及性“1.135 → 1.051 → 1.06”的三步说明 → 水力平衡降速节能并保存为方案。媒体按版本目录存放，不覆盖旧版。

### 4. 发布
1. GitHub：Releases → Draft new release → 选择已存在标签 `v0.1.0-preview.4`（不要新建标签）→ 勾选 **Pre-release** → 正文粘贴发布说明 → 上传 ZIP、`.sha256`、`WINDOWS_BUILD_MANIFEST-0.1.0-preview.4.json`。
2. Gitee：发行版 → 同一标签 → 同一正文。上传前查看附件大小上限；ZIP 约 220 MB，超限时正文中给出 GitHub 下载地址与 SHA-256，不另行改包。
3. 下载两端附件并重新核对 SHA-256；在正文末尾注明 Windows 真机验收状态（完成/部分/未做）。
4. 视频与网盘按原流程。

### 5. 回传给 SER8
把验收结果（每项状态、截图、系统信息）放入 `validation/windows/0.1.0-preview.4/` 提交，或在对话中告知。SER8 据此更新 `KNOWN_LIMITATIONS`、`PROJECT_STATUS` 与覆盖矩阵，并修复发现的问题（修复走 preview.5，不移动 preview.4 标签）。
