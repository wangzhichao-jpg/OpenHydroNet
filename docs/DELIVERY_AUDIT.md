# 预览交付审计

## preview.2 增量状态

源码已经实现并验证跨温度/退出/任务归属保护、基础泵阀库/曲线和现有 ID 的 CSV/XLSX 参数映射。当前 72 项 Python、18 项前端命令/单位/文档、11 项 Node 文档/存储及五套真实 Electron 流程通过；详见 PROJECT_STATUS 与版本化 VALIDATION 报告。

本轮正在从干净源码提交组装并核对新的实际 Windows 便携候选。只有 `artifacts/DELIVERY_INDEX-0.1.0-preview.2.json` 和对应 SHA256SUMS 出现且检查通过，才视为该文件集合已经生成；不能从本段计划或构建脚本推断完成。软件构建提交与后续仅文档交付提交独立记录，运行时代码必须逐文件相同。

**Windows 原生未验收，preview.2 视频未重录，GitHub/Gitee/视频均未发布，B/C 仍未完成。** 下文是保留的 preview.1 历史审计，不是新版文件清单；不得给旧包/旧视频换上新版标签。

# preview.1 历史基线

## 结论

已经交付一套真实可运行、可计算、可保存重开的离线图形桌面预览，不是只有计划/截图/脚本。**整个项目尚未总验收，A/B/C 未全部完成，不能宣称全面超过 HACNet。**

软件、Windows 候选包与实际录制统一对应 `0.1.0-preview.1`、软件提交 `003b2446ae1b4efe26de0cea680fe80d7ed69ef5`。后续提交仅补充交付审计、字幕后期/QA 和测试，不改变该基线的内核及桌面源代码。

## 文件位置（相对仓库根目录）

|交付物|实际位置|实际状态|
|---|---|---|
|完整工作源代码|src/、web/、desktop/、tests/、tools/|本地 Git 已提交，可继续开发|
|完整交付源码快照|artifacts/OpenHydroNet-0.1.0-preview.1-source.zip|最新交付审计提交；运行时代码与 Windows 包逐文件一致，提交映射见 DELIVERY_INDEX.json|
|Windows x64 便携候选|artifacts/OpenHydroNet-0.1.0-preview.1-win-x64.zip|219,000,809 字节，实际 EXE/运行时，尚无 Windows 原生执行|
|Windows 构建清单|artifacts/WINDOWS_BUILD_MANIFEST.json|来源/输入 SHA-256/软件提交/未执行标志|
|公开示例|examples/closed-loop.ohn.json；artifacts/OpenHydroNet-0.1.0-preview.1-examples.zip|人工构造，无厂家/真实工程数据|
|5 分钟产品介绍|artifacts/media/OpenHydroNet-intro-0.1.0-preview.1.mp4|300.000 秒，10,001,812 字节，真实运行录制|
|2 分钟快速上手|artifacts/media/OpenHydroNet-quickstart-0.1.0-preview.1.mp4|120.000 秒，4,168,292 字节，真实端到端操作|
|独立字幕|artifacts/media/intro.srt、quickstart.srt|51/26 个字幕块，时间递增/不越界，否定语义断句已修正|
|视频可编辑源|media/、tools/record_video.cjs、render_videos.py、tts_local.py、check_media.py；原录屏/配音在 artifacts/media/intro/ 和 quickstart/|源码及原始素材可本地重跑|
|视频技术检查|artifacts/media/MEDIA_QA.json|H.264/AAC、1920×1080、30 fps、音画流等长、全帧解码及 FFplay 样本启动通过；未真人试听|
|中文手册/模型/验证|docs/USER_MANUAL.md、MODELS.md、VALIDATION.md|针对当前已实现范围独立编写|
|参考覆盖与进度|docs/HACNET_PARITY_MATRIX.md、PROJECT_STATUS.md|已逐项标出部分/待实现，不借阶段删减承诺|
|截图/导出验证|artifacts/ui/、artifacts/graph/|真实 Electron 截图、JSON/CSV/PDF/SVG/PNG，不是静态设计稿|
|性能原始记录|artifacts/benchmark.json|25/100/400 节点，单次基准，不是性能上限|
|依赖与许可|requirements.lock、package-lock.json、docs/DEPENDENCIES.md、third_party/|锁定/SRI、来源、第三方声明；包保留原运行时许可|

补充文档包、视频工程包、最终交付索引与 `SHA256SUMS` 在 `artifacts/` 生成；它们是本地交付，不等于公开发布。软件包/录制保留原软件提交；最新交付源码另包含文档/媒体 QA 补充。DELIVERY_INDEX.json 同时记录两者提交，并验证 src/、desktop/ 和当前构建的 web/dist/ 与便携包逐文件字节相同，不把两个提交说成同一个提交。最新审计补充以工作目录和文档包为准。

## 实际执行结果

- Python：42 passed，4.69 s（软件基线 40 项 + 2 项媒体字幕回归）。
- 图编辑命令：7 passed。
- TypeScript/Vite 构建和 Prettier 格式检查通过。
- 两套真实 Electron 44.9.1 E2E 通过：模板计算/改参/工况/文件/PDF，以及真实拖放/端口/反流/单位/复制/图像导出。
- 公开小/中/大网格：0.038/0.295/1.110 s；解析水头误差、守恒/能量残差通过。仅本机特定工况，不能拿来断言比 HACNet 快。
- 完整 npm 审计 0 已知通告；初版旧 Electron 的告警已触发升级和重新验证。静态源码隐私、ZIP CRC、Windows PE 头和必要许可检查通过。
- 视频技术检查和实际抽帧检查通过。**没有真人试听/逐句完整审核，不把无解码错误当作配音质量正式合格。**

## 尚未满足的总验收

1. Windows 原生启动、计算、中文路径/高 DPI、退出清理未实际执行；没有代码签名，不建议未经复核直接用于正式工程。
2. 全功能泵阀库/曲线 UI、桌面单线映射、子网/注释、Excel 映射导入/XLSX、完整可及性 UI、热输送/控制动态/平衡优化等尚未完成。
3. 退出未保存提示、密集标签、高倍缩放、跨温度质量流量属性/对比路径仍需改进和验证，详见最新 KNOWN_LIMITATIONS.md。当前温度改变后应先重新计算；跨温度工况比较先使用 m³/h。
4. GitHub/Gitee **尚未公开发布**。没有仓库 URL、公开标签或下载入口验收；CI 文件存在不代表远端已运行。
5. 视频尚未上传、未生成假二维码；视频平台/账号待用户确认。
6. 只有开发者自动化流程验收，没有真实新手用户测试或第三方工程认证。

## 相对参考说明书已落地的改进方向

- 非模态上下文属性、明确工作流、模板和向导。
- 输入哈希/版本/残差、开放公式和独立解析测试。
- 多定压参考、分量诊断和有语义的失败状态。
- 任务取消、过期结果保护、工况快照/差值、开放 JSON/API/CLI。

上述是本项目可检验的新增工作，不是对参考软件未说明能力作否定，也不构成“全面超越”的宣传结论。

## 发布待用户的最小动作

确认 GitHub 主仓库和 Gitee 镜像的账号/组织及仓库位置；需要时在本机完成安全认证，不在对话发送密码或令牌。视频平台/账号也需确认。没有这些条件，只继续本地开发/准备，不猜测建库、不强推、不声称已发布。
