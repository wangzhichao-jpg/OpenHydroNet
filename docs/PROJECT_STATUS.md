# 项目状态与无损续作入口

当前源码：`0.1.0-preview.2`。**仍不是 A/B/C 总完成、正式发行或全面超过 HACNet。** 原说明书 109 个结构块/10 张图已完整读取；私有资料仍隔离在 `.local/reference/`，公开功能矩阵逐项维护，不复制原软件代码/资源。

## 本轮已经实做

1. 修复 0 ℃、改温后的质量单位参数、过期图标签和跨温度工况比较；每份结果使用自己的密度，缺数据不显示 NaN 或猜测密度。
2. 独立数值编辑器：整数/可选效率/范围校验、无效值阻止操作、Esc 放弃；基准额定转速与实际 rpm 换算。
3. 原生退出文档事务：刷新焦点输入，保存/放弃/取消，取消保存不退出也不停止后端；正式保存/退出/草稿共用结果归属规则，移除旧结果元数据。
4. 原子存储故障注入、严格 UTF-8、启动草稿字节备份、同配置单实例、退出时拒绝晚到草稿/任务。不是断电或 Windows 文件系统总认证。
5. 计算 owner/运行意图隔离：相同输入的旧请求不会附着或取消新工程，取消检查进程退出，服务关闭后不接收新任务。
6. 非模态泵阀库、增改复制删除、来源/基准数据、Q-H 点/系数编辑、拟合图/RMSE/范围/点温度、库 JSON 副本往返。应用复制参数且保留稳定 ID、端点、泵速/台数/阀开度；库删除不破坏网络。
7. CSV/XLSX 现有 ID 参数列/单位映射、原始/变化/错误预览、整体应用和撤销，真实参数/结果 XLSX；不猜拓扑、不执行公式。
8. 高倍标签字级限幅、中文画布辅助标签、移除默认菜单、限制界面 HTTP(S) 到本机。仍无全图智能避让/拖动结果面板。
9. CNKI 并行协作提示词在 `docs/RESEARCH_TASKS_CNKI.md`，A 组完整可重建算例最高优先；新教学库/参数 CSV 在 `examples/`。

## 实际验证

- Python 最近 **72 passed**，含 2 项既有字幕测试；约 5.3 s。核心方程/独立解析门槛未放宽。
- TypeScript 命令/单位/库/文档 **18 passed**，Node 文档/存储 **11 passed**；TypeScript/Vite 构建、Prettier 通过。
- Electron 44.9.1 的五套真实流程：基础闭环、鼠标图编辑/图像、跨温度与原生退出、库/CSV/XLSX、迟到任务/损坏草稿，均通过。截图实际检查；修复过导入层级问题后重新跑通，不用强制点击绕过。
- 新版 npm 审计 **0 已知通告**；国内镜像 audit 返回 404 未实现后才使用官方审计 API，失败尝试保留私有日志。新增 Python 依赖的完整漏洞数据库覆盖未宣称完成。
- 原 25/100/400 节点基准为 preview.1 历史单次数据，数值方法未改变但不把旧时间改称新版性能测量。没有外部求解器交叉验证、现场标定或真实新手测试。

最终实际记录：`artifacts/VALIDATION-0.1.0-preview.2.json`；五套截图/JSON 在 `artifacts/{ui,graph,lifecycle,features,jobs}/0.1.0-preview.2/`。私人原始日志不直接公开。

## 产物与版本归属

- preview.1 原 Windows 候选、源码/文档/示例包、300 s/120 s 视频全部保留原样。其软件/录制基线 `003b2446ae1b4efe26de0cea680fe80d7ed69ef5`，不能说包含本轮改动。
- preview.2 Windows 便携候选已从干净软件提交 `09739362c27b9ac87a4c40e3808ad3b0caf3a0f3` 实际组装，220,320,845 字节，SHA-256 `cb01685e7d13678e97649ae34091a1c43315bb636533d5689ff9f1c09199128f`。输入优先国内镜像、逐项校验，包含 5 个 Python wheel；新增 openpyxl/et-xmlfile/defusedxml 均离线免费。不是 Windows 原生运行结果。
- 新候选命名 `artifacts/OpenHydroNet-0.1.0-preview.2-win-x64.zip`；源码/文档/示例包和校验使用同版本名字，**实际生成状态以 `DELIVERY_INDEX-0.1.0-preview.2.json`、`RELEASE_AUDIT-0.1.0-preview.2.json` 为准**，没有清单则不得仅凭脚本称该集合已核验。软件候选已生成，源码/文档/示例组合交付在本轮文档提交后由交付工具实际核对；以最后的索引为准。
- 构建与交付源码提交分开记录，交付工具检查 src/、desktop/、web/dist/ 与候选逐文件相同，不假装文档补充提交与软件构建提交相同。
- 本机无 Windows/Wine，所有本地 Windows 候选均未原生运行。新版本视频尚未录制；旧视频也未完成人工试听。没有公开仓库、标签、下载/观看链接或二维码。

## 执行入口

```bash
npm run build
npm run desktop
PYTHONPATH=src OPENBLAS_NUM_THREADS=1 python3 -m pytest -q
npm run test:commands
npm run format:check
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:ui
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:graph
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:lifecycle
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:features
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:jobs
# 干净提交/已有对应候选后：
python3 tools/deliver_preview.py
```

新环境按 README 建 venv。Electron 懒下载须先显式 `npm run setup:desktop`，使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。长任务用 systemd 用户任务和锁，日志 `.local/logs/`；重试先确认状态，停止用 `systemctl --user stop UNIT` 并核对进程，不把工具超时当停止。

## 下一步仍要实现

1. B：桌面可及性约束与分析结果、单线映射/供回筛选、子网/注释、完整参数/打印、整网创建式表格导入、独立多泵多源算例。
2. C：有界平衡/能耗优化、扫描/敏感性界面、稳态热输送/混合、明确定义真实状态的控制/热动态；绝不把稳态扫描说成动态或局部失败说成全局不可行。
3. A 质量：更多参数交叉校验/画布组合、密集标签、可调面板、真实崩溃/长稳、高 DPI/Windows 原生验收。详见 KNOWN_LIMITATIONS，不能因新流程通过就全勾完成。
4. 更新/试听视频；用户确认 GitHub/Gitee 和视频位置后才安全发布同版本同标签，并实际验链接/下载。

## 需要用户并行配合，不阻塞其余本地开发

- 有 Windows 10/11 x64 电脑时，按 ACCEPTANCE.md 验证候选的启动、中文路径/高 DPI、计算/导出/取消退出、进程清理，给实际结果。
- 另一个对话可直接执行 RESEARCH_TASKS_CNKI 的 A 组，给全文/页码/参数缺口/许可；资料只放私有 incoming，不改核心代码。
- 公开发布前确认 GitHub/Gitee 账号/组织/仓库及视频目标；用本机安全认证，不在对话发密码/令牌。
