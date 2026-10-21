# 视频交付、配音重制与复现

## 当前重制：0.1.0-preview.3

用户反馈历史 eSpeak 配音听不清、解说混乱。本轮不是只换字幕：已重写旁白/分镜、改用 Kokoro 中文神经配音，按每句实际 WAV 时长安排字幕，等待实际操作完成后才开始该段解说。模型略慢语速，不做强制波形加速，不截断，不叠加两句人声，不放背景音乐。

源配音的 23 个场景已通过独立回识别初查（逐段字错率 ≤12%，否定词计数一致）。首个 MeloTTS 候选多段不达标，已拒绝使用；换为 Kokoro 后仍改写了一处易混淆否定表达，并重新检查。ASR 的同音误识仍会出现，**它不证明真人已经听清或主观自然度合格**。

实际成片、全帧解码、最终音轨回识别、响度及上传状态，以 `artifacts/media/0.1.0-preview.3/MEDIA_QA.json` 和交付记录为准；只有文件和记录生成后才算完成，当前制作脚本本身不是成片证据。新版输出不覆盖历史目录。

- 快速上手目标：120 s，`OpenHydroNet-quickstart-0.1.0-preview.3-清晰配音.mp4`。
- 产品介绍目标：300 s，`OpenHydroNet-intro-0.1.0-preview.3-清晰配音.mp4`。
- 字幕：同版本目录内 quickstart.srt / intro.srt，另有供烧录的 ASS。
- 画面是 **Linux/Electron 实际运行录制**，页脚明确标注，不冒充 Windows 录屏。
- 产品介绍包含当前设备库/泵性能点拟合、CSV 单位映射预览；两段均使用同一人工教学工程，不含用户真实工程。

## 复现入口

先阅读 [素材来源/许可/固定模型摘要](ASSETS.md)。配音与 ASR 模型是可选制作工具资源，不在 OpenHydroNet 软件运行时中，不需要付费账号。使用隔离环境，不修改全局 pip/npm。

```bash
# 构建、测试并提交干净源码后；模型须先按 ASSETS.md 固定版本/摘要准备。
# 用 systemd 用户任务 + .local/video.lock，禁止重复录制同一任务。
.local/media-venv/bin/python tools/render_videos.py --audio-only --model-dir .local/media-rebuild/kokoro
.local/media-venv/bin/python tools/check_narration.py --clips --model-dir .local/media-rebuild/sensevoice
.local/media-venv/bin/python tools/render_videos.py --model-dir .local/media-rebuild/kokoro
.local/media-venv/bin/python tools/check_narration.py --model-dir .local/media-rebuild/sensevoice
python3 tools/check_media.py
# 只改后期，明确复用同版本实际录屏/逐句 WAV：
.local/media-venv/bin/python tools/render_videos.py --remux
```

约 7 分钟实际录制，另加合成和 QA。检查 systemd 状态后再重试，中止须 stop 对应任务并确认 Electron/FFmpeg/Python 子进程退出。

### 检查的含义

- 每条字幕由对应独立 WAV 的起止生成，不按整段文字长度猜分配；不足场景空间即报错，必须改短旁白或调整分镜。
- 正式录屏必须是干净提交；保留实际动作完成时刻、软件版本、录屏摘要和页面错误。
- 最终 MP4 按场景抽取真实音轨回识别，不仅检查源 WAV。ASR 门槛和识别文本保留，失败不默认为通过。
- 技术 QA 检查一条视频/一条音轨、1080p/H.264/AAC/30 fps、精确时长、字幕有序无重叠、整片解码、约 -16 LUFS 和编码后真峰值；FFplay dummy audio 只验证播放器启动。
- **真人试听、语气自然度、逐句音画感受仍待使用者确认**。没有公开视频平台/账号，不虚构链接或二维码；百度网盘只交到用户指定项目目录，不创建公开分享。

## 保留的历史 preview.1

旧视频软件/录制基线 `003b2446ae1b4efe26de0cea680fe80d7ed69ef5`，位置为未版本化历史 `artifacts/media/` 内原文件，旧 `intro.srt`、`quickstart.srt` 和 `MEDIA_QA.json` 校验不改。它们曾通过全帧解码/播放器检查，但用户反馈已表明这些检查不能代替中文可懂度验收；不再推荐旧配音，也不改称 preview.3。
