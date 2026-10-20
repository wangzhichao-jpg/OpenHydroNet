# 项目执行状态

版本：0.1.0-preview.1（开发预览，不能称为全面覆盖或正式成品）。

## 已实际完成（截至首轮内核测试）
- 完整读取用户说明书正文 109 个 body 结构块及 10 张嵌入截图；没有独立 Word 表格。
- 私有提取物隔离在 `.local/reference/`，不发布原文和截图。
- 建立 H01–H31、X01–X05 覆盖矩阵及 ADR。
- 独立 Python 内核：节点守恒、测压水头、Darcy/Haaland/层流/过渡、两类局阻、直接阻力、泵曲线/变速/同型并联、Kv 阀、定阻末端/理想流控、关闭拓扑和止回互补关系、定压与分量检查、稀疏求解及未缩放残差。
- 开放 JSON 工程 v1、原子保存、版本拒绝、CLI、稳态扫描、局部有界可及性搜索、有限差分敏感性、单线对称展开（后四项为 Python API/CLI，尚不能等同于完成全部桌面工作流）。
- React Flow 中文工作台已构建：模板/向导、属性、结果表/水压图/问题定位、工况快照与比较、撤销重做/拆分/复制等命令、Electron 进程与文件接口。

## 已执行验证
- `PYTHONPATH=src OPENBLAS_NUM_THREADS=1 python3 -m pytest -q`：36 passed（2.38 s）。
- `npm run build`：TypeScript + Vite 成功。
- `npm run test:commands`：7 passed。
- 已启动 systemd 用户任务 `openhydronet-ui-test.service`，运行真实 Electron 界面端到端测试；结果和截图仍待检查，不能先写通过。

## 当前续作入口
工作目录即仓库根目录。
```
systemctl --user show openhydronet-ui-test.service -p ActiveState -p ExecMainStatus
# 用 read 工具检查 .local/logs/ui-test.log
PYTHONPATH=src python3 -m openhydronet.cli solve examples/closed-loop.ohn.json
npm run build
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:ui
```
若用户任务仍在运行，不重复启动。中止必须 `systemctl --user stop UNIT` 并确认进程退出。

## 尚未交付 / 未验证
- 真实界面截图审查与端到端流程结果待检查。
- Windows 实际便携/安装包与 Windows 运行验证未完成。
- GitHub/Gitee 未创建或推送；未确认账号/组织及目标仓库，不能声称已发布。
- 两条正式 MP4 视频尚未制作，不能用脚本替代。
- 设备库完整编辑、Excel 字段映射导入、复杂子网、热量混合/时间状态控制动态、受约束平衡优化等仍未完整实现。
- 用户手册、公式说明、依赖许可证审计、性能实测报告及最终矩阵审计仍在推进。

此状态是断点，不是总项目完成声明。后续应先读取日志、修复真实运行问题，再继续扩展并更新矩阵及验证记录。
