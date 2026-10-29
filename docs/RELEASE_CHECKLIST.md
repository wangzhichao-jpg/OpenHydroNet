# 双平台免费发布检查单

## 当前状态：preview.5 已公开预发布（2026-10-29）

用户明确批准后，PC 已完成以下发布流程，**不是待批准、待回归或未推送状态**。这是 Pre-release，不是稳定版，也不表示覆盖矩阵 A/B/C 总验收完成。

- 主仓库：[GitHub / wangzhichao-jpg/OpenHydroNet](https://github.com/wangzhichao-jpg/OpenHydroNet)。
- 镜像：[Gitee / bigtaurus/OpenHydroNet](https://gitee.com/bigtaurus/OpenHydroNet)。
- [发布收据](../validation/windows/0.1.0-preview.5/发布记录.md) · [发布校验](../validation/windows/0.1.0-preview.5/发布校验.json) · [Windows 验收记录](../validation/windows/0.1.0-preview.5/验收记录.md) · [版本说明](releases/v0.1.0-preview.5.md)。

## preview.5 已完成项

- [x] 用户明确批准发布（2026-10-29）；回归提交 `2847f27`，发布收据提交 `1a9a5d4`。
- [x] Windows 11 真机自动驱动＋助手截图复核 R1～R4 通过：带下载标记的两次全新解压冷启动、P0-1～P0-8、真实 100/125/150% 缩放、原生对话框标题、PDF、退出进程清理。**不是用户逐项人工验收**。
- [x] 两端既有附注标签 `v0.1.0-preview.5` 对象和提交均未变，提交仍为 `743db0edbd700c8ddc4077b372c2b3c292bcab64`，无强推或历史改写。
- [x] 标签 CI 在 Windows 上组装原 ZIP、随包 Python 求解公开示例并审计通过；发布的是已回归的同一个包。
- [x] GitHub **编辑并发布原草稿** ID 425619943，保留 Pre-release，原 5 附件 ID/大小/摘要未变：[公开页面](https://github.com/wangzhichao-jpg/OpenHydroNet/releases/tag/v0.1.0-preview.5)。
- [x] Gitee 使用既有标签创建发行版 ID 1253849，保留 Pre-release：[公开页面](https://gitee.com/bigtaurus/OpenHydroNet/releases/tag/v0.1.0-preview.5)。
- [x] Gitee 原 ZIP 上传被服务器以单附件 **100 MB** 上限拒绝（HTTP 400）；正文链接 GitHub 原 ZIP 与 SHA-256，另上传 4 个原始小附件，不拆分、不重打包、不替换原包。
- [x] 两端发布正文一致，披露实际 Windows 验证边界和非阻断观察。
- [x] 发布后匿名重下载核验：GitHub **5/5**、Gitee **4/4**，全部大小/摘要与原文件一致。
- [x] preview.4 草稿 ID 425335032 保持原样，未发布、未删；preview.4/preview.5 既有标签不动。

原 ZIP：`OpenHydroNet-0.1.0-preview.5-win-x64.zip`，220,465,515 字节；SHA-256 `6c8fc1c480fa90611ccb02cb6d943c64d0ce50d790c9d22e6d434beff0afecb7`。

## 验证边界与后续事项（不表示本版尚未发布）

- 本版 Windows 10、断网未重做；多屏、长稳、真实崩溃/断电恢复、用户逐项人工验收和真人新手测试仍未完成。不把旧版结果转授本版，不外推到全部 Windows 设备。
- 非阻断观察：启动反馈约 2.6 s 后可见；窗口与任务栏 OH 图标正确，但任务栏分组名称仍为 Electron，EXE 文件图标也仍为默认。
- 覆盖矩阵 A/B/C 未全部完成；仅允许称为开发预览，不称正式稳定版或完整替代品。
- 预览版未代码签名；不要引导关闭 SmartScreen 或杀毒软件。
- 当前版本视频制作、真人试听、公开视频平台/账号与公开上传授权需单独确认；软件发布不代表视频也已发布或获授权。

## 后续版本通用流程

1. SER8 开工前 `git pull --ff-only`；按规范/任务卡/TDD 开发，保持 SI 内核与验证门槛，不改写已推送历史。
2. 每次发行重新检查当前文件、可达历史、示例/素材授权、运行时许可、依赖安全与支持周期；启发式扫描无发现不等于完整人工隐私或外部安全审计。
3. 同步版本号、变更日志、源码提交、构建清单和校验值。先在 main 手动触发 `windows-candidate` 预检，再给同一通过提交打附注标签；通过 `tools/push-remotes.sh <标签>` 同步并核对两端，不移动或覆盖已存在标签。
4. 使用标签 CI 的 Windows 原产物创建草稿，记录包哈希；PC 在该包上回归，如实区分自动驱动、助手截图复核、人工执行与未执行项目。
5. 只有用户明确批准后才由 PC 发布原草稿；附件超过平台限制时链接原包，不擅自拆分或重打包。发布后匿名重下载核验并提交收据。
6. GitHub/Gitee 目标已确认，无需重新索要账号或猜测建库。确需认证时使用本机安全认证，不在对话/日志中写出密码或令牌。视频授权另行确认。

本次仅修正文档状态；不得因更新检查单再次操作现有 Release、附件或标签。
