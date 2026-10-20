# 视频素材来源与许可

软件/脚本基线：0.1.0-preview.1，软件提交 `003b2446ae1b4efe26de0cea680fe80d7ed69ef5`。

|素材/工具|实际来源与版本|用途及许可边界|
|---|---|---|
|主体画面|本项目实际 Electron 44.9.1 + Python 内核运行，公开教学工程|原创软件画面，非设计稿；项目 Apache-2.0，界面保留 React Flow attribution|
|工程|`examples/closed-loop.ohn.json`|本项目人工构造，无真实工程/厂家资料|
|旁白稿/字幕/分镜|`media/storyboards.json`、两份 narration.md、实际 SRT|本项目独立撰写，Apache-2.0；明确开发预览和未发布状态|
|配音|系统 eSpeak NG cmn，libespeak-ng1/espeak-ng-data 1.51+dfsg-12build1|离线中文合成，不克隆任何个人声音；工具 GPL-3.0-or-later，不随软件/视频包分发其二进制，原创文本输出音频随项目提供|
|字体|系统 fonts-noto-cjk 1:20230817+repack1-3，Noto Sans CJK SC|SIL Open Font License 1.1；仅渲染到画面，不在软件中额外嵌入字体文件|
|编码/字幕|系统 FFmpeg 6.1.1-3ubuntu5，启用 libx264/AAC/libass|本地制作工具，工具本体不打入产品。保留脚本，不将工具 GPL/LGPL 授权混同本项目源代码许可；H.264 的地区专利适用性需按实际分发地区另行评估|
|鼠标提示|录制脚本注入的橙色圆环|原创简单样式，只标示操作位置，不伪造软件能力|
|背景音乐/人物/摄影素材|未使用|不存在付费素材或未经授权肖像|

没有调用付费配音、云渲染或图像服务，没有上传用户真实工程。系统保存对话框在自动录制中使用预设公开输出位置，旁白明确说明；实际 IPC 仍真实写入文件。

官方下载/许可参考：
- eSpeak NG：`https://github.com/espeak-ng/espeak-ng`
- Noto CJK：`https://github.com/notofonts/noto-cjk`
- FFmpeg：`https://ffmpeg.org/legal.html`

以上是来源记录，不声称已在 GitHub/Gitee 的最终公开 README 中验证所有观看入口；当前没有实际视频上传地址，也没有制作指向未发布地址的二维码。
