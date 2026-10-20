"""Symmetric single-line input to explicit two-pipe model with stable mapping.

Input nodes use the normal node fields. Input `edges` must be pipe/resistance.
`source` specifies the root node, pump and absolute suction-side head.
`terminals` attach a terminal between supply and return at a node.
No silent assumptions about asymmetric return pipes are permitted.
"""
from copy import deepcopy


def expand_single_line(description):
    source=description["source"]
    nodes=description["nodes"]
    if any(e["kind"] not in ("pipe","resistance") for e in description["edges"]):
        raise ValueError("单线骨架仅允许管道或等效阻力；泵在 source、末端在 terminals 定义")
    if source["node"] not in {n["id"] for n in nodes}:
        raise ValueError("单线源节点引用失效")
    output={"nodes":[],"edges":[],"fluid":deepcopy(description.get("fluid",{}))}
    mapping={}
    for n in nodes:
        if n.get("demand",0) or n.get("head") is not None:
            raise ValueError("单线骨架不能含含义不明的定压或漏补水；请在展开的双线模型明确定义")
        mapping[n["id"]]=[n["id"]+"::s",n["id"]+"::r"]
        for side in ("s","r"):
            nn=deepcopy(n);nn["id"]=n["id"]+"::"+side; nn["name"]=n.get("name",n["id"])+( "·供" if side=="s" else "·回")
            nn["head"]=source.get("head",30) if n["id"]==source["node"] and side=="r" else None
            output["nodes"].append(nn)
    for e in description["edges"]:
        mapping[e["id"]]=[e["id"]+"::s",e["id"]+"::r"]
        for side in ("s","r"):
            ee=deepcopy(e);ee["id"]=e["id"]+"::"+side
            ee["source"]=e["source"]+"::"+side;ee["target"]=e["target"]+"::"+side
            if side=="r":ee["source"],ee["target"]=ee["target"],ee["source"]
            output["edges"].append(ee)
    for terminal in description["terminals"]:
        if terminal["node"] not in mapping:raise ValueError("末端节点引用失效")
        ee=deepcopy(terminal);node=ee.pop("node");ee.update(source=node+"::s",target=node+"::r",kind="terminal")
        output["edges"].append(ee);mapping[ee["id"]]=[ee["id"]]
    pump=deepcopy(source["pump"]);pump.update(kind="pump",source=source["node"]+"::r",target=source["node"]+"::s")
    output["edges"].append(pump);mapping[pump["id"]]=[pump["id"]]
    return {"model":output,"mapping":mapping,"assumption":"供回水对称：长度、内径、粗糙度及局部阻力相同；回水方向反转","expansion_version":1}
