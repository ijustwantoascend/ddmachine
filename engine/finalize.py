"""Phase 2: merge the research agent's judgments into the rule-based data, score every pillar,
compute conviction and alerts, and emit the database documents.

Usage: python3 -m engine.finalize [--work work] [--prev work/db/runs/<prevRunId>.json]
Reads work/collected.json + work/judgments.json. Writes work/out/*.json and work/out/writes.json.
"""
import argparse
import json
import math
import os
import sys

from . import quant as Q

KIND_W = {"Hard data": 1.0, "Filing / official": 1.0, "Verified fact": 0.85, "Analyst estimate": 0.55, "Opinion / narrative": 0.3, "Rumor": 0.15}
REL_W = {"Core": 1.0, "Context": 0.4, "Noise": 0.0}
PILLAR_W = {"Evidence": 0.25, "Bottom-up": 0.2, "Top-down": 0.2, "Price behaviour": 0.15, "Flows": 0.1, "Scenario EV": 0.1}
MAX_DOC = 200_000


def label(s):
    return "Strong bullish" if s > 40 else "Lean bullish" if s > 15 else "Neutral / no edge" if s >= -15 else "Lean bearish" if s >= -40 else "Strong bearish"


def ev_weight(e):
    return KIND_W.get(e.get("kind"), 0.5) * REL_W.get(e.get("rel"), 0.4) * (float(e.get("rely") or 3) / 5)


def evidence_stats(ev):
    tot = net = wb = wr = rum = 0.0
    for e in ev:
        w = ev_weight(e)
        e["weight"] = round(w, 3)
        d = int(e.get("dir") or 0)
        tot += w; net += w * d
        wb += w if d > 0 else 0
        wr += w if d < 0 else 0
        rum += w if e.get("kind") == "Rumor" else 0
    return {"net": net / tot if tot else 0.0, "bullShare": wb / (wb + wr) if wb + wr else 0.5, "rumorShare": rum / tot if tot else 0.0,
            "n": len(ev), "core": sum(1 for e in ev if e.get("rel") == "Core"), "corroborated": sum(1 for e in ev if e.get("corroborated"))}


def scenario_stats(sc):
    sc = [s for s in sc if float(s.get("p") or 0) > 0]
    P = sum(float(s["p"]) for s in sc) or 1
    ev = sum(float(s["p"]) / P * float(s["r"]) for s in sc)
    sd = math.sqrt(sum(float(s["p"]) / P * (float(s["r"]) - ev) ** 2 for s in sc))
    ploss = sum(float(s["p"]) / P for s in sc if float(s["r"]) < 0)
    up = sum(float(s["p"]) / P * float(s["r"]) for s in sc if float(s["r"]) > 0)
    dn = -sum(float(s["p"]) / P * float(s["r"]) for s in sc if float(s["r"]) < 0)
    return {"ev": round(ev, 2), "sd": round(sd, 2), "pLoss": round(ploss, 3), "ratio": round(up / dn, 2) if dn else None,
            "kelly": Q.kelly([{"p": float(s["p"]), "r": float(s["r"])} for s in sc]), "psum": round(sum(float(s.get("p") or 0) for s in sc), 1)}


