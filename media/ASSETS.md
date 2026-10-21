# 视频素材来源与许可

## preview.3 重制

|素材/工具|来源|用途与许可边界|
|---|---|---|
|实际画面|本项目 Electron 44.9.1 / Python，Linux/Xvfb 实录|非设计稿、非 Windows 实录；项目 Apache-2.0，保留 React Flow attribution|
|工程/参数表|examples/closed-loop.ohn.json、parameter-update.csv|本项目人工教学数据，不含真实工程/厂家机密|
|旁白/分镜/字幕|storyboards.json、两份 narration.md、同版本 SRT/ASS|原创中文，Apache-2.0；每句 WAV 对应自己的字幕时间，不按字数比例猜时间|
|神经配音|Kokoro v1.1-zh，ONNX 转换 csukuangfj/kokoro-multi-lang-v1_1，通用中文 zf_001|Apache-2.0；不克隆用户或特定个人声音，不调用付费云配音；模型权重不打入软件/视频交付包|
|推理|sherpa-onnx / sherpa-onnx-core 1.13.8，CPU|Apache-2.0，制作期隔离环境，非软件运行依赖；wheel 从清华源实际获取并记录 SHA-256|
|音素查找|现有系统 espeak-ng-data 1.51+dfsg-12build1|仅用于神经模型的音素回退，不使用 eSpeak 的合成波形；GPL-3.0-or-later 工具/数据不随交付包分发|
|独立回识别|SenseVoice int8 ONNX，sherpa-onnx Chinese CPU|仅检查本项目旁白/最终视频音轨；阿里巴巴/ModelScope FunASR Model License v1.1（不是 Apache-2.0）；仅内部参考检查，模型不打入产品，不改授项目许可；不把 ASR 当作真人试听|
|字体|Noto Sans CJK SC，系统 fonts-noto-cjk 1:20230817+repack1-3|SIL OFL-1.1，仅渲染到画面，不另行嵌入字体文件|
|编码/字幕|FFmpeg 6.1.1、libx264/AAC/libass|制作工具不打入产品，不混同工具许可与项目源代码许可；H.264 地区专利适用性另行评估|
|鼠标提示|原创橙色圆环|只指示操作位置，不伪造能力|
|背景音乐/肖像|未使用|无音乐盖住人声，无肖像/声音冒用|

### 固定版本与完整性

- Kokoro 转换仓库：`https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_1`，revision `914313412b607d95400bcd12446233fbd1248801`。
- 模型源：`https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh`；转换仓库自带 Apache-2.0 LICENSE。
- 配音 model.onnx SHA-256：`acc4adc175b9d9986106cd20060329673ad5a2e12ef3c557d2d3745b694f8b38`。
- voices.bin SHA-256：`e64a5a581d8c2a350d848f51c3121657cd83aa07ed6109172177345874a7244c`。
- ASR 模型上游 `FunAudioLLM/SenseVoiceSmall` 明确标记 `other / model-license`，转换仓库 LICENSE 指向 `https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE`；已读取该模型协议，保留阿里巴巴/ModelScope、FunASR/SenseVoice 名称，不将它混同于推理引擎的 Apache-2.0。
- ASR revision `2365baeacb507f821a0c8120fcee3d484dba7a07`，model.int8.onnx SHA-256：`c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51`。
- [配音模型逐文件来源/摘要](models/kokoro-v1.1-zh.json)、[回识别逐文件来源/摘要](models/sensevoice-int8.json)。使用 `hf-mirror.com` 国内镜像，LFS 与元数据 SHA-256 一致；非 LFS 文件核对 Git blob SHA-1，并另存 SHA-256。TLS 未关闭。
- 中文路径、脚本、词典和权重不含远程执行逻辑；没有运行下载仓库中的 Python 脚本。制作前在受控工具环境校验全部文件，不运行时自动下载。

第一轮尝试 MeloTTS 候选时，多场景回识别出现高字错率和否定词丢失，因此拒绝作为交付配音，改用 Kokoro；失败记录私有保留，不能把首轮未通过说成通过。

### 可选工具环境

制作工具不属于 OpenHydroNet 离线运行要求。可在隔离 venv 用清华源获取二进制 wheel，锁定 `sherpa-onnx==1.13.8`、`sherpa-onnx-core==1.13.8`；沿用已验证的 NumPy。权重按上述固定 revision/摘要准备。神经模型仅使用通用说话人、略慢的 0.93 倍模型时长预测，不做波形变速，不截断句子。

## 发音修订2补充

低字错率不自动排除工程术语的多音字误读。已核对固定词典：孤立“重”默认读 zhong4、“长”默认读 zhang3，因而把本稿“重开/重算/管长”改成词典可明确读取的“再次打开/再次计算/管道长度”。不改写已下载模型/词典原件，也不调低回识别门槛；添加口播词回归并保留独立版本目录与旧文件摘要。此修订只重做音频/字幕后期，同版本真实录屏来源不变。

## 历史 preview.1

旧视频软件/录制基线 `003b2446ae1b4efe26de0cea680fe80d7ed69ef5`，使用 eSpeak NG cmn 直接合成。用户已反馈解说不清晰，不推荐继续使用这版配音；历史文件/校验保持原样。系统工具、字体和编码来源同上，不把历史版改称新版。

## 其他边界

自动录制的保存/打开对话框使用预设的教学文件位置，真实 IPC 仍读写实际文件；解说说明实际使用时由用户选路径。没有遥测、真实工程上传、付费服务或未授权肖像。仓库/公开视频平台尚未确认，不制作指向不存在入口的二维码。
