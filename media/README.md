# 视频交付、配音重制与复现

## 当前重制：0.1.0-preview.3

### 优先使用：男声修订3（替代女声）

用户反馈修订2为女声、机械感强。修订3改用 Kokoro 内置**通用中文男声 zm_010**（模型自带说话人，非克隆真人），并改为**整句合成**：此前按 ≤28 字字幕块分别合成，每块结尾都会降调，是“念字”感的主要来源；现在每个完整句子一次合成，逗号停顿与句内语调由模型生成，句间停顿 0.32 s，语速 1.0（不再刻意放慢）。句界时间精确，句内字幕分割点按字数比例估计。

选择依据：对全部 45 个内置男声做同稿客观筛选（基频处于男声区间、回识别字错率、语调起伏幅度、语速），排除语调平直和识别差的声音；zm_010 语调起伏与语速最接近自然讲解。另附 B/C/D 三个备选男声同稿样音，若更喜欢其他音色可直接替换重出。为通过回识别门槛而不放宽门槛，改写了两句：“画布上方与底部状态栏，都会提示重新计算”和结尾语。

修订3复用 bc2ff1b 的同版本真实录屏，仅重做配音与字幕；软件及 Windows 候选不变，首稿和修订2保留。两片 120/300 s，19/50 条字幕，23 场景源音频与最终 MP4 音轨回识别/否定词检查均通过，约 -17.1/-16.9 LUFS，真峰值 -1.33/-1.40 dBTP，音画流时长差 0。客观筛选不能判断“自然感”，仍以你的试听为准。

### 历史：发音修订2（女声，已被修订3替代）

最新媒体修订位于 `artifacts/media/0.1.0-preview.3/pronunciation-r2/`，软件仍为 preview.3，不重新打包 Windows。复核模型词典发现孤立“重/长”的默认读音可能让“重开/重算/管长”读错；已把口播改为“再次打开/再次计算/管道长度”，并明确问题列表的操作，不修改模型原件、不放宽 ASR 门槛。

修订2复用 bc2ff1b 的同版本真实录屏，仅重做旁白/字幕后期；原 MP4、原 ZIP 和原交付索引均保留。新片仍为 120/300 s，15/44 条字幕，23 场景源音频和最终音轨回识别均通过，响度约 -16.14/-16.07 LUFS。新增多音字口播回归后 Python 92 项通过，软件运行时 20 文件不变。**已上传并回读核验** `07_项目与合作/OpenHydroNet/视频重制/0.1.0-preview.3/发音修订2/`：两段 MP4、修订视频工程 ZIP、请先阅读、版本与校验 JSON、SHA-256 共 6 项；provider 刷新列表/大小、无活动上传、CloudDrive 代理 SHA-256 回读一致，缓存独立性未证明，未建公开分享。真人试听仍待确认。

复用素材时以 `OHN_MEDIA_DIR` 指定该修订目录，再运行 `--audio-only`、回识别、`--remux` 和技术 QA，避免覆盖首稿。视频工程修订包包含本次工具/稿件/测试补丁，主软件源码/候选仍按原交付提交溯源。

### 以下为首稿的实际交付记录

用户反馈历史 eSpeak 配音听不清、解说混乱。本轮不是只换字幕：已重写旁白/分镜、改用 Kokoro 中文神经配音，按每句实际 WAV 时长安排字幕，等待实际操作完成后才开始该段解说。模型略慢语速，不做强制波形加速，不截断，不叠加两句人声，不放背景音乐。

源配音的 23 个场景已通过独立回识别初查（逐段字错率 ≤12%，否定词计数一致）。首个 MeloTTS 候选多段不达标，已拒绝使用；换为 Kokoro 后仍改写了一处易混淆否定表达，并重新检查。ASR 的同音误识仍会出现，**它不证明真人已经听清或主观自然度合格**。

**两条成片已实际生成、技术 QA 通过并上传用户百度网盘**：`07_项目与合作/OpenHydroNet/视频重制/0.1.0-preview.3/`。包括两个 MP4、可编辑视频工程 ZIP、中文说明和 SHA-256 清单，5 个文件均经 provider 刷新列表/大小/上传队列检查与 SHA-256 回读核验。回读经 CloudDrive 认证代理，可能使用缓存，不声称完全独立云端源回读或 provider MD5 相等；未创建公开分享。新版输出不覆盖历史目录。

实际录制的软件/源码提交为 `bc2ff1b7515cd6b3db3a2eac4e90ef1c48e07264`，完整技术收据在 `artifacts/media/0.1.0-preview.3/MEDIA_QA.json`。两条最终 MP4 的 23 场景均通过独立 ASR/否定词门槛；编码后实测约 -16.18/-16.08 LUFS，真峰值 -1.48/-1.47 dBTP，音画流时长差 0。解码、回识别和播放器检查不等于真人试听。

- 快速上手实际：120.000 s，`OpenHydroNet-quickstart-0.1.0-preview.3-清晰配音.mp4`。
- 产品介绍实际：300.000 s，`OpenHydroNet-intro-0.1.0-preview.3-清晰配音.mp4`。
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