def load(p, default=None):
    if not p or not os.path.exists(p):
        return default
    with open(p) as f:
        d = json.load(f)
    return d.get("data", d) if isinstance(d, dict) and "version" in d and "data" in d else d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="work")
    ap.add_argument("--prev", default=None, help="previous runs/<id> document (JSON) for change alerts")
    a = ap.parse_args()
    col = load(os.path.join(a.work, "collected.json"))
    jud = load(os.path.join(a.work, "judgments.json"), {"subjects": {}})
    prev = load(a.prev, None)
    prev_sum = (prev or {}).get("summary", {})
    problems = []
    run_id = col["runId"]
    out_dir = os.path.join(a.work, "out")
    os.makedirs(out_dir, exist_ok=True)
    docs = {}
    summary, alerts = {}, []

    for sub in col["subjects"]:
        sid, spec = sub["id"], sub["spec"]
        j = (jud.get("subjects") or {}).get(sid) or {}
        if not j:
            problems.append(f"{sid}: no agent judgments; rule-based pillars only")
        # ---- evidence (agent-curated; fall back to raw headlines as low-weight context) ----
        ev = j.get("evidence")
        if ev is None:
            ev = [{"claim": h["title"], "source": h["source"], "url": h["url"], "kind": "Rumor" if h["rumor"] else "Opinion / narrative",
                   "rel": "Context", "dir": h["lean"], "rely": 2, "by": "rule"} for h in sub.get("headlines", [])[:8]]
        for e in ev:
            e.setdefault("by", "agent")
            if e.get("kind") not in KIND_W:
                problems.append(f"{sid}: evidence kind '{e.get('kind')}' unknown -> treated as 0.5")
            if e.get("rel") not in REL_W:
                problems.append(f"{sid}: evidence rel '{e.get('rel')}' unknown -> treated as Context")
        es = evidence_stats(ev)
        # ---- bottom-up (agent; quantitative facts with sources) ----
        bu = j.get("bu") or []
        bu_avg = sum(Q.clamp(float(x["score"]), -2, 2) for x in bu) / len(bu) if bu else None
        # ---- top-down: rule scores, agent overrides/additions with reasons ----
        td = [dict(t) for t in sub.get("topdown", [])]
        for o in j.get("td_overrides") or []:
            hit = next((t for t in td if t["factor"].lower() == str(o.get("factor", "")).lower()), None)
            if hit:
                hit.update({"rule_score": hit["score"], "score": int(Q.clamp(float(o["score"]), -2, 2)), "by": "agent", "why": o.get("reason", "")})
            else:
                td.append({"factor": o.get("factor"), "score": int(Q.clamp(float(o["score"]), -2, 2)), "by": "agent", "why": o.get("reason", "")})
        td_avg = sum(t["score"] for t in td) / len(td) if td else None
        # ---- flows ----
        cot = sub.get("cot")
        extra = j.get("flows_extra") or []
        fsig = []
        if cot:
            fsig.append(cot["signal"])
        for f in extra:
            side = 1 if str(f.get("side", "")).lower().startswith(("buy", "in")) else -1 if str(f.get("side", "")).lower().startswith(("sell", "out")) else 0
            fsig.append(side * (0.75 if f.get("informed") else 0.5))
        flow = sum(fsig) / len(fsig) if fsig else None
        # ---- scenarios ----
        sc = j.get("scenarios") or sub.get("scenarios_baseline") or []
        for s in sc:
            s.setdefault("why", ""); s.setdefault("trigger", "")
        ss = scenario_stats(sc) if sc else None
        if ss and abs(ss["psum"] - 100) > 0.5:
            problems.append(f"{sid}: scenario probabilities sum to {ss['psum']} (normalized)")
        # ---- conviction ----
        b = sub.get("behavior")
        parts = []
        if es["n"]:
            parts.append(["Evidence", es["net"]])
        if bu_avg is not None:
            parts.append(["Bottom-up", bu_avg / 2])
        if td_avg is not None:
            parts.append(["Top-down", td_avg / 2])
        if b:
            parts.append(["Price behaviour", b["trendScore"] / 3])
        if flow is not None:
            parts.append(["Flows", flow])
        if ss:
            parts.append(["Scenario EV", Q.clamp(ss["ev"] / max(5.0, ss["sd"]))])
        W = sum(PILLAR_W[p[0]] for p in parts) or 1
        score = 100 * sum(PILLAR_W[p[0]] * p[1] for p in parts) / W
        conv = {"score": round(score, 1), "label": label(score), "coverage": round(100 * W), "parts": [{"pillar": p[0], "value": round(p[1], 3), "weight": PILLAR_W[p[0]]} for p in parts]}
        # cross-reference verdict
        xref = "incomplete"
        if bu_avg is not None and td_avg is not None:
            xref = ("aligned bullish" if bu_avg > 0.3 and td_avg > 0.3 else "aligned bearish" if bu_avg < -0.3 and td_avg < -0.3 else
                    "conflict: strong asset, hostile environment" if bu_avg > 0.3 and td_avg < -0.3 else
                    "conflict: weak asset, supportive environment" if bu_avg < -0.3 and td_avg > 0.3 else "no clear edge")
        confirm = None
        if b and es["n"]:
            n, p = (1 if es["net"] > 0.1 else -1 if es["net"] < -0.1 else 0), (1 if b["trendScore"] > 0 else -1 if b["trendScore"] < 0 else 0)
            confirm = "confirms" if n == p and n != 0 else "diverges" if n and p and n != p else "mixed"
        # ---- alerts ----
        sub_alerts = []
        ps = prev_sum.get(sid)
        if ps:
            d = conv["score"] - ps.get("conviction", 0)
            if abs(d) >= 15:
                sub_alerts.append({"level": "high", "text": f"Conviction moved {d:+.0f} ({ps.get('conviction', 0):+.0f} -> {conv['score']:+.0f})"})
            if ps.get("label") and ps["label"] != conv["label"]:
                sub_alerts.append({"level": "high", "text": f"Verdict changed: {ps['label']} -> {conv['label']}"})
            if b and ps.get("trend") is not None and (ps["trend"] > 0) != (b["trendScore"] > 0) and b["trendScore"] != 0:
                sub_alerts.append({"level": "medium", "text": f"Trend flipped to {'up' if b['trendScore'] > 0 else 'down'} ({b['trendScore']:+d}/3)"})
        if b and b.get("volRegime") and b["volRegime"] > 1.5:
            sub_alerts.append({"level": "medium", "text": f"Volatility regime {b['volRegime']:.1f}x its 1-year norm"})
        if b and b.get("lastDayZ") is not None and abs(b["lastDayZ"]) > 2.5:
            sub_alerts.append({"level": "medium", "text": f"Last session move {b['lastDayZ']:+.1f} sigma"})
        if cot and abs(cot["lev_z"]) > 2:
            sub_alerts.append({"level": "medium", "text": f"Leveraged-fund positioning extreme (z {cot['lev_z']:+.1f})"})
        crowd = sub.get("crowd")
        if crowd and crowd.get("extreme"):
            sub_alerts.append({"level": "medium", "text": f"Crowd sentiment extreme ({'bullish' if crowd['lean'] > 0 else 'bearish'}, lean {crowd['lean']:+.2f} on {crowd['volume']} items): historically a contrarian warning"})
        if confirm == "diverges":
            sub_alerts.append({"level": "low", "text": "Price behaviour diverges from the weight of evidence"})
        for m in j.get("material") or []:
            sub_alerts.append({"level": "high", "text": str(m), "by": "agent"})
        for al in sub_alerts:
            al["subject"] = sid
            al["name"] = spec["name"]
        alerts += sub_alerts

        doc = {"runId": run_id, "at": col["at"], "subjectId": sid, "spec": spec, "behavior": b, "chart": sub.get("chart"),
               "behavior_read": j.get("behavior_read", ""), "confirm": confirm,
               "headlines": sub.get("headlines", []), "evidence": ev, "evidenceStats": es, "narratives": j.get("narratives", []),
               "bias_checks": j.get("bias_checks", {}), "bu": bu, "buAvg": bu_avg, "topdown": td, "tdAvg": td_avg, "xref": xref,
               "cot": cot, "valuation": sub.get("valuation"), "eodhd": sub.get("eodhd"), "onchain": sub.get("onchain"), "crowd": sub.get("crowd"), "crowd_read": j.get("crowd_read", ""), "flows_extra": extra, "flowSignal": flow,
               "scenarios": sc, "scenarioBaseline": sub.get("scenarios_baseline"), "driftPrior": sub.get("drift_prior"), "scenarioStats": ss,
               "conviction": conv, "summary": j.get("summary", []), "invalidation": j.get("invalidation", ""), "actions": j.get("actions", ""),
               "alerts": sub_alerts, "gaps": sub.get("gaps", []), "agentRan": bool(j)}
        docs[("subj", f"{run_id}--{sid}")] = doc
        summary[sid] = {"name": spec["name"], "conviction": conv["score"], "label": conv["label"], "coverage": conv["coverage"],
                        "last": b["last"] if b else None, "r1m": b["r1m"] if b else None, "r12m": b["r12m"] if b else None,
                        "trend": b["trendScore"] if b else None, "ev": ss["ev"] if ss else None, "pLoss": ss["pLoss"] if ss else None,
                        "alerts": len(sub_alerts), "xref": xref, "crowd": (sub.get("crowd") or {}).get("lean"), "headline": (j.get("summary") or [""])[0]}

    # ---- prices, chunked under the document size limit ----
    chunks, cur, size = [], {}, 0
    for sym, s in sorted(col["prices"].items()):
        n = len(json.dumps(s))
        if cur and size + n > MAX_DOC:
            chunks.append(cur); cur, size = {}, 0
        cur[sym] = s; size += n
    if cur:
        chunks.append(cur)
    price_ids = []
    for i, ch in enumerate(chunks):
        pid = f"{run_id}--p{i}"
        price_ids.append(pid)
        docs[("prices", pid)] = {"runId": run_id, "symbols": ch, "meta": {k: col["priceMeta"].get(k) for k in ch}}

    order = {"high": 0, "medium": 1, "low": 2}
    alerts.sort(key=lambda x: order.get(x["level"], 3))
    docs[("runs", run_id)] = {"runId": run_id, "at": col["at"], "summary": summary, "alerts": alerts, "regime": col["regime"],
                              "panel": col["panel"], "crowd": col.get("crowd"), "crowd_note": jud.get("crowd_note", ""), "macro_note": jud.get("macro_note", ""), "run_notes": jud.get("run_notes", ""),
                              "gaps": col["gaps"], "problems": problems, "subjects": [s["id"] for s in col["subjects"]],
                              "priceDocs": price_ids, "portfolio": col["portfolio"], "prevRunId": (prev or {}).get("runId")}
    docs[("hist", run_id)] = {"runId": run_id, "at": col["at"], "alerts": len(alerts),
                              "s": {k: {"c": v["conviction"], "p": v["last"], "ev": v["ev"]} for k, v in summary.items()}}
    writes = []
    for (coll, did), body in docs.items():
        txt = json.dumps(body, separators=(",", ":"))
        if len(txt) > 250_000:
            raise SystemExit(f"document {coll}/{did} is {len(txt)} bytes, over the limit")
        fn = os.path.join(out_dir, f"{coll}__{did}.json")
        with open(fn, "w") as f:
            f.write(txt)
        writes.append({"op": "set", "collection": coll, "doc_id": did, "file_path": os.path.abspath(fn)})
    state = {"runId": run_id, "at": col["at"], "subjects": [s["id"] for s in col["subjects"]], "priceDocs": price_ids,
             "prevRunId": (prev or {}).get("runId"), "alertCount": len(alerts)}
    with open(os.path.join(out_dir, "state__latest.json"), "w") as f:
        json.dump(state, f)
    with open(os.path.join(out_dir, "writes.json"), "w") as f:
        json.dump(writes, f, indent=1)
    print(f"run {run_id}: {len(summary)} subjects, {len(alerts)} alerts, {len(writes)} documents -> {out_dir}")
    for p in problems:
        print("WARN", p)
    for sid, s in summary.items():
        print(f"  {sid:8s} {s['conviction']:+6.1f}  {s['label']:18s} cov {s['coverage']}%  EV {s['ev']}")


if __name__ == "__main__":
    sys.exit(main())
