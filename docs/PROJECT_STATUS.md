# 项目状态与无损续作入口

版本：`0.1.0-preview.1`。这是可运行开发预览，不是既定 A/B/C 全部完成，也不是已全面超过 HACNet 的正式版。

## 已落实的可运行基线

- 全文读取说明书 109 个结构块及 10 张嵌入截图；Word 原生表格 0。来源证据在 `.local/reference/` 私有隔离，公开索引 `docs/REFERENCE_AUDIT.md`。
- H01–H31、X01–X05 覆盖矩阵已按真实完成度审计；歧义与未明确算法没有伪称还原。
- 独立 Python/SciPy 内核和 CLI：守恒、Darcy、层流/过渡/湍流、局阻/直接阻力、变速/并联泵、Kv 阀、定阻末端/理想流控、止回/关闭、定压/漏补水、稀疏/阻尼/残差。
- React Flow + Electron 中文离线工作台：欢迎/示例/向导、拖放/端口连接、上下文属性、检查/计算/取消/结果过期、着色/表/问题定位/水压图、工况快照/差值/比例、撤销/复制/拆分/插阀/布局。
- 公开工程 v1、JSON Schema、原子保存/草稿、桌面保存重开、CSV/PDF/SVG/PNG 实际导出。
- API：对称单线展开映射、独立稳态扫描、有界局部可及性搜索、中心差分敏感性。专用桌面分析工作流仍不完整。
- 中文 README/手册/模型说明/构建文档、Apache-2.0、依赖清单、贡献/问题模板、CI 配置；CI 尚未在远端执行。

## 实际验证

- `PYTHONPATH=src OPENBLAS_NUM_THREADS=1 python3 -m pytest -q`：**40 passed，4.66 s**。
- `npm run test:commands`：**7 passed**；`npm run format:check` 全部匹配。
- `npm run build`：TypeScript + Vite 6.4.4 成功。
- **Electron 44.9.1** 下 `tests/ui.e2e.cjs`：模板→计算→水压图→改管径/泵速→过期保护→工况对比→实际保存重开→CSV/PDF→拆分撤销通过。
- 同版本 `tests/ui.graph.cjs`：真实鼠标设备拖放、端口连接、反向流动、质量流量单位、复制粘贴/撤销、PNG/SVG 实际文件通过。
- 公开基准 25/100/400 节点：约 0.038/0.295/1.110 s；残差和独立线性水头解析误差通过。机器/内存/误差见 `docs/VALIDATION.md`。
- 完整 `npm audit`（含实际分发的 Electron）：**0 已知通告**。初版 38.2.0 的 7 项告警触发升级；旧包已移入 `.local/superseded-e0a9313/`，不得推荐分发。零通告不等于完整安全保证。
- 静态隐私/包结构审计工具 `tools/release_audit.py` 已建立；最终产物完成后重跑。

## 当前在推进的实际产物

Windows 运行时已从国内镜像下载并校验：Electron 44.9.1、CPython 3.12.10、NumPy 2.4.3、SciPy 1.17.1。下一步按干净提交组装实际 zip；**本环境没有 Windows/Wine，尚未原生运行验收**。

两条视频已有中文分镜/旁白和可复跑本地流程：`media/storyboards.json`、`media/*-narration.md`、`tools/record_video.cjs`、`tools/render_videos.py`。旧录制因安全升级已暂停隔离，下一步从新基线重新录制。仅脚本不算最终 MP4 已交付，实际状态见 `media/README.md` 和构建后的审计补充。

## 精确执行入口

在仓库根目录：
```bash
npm run build
npm run desktop
PYTHONPATH=src python3 -m openhydronet.cli solve examples/closed-loop.ohn.json
PYTHONPATH=src OPENBLAS_NUM_THREADS=1 python3 -m pytest -q
npm run test:commands
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:ui
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:graph
python3 tools/release_audit.py
```

依赖：当前系统 Python 已有锁定科学计算包；其他环境按 README 建虚拟环境。Electron 44 采用懒安装，首次测试前应明确执行 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run setup:desktop`，避免多个任务各自触发下载。

长任务都使用 `systemd-run --user` 与 `.local/*.lock`。日志 `.local/logs/`。重试前检查 `systemctl --user show UNIT -p ActiveState -p ExecMainStatus`，中止必须 `systemctl --user stop UNIT` 并确认退出。不要以工具超时判断进程已停止。

## 不可隐瞒的缺口

1. Windows 原生运行、中文路径/高 DPI、退出未保存确认、崩溃注入和长期稳定性未完成。
2. 完整泵阀库/曲线 UI、桌面单线映射/供回筛选、子网/注释、Excel 映射导入/XLSX、完整桌面可及性未完成。
3. 平衡/能耗优化、稳态热输送混合、带状态控制/热动态未完成。扫描不是动态；水锤/CFD 未实现且非默认范围。
4. 密集/近距离节点在高倍缩放时可能标签重叠；已有缩小时隐藏边标签策略，但没有智能全图避让。底部面板暂不能拖动调整高度。
5. GitHub/Gitee **未发布**；用户最小待确认是两边账号/组织及仓库位置，并在本机完成安全认证，不在对话提供密码/令牌。视频平台/账号也待确认。
6. 当前是自动化流程验收，没有真实新手用户测试，不编造客户、评价或第三方认证。

整个项目仍应持续推进，后续不能因本预览基线可运行而把所有阶段标为完成。
