# 视频交付与复现

软件基线：`0.1.0-preview.1`，提交 `003b2446ae1b4efe26de0cea680fe80d7ed69ef5`。这是预览版视频，不能宣传为已经全面覆盖参考软件的正式成品。

## 与当前源码的区别

源码已进入 `0.1.0-preview.2`，新增设备库、表格导入和文件保护。以下视频仍为 preview.1，未覆盖这些新增界面，不冒称新版录制。更新前须给录制/合成脚本改为版本化输出、接入退出确认，再真正重录；不能直接在当前软件上运行旧脚本覆盖历史文件。新版视频仍是待办，不能因旧技术 QA 通过而勾选完成。

## 当前实际状态

- 快速上手 MP4 已真实生成：`artifacts/media/OpenHydroNet-quickstart-0.1.0-preview.1.mp4`，120.000 秒，1920×1080，H.264 + AAC，30 fps。不是只交分镜。
- 五分钟介绍也已实际生成：`artifacts/media/OpenHydroNet-intro-0.1.0-preview.1.mp4`，300.000 秒，同为 1080p/H.264/AAC/30 fps。两条视频都已完成真实录制、全帧解码和 FFplay 本地短片段启动检查。
- 独立字幕为 `artifacts/media/intro.srt` 和 `quickstart.srt`，修正了把否定语义切到相邻字幕的断句问题，并增加 2 项字幕回归测试。最终 QA 为 `artifacts/media/MEDIA_QA.json`。
- 后期仅复用原始真实录屏/配音重新合成字幕，没有重造界面。原始录屏、逐场景截图、音频和实际修改工程保留在 `artifacts/media/intro/`、`quickstart/`；可编辑脚本另打入视频工程包。
- 所有正式旁白是 eSpeak NG 离线中文合成，不使用付费配音。已完成视频的全帧解码无错误；实际检查了抽帧中文可读性。**尚未真人试听，不声称已经确认旁白自然度、中文可懂度和逐句音画同步。**

## 源文件与制作流程

- `storyboards.json`：两个独立分镜、时间轴、操作和旁白稿。
- `intro-narration.md`、`quickstart-narration.md`：独立可编辑旁白/分镜。
- `ASSETS.md`：实际素材来源和许可。
- `tools/record_video.cjs`：Playwright 操作真正的 Electron 应用，FFmpeg 录制 X11；橙色圆环提示鼠标位置。
- `tools/tts_local.py`：离线中文 WAV；每句独立进程避免 eSpeak 反复初始化挂起。
- `tools/render_videos.py`：配音、字幕、录制、H.264/AAC 合成、全帧解码和抽帧。
- `tools/check_media.py`：本地播放器短片段运行、时长/编码/字幕时间/音画流时长检查；输出不包含私人绝对路径的记录。
- 公开示例：`examples/closed-loop.ohn.json`；录制中实际修改的工程和导出文件在 `artifacts/media/<片名>/`。

在项目根目录，先构建界面并显式安装 Electron，再用单个用户任务执行（约 7–9 分钟）：

```bash
systemd-run --user --unit=openhydronet-videos \
  --property=WorkingDirectory="$PWD" \
  /bin/bash -lc 'exec flock -n .local/video.lock /bin/bash -lc "PYTHONUNBUFFERED=1 python3 tools/render_videos.py > .local/logs/videos.log 2>&1"'
# 结束后
python3 tools/check_media.py
# 只修正字幕或后期而不重录真实界面：
python3 tools/render_videos.py --remux
```

检查任务状态后再重试；中止必须 systemctl stop 并确认 Electron/FFmpeg/Python 退出，不重复录制同一输出。

## 发布边界

GitHub/Gitee 仓库、视频平台和账号仍未确认，**没有上传，也没有实际播放链接或二维码**。README 不虚构入口。当前录制自动保存使用预设公开位置，旁白说明了这一点；主体确为软件运行，不用设计稿或静态概念界面冒充功能。
