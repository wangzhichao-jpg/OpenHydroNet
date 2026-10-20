# 可复现构建与运行

## 环境与锁定

已验证：Linux x86_64，Python 3.12.3、NumPy 2.4.3、SciPy 1.17.1、pytest 9.0.2、Node 22.22.2、npm 10.9.7。前端依赖 `package-lock.json` 含来源和 SRI。Python 运行时只需 NumPy/SciPy，设备库和项目不依赖在线服务。

Windows 候选包：Electron 44.9.1 win32-x64、CPython 3.12.10 embeddable amd64、NumPy 2.4.3 cp312 win_amd64、SciPy 1.17.1 cp312 win_amd64。不通过 Linux 的 PyInstaller 冒充 Windows 可执行文件，而是组装上游实际 Windows 二进制。

## 1. 开发环境

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --index-url https://pypi.tuna.tsinghua.edu.cn/simple -e . pytest==9.0.2
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm ci --registry=https://registry.npmmirror.com --cache=.local/npm-cache
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run setup:desktop
npm run build
OHN_PYTHON="$PWD/.venv/bin/python" npm run desktop
```

不关闭 TLS 校验。国内镜像无包时方可使用上游源，并保留源地址和 SHA-256/SRI。项目新增下载、缓存、日志和中间物放 `.local/`，不更改用户全局 npm/pip 配置。

Linux 无可用 Chromium 沙箱的受限测试容器，可在 E2E 中显式使用 `--no-sandbox`（测试脚本的 Linux 分支），不是给正式产品关闭沙箱。普通桌面运行优先保留系统安全机制。

## 2. 长任务管理（本执行环境）

在仓库根目录：
```bash
mkdir -p .local/logs
systemd-run --user --unit=openhydronet-windows-deps \
  --property=WorkingDirectory="$PWD" \
  /bin/bash -lc 'exec flock -n .local/windows-deps.lock /bin/bash -lc "python3 tools/download_windows.py > .local/logs/windows-deps.log 2>&1"'
systemctl --user show openhydronet-windows-deps.service -p ActiveState -p ExecMainStatus
```

断开工具不代表任务停止。重试前检查状态；中止使用 `systemctl --user stop UNIT`，确认计算/下载进程退出，不重复并发安装。构建、基准和视频同样分别使用独立锁。

Windows/没有 systemd 的开发者可前台顺序执行脚本；不得同时重复下载到同一路径。

## 3. Windows 便携包

```bash
python3 tools/download_windows.py
npm run build
python3 tools/license_inventory.py
# 先完成测试并提交，确保版本源可追溯
python3 tools/build_windows.py
```

输入校验：CPython 内容摘要与 python.org HTTPS 发布的 Sigstore 文件中的摘要核对（未宣称完整验证证书链/透明日志）；Electron zip 与其 SHASUMS256 清单核对；pip 校验清华索引 SHA-256 fragment，另记录 wheel SHA-256。所有输入及源地址在 `.local/downloads/manifest.json`，实际发行包复制为构建清单。

输出：`artifacts/OpenHydroNet-0.1.0-preview.1-win-x64.zip`、同名 `.sha256` 及 `WINDOWS_BUILD_MANIFEST.json`。包包含真实 `OpenHydroNet.exe`、独立 Python、科学计算 Windows 原生库、已构建界面、示例、文档和第三方声明。没有运行时在线下载脚本。

ZIP 内统一固定时间戳和排序以减少非源码差异；源码提交、已验证输入和构建脚本可追溯，但当前不承诺在不同 npm/压缩库/构建时刻下逐字节一致。`BUILD_MANIFEST.json` 明确记录 `windows_executed=false`，只有真实 Windows 测试后才能更改。

`build_windows.py` 拒绝覆盖已有构建目录。需要重建时先检查、归档旧候选，再清理仅由本脚本生成的对应目录；不能删除既有仓库或用户文件。

## 4. 必做 Windows 原生检查

- 解压到普通可写目录（包括中文路径）→ 运行 `验证计算.cmd`，检查 `smoke-result.json`。
- 双击 `OpenHydroNet.exe` → 按 `docs/ACCEPTANCE.md` 完成闭环。
- 断网仍可打开工程、计算和导出 PDF。
- 100/125/150% 显示缩放、字体/图例、保存权限、退出无遗留进程。
- 对同一示例与 Linux 基线比较残差和结果；不得将 Linux 组装当作本步骤通过。

## 5. 测试和材料

```bash
PYTHONPATH=src OPENBLAS_NUM_THREADS=1 python3 -m pytest -q
npm run test:commands
npm run build
xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:ui
PYTHONPATH=src OPENBLAS_NUM_THREADS=1 python3 tools/benchmark.py
python3 tools/license_inventory.py
```

实际视频制作入口与素材许可见 `media/README.md`。公开前另执行隐私检查和双平台链接核验；没有认证和目标仓库时仅本地准备，不伪造发布成功。
