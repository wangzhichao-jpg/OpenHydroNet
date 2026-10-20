"""CLI: python -m openhydronet.cli solve examples/closed-loop.ohn.json"""
import argparse
import json
import sys
from pathlib import Path
from .solver import solve
from .project import load_project
from .validation import ModelError


def main():
    p=argparse.ArgumentParser(description="OpenHydroNet 离线稳态计算（SI 内核）")
    sub=p.add_subparsers(dest="command",required=True)
    s=sub.add_parser("solve");s.add_argument("input");s.add_argument("-o","--output");s.add_argument("--timeout",type=float,default=30)
    b=sub.add_parser("batch");b.add_argument("inputs",nargs="+");b.add_argument("--output-dir",required=True)
    a=sub.add_parser("scan");a.add_argument("input");a.add_argument("settings");a.add_argument("-o","--output")
    e=sub.add_parser("expand");e.add_argument("input");e.add_argument("-o","--output",required=True)
    v=sub.add_parser("serve");v.add_argument("--port",type=int,default=0)
    args=p.parse_args()
    if args.command=="serve":
        from .server import serve
        serve(args.port);return
    def emit(data,path=None):
        text=json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)
        if path: Path(path).write_text(text+'\n',encoding="utf-8")
        else: print(text)
    if args.command=="batch":
        directory=Path(args.output_dir);directory.mkdir(parents=True,exist_ok=True)
        for item in args.inputs:
            try: result=solve(load_project(item)["model"])
            except ModelError as exc: result={"status":"invalid_model","issues":exc.issues}
            emit(result,directory/(Path(item).stem+'.result.json'))
        return
    if args.command=="expand":
        from .expansion import expand_single_line
        emit(expand_single_line(json.loads(Path(args.input).read_text(encoding="utf-8"))),args.output);return
    if args.command=="scan":
        from .analysis import scan
        emit(scan(load_project(args.input)["model"],json.loads(Path(args.settings).read_text(encoding="utf-8"))),args.output);return
    data=json.load(sys.stdin) if args.input=="-" else load_project(args.input)
    model=data.get("model",data)
    try: result=solve(model,timeout=args.timeout)
    except ModelError as exc: result={"status":"invalid_model","issues":exc.issues}
    emit(result,args.output)
    if result["status"] not in ("converged","demand_unsatisfied"): sys.exit(2)


if __name__=="__main__": main()
