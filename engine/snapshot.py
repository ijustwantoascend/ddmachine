"""Bundle the latest finalized run into dashboard/data/snapshot.js (offline / first-paint fallback).

Usage: python3 -m engine.snapshot [--work work] [--dest dashboard/data/snapshot.js]
"""
import argparse
import glob
import json
import os


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="work")
    ap.add_argument("--dest", default="dashboard/data/snapshot.js")
    a = ap.parse_args()
    out = os.path.join(a.work, "out")
    snap = {"subj": {}, "prices": {}, "hist": []}
    for fn in glob.glob(os.path.join(out, "*.json")):
        name = os.path.basename(fn)[:-5]
        if name == "writes":
            continue
        coll, did = name.split("__", 1)
        with open(fn) as f:
            body = json.load(f)
        if coll == "state":
            snap["state"] = body
        elif coll == "runs":
            snap["run"] = body
        elif coll == "subj":
            snap["subj"][body["subjectId"]] = body
        elif coll == "prices":
            snap["prices"][did] = body
        elif coll == "hist":
            snap["hist"].append(body)
    os.makedirs(os.path.dirname(a.dest), exist_ok=True)
    with open(a.dest, "w") as f:
        f.write("window.MD_SNAPSHOT=" + json.dumps(snap, separators=(",", ":")) + ";\n")
    print(f"snapshot {snap['state']['runId']} -> {a.dest} ({os.path.getsize(a.dest) // 1024} KB)")


if __name__ == "__main__":
    main()
