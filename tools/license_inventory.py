"""Generate dependency/version/source/integrity inventory from actual lock file."""
import json
from pathlib import Path
import importlib.metadata
ROOT=Path(__file__).resolve().parents[1]
lock=json.loads((ROOT/'package-lock.json').read_text());rows=[];missing=[]
for path,p in lock['packages'].items():
    if not path:continue
    name=path.split('node_modules/')[-1]
    lic=p.get('license')
    if not lic:
        metadata=ROOT/path/'package.json'
        if metadata.exists():lic=json.loads(metadata.read_text()).get('license','UNKNOWN')
    if not lic:lic='UNKNOWN'
    rows.append(dict(name=name,version=p.get('version'),license=lic,development=bool(p.get('dev')),source=p.get('resolved'),integrity=p.get('integrity')))
    if lic=='UNKNOWN':missing.append(name)
(ROOT/'third_party/npm-inventory.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
text='# 第三方依赖及许可清单\n\n前端与开发依赖从 `package-lock.json` 自动提取；完整来源和 SRI 见 `third_party/npm-inventory.json`。\n\n|包|锁定版本|许可|开发依赖|\n|---|---|---|---|\n'
for p in rows:text+=f"|{p['name']}|{p['version']}|{p['license']}|{'是' if p['development'] else '否'}|\n"
text+='\n## 分发运行时\n\n- Python 3.12.10 embeddable：PSF License，Windows 便携包保留其 LICENSE.txt。Linux 开发验证为 Python 3.12.3。\n- NumPy 2.4.3：BSD-3-Clause；Windows wheel 内含捆绑库声明，原样保留 dist-info/licenses 及 numpy.libs。\n- SciPy 1.17.1：BSD-3-Clause；wheel 的 OpenBLAS、LAPACK、GCC 运行时等许可声明原样随包保留，不将主包 BSD 许可替代捆绑组件声明。\n- openpyxl 3.1.5 与 et-xmlfile 2.0.0：MIT；defusedxml 0.7.1：PSFL（Python Software Foundation License），Windows 包原样保留各 wheel 的 dist-info 许可。数据表仅本地读取，不执行公式；三份通用 wheel 的来源和 SHA-256 见 requirements.lock 及对应构建清单。\n- Electron 44.9.1：MIT；Chromium 等多许可证，便携包必须保留根目录 LICENSE 和 LICENSES.chromium.html。\n- React、React DOM、React Flow：MIT，分发包保留合并第三方声明，界面保留 React Flow attribution。\n- FFmpeg、eSpeak NG 和 Noto 字体仅用于本地视频制作，不打入软件运行时。FFmpeg 构建启用 libx264，视频制作环境的工具许可证不等同于软件产品采用 GPL；不分发其工具二进制。字体为 SIL OFL，系统字体仅渲染成画面，不嵌入安装包。eSpeak NG 合成输出为本项目原创文本的音频。\n\nApache-2.0 只覆盖本项目独立代码和文档；不改变第三方组件许可。不包含原 HACNet 文档、截图或品牌素材。当前为工程清单检查而非法律意见；正式发布还应复核实际发行包中的声明完整性和安全更新。\n'
text+='\n未知许可：'+(', '.join(missing) if missing else '无（锁文件中所有条目有声明）')+'。\n'
(ROOT/'docs/DEPENDENCIES.md').write_text(text)
print('inventory',len(rows),'unknown',missing)
# Human-readable combined license texts for production packages, including transitive packages.
notices=[]
for path,p in lock['packages'].items():
    if not path or p.get('dev'):continue
    directory=ROOT/path
    for candidate in sorted(directory.glob('*')):
        if candidate.is_file() and candidate.name.lower().startswith(('license','copying','notice')):
            notices.append('\n===== '+path+' '+p.get('version','')+' / '+candidate.name+' =====\n'+candidate.read_text(errors='replace'))
(ROOT/'third_party/FRONTEND_NOTICES.txt').write_text('\n'.join(notices))
