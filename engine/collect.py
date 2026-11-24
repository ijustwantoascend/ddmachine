"""Phase 1: collect data and compute every rule-based part of the pipeline.

Usage: python3 -m engine.collect [--db work/db] [--out work]
Writes work/collected.json (machine) and work/digest.md (for the research agent to read).
"""
import argparse
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from statistics import mean, median

from . import collectors as C
from . import quant as Q
from . import crowd as CR
from .config import WATCHLIST, PORTFOLIO, PROFILES, DRIFT_PRIOR, FRED, GOOGLE_FINANCE_SHEET

FACTOR_LABELS = {"growth": "Growth cycle", "inflation": "Inflation trend", "policy": "Monetary policy", "liquidity": "Liquidity",
                 "credit": "Credit conditions", "dollar": "Dollar", "risk": "Risk appetite"}


def load_db_doc(db_dir, collection, doc_id):
    p = os.path.join(db_dir, collection, doc_id + ".json")
    if not os.path.exists(p):
        return None
    with open(p) as f:
        d = json.load(f)
    return d.get("data", d) if isinstance(d, dict) and "version" in d and "data" in d else d


def value_at(series, days_back):
    """Value of a (date, value) series as of `days_back` calendar days before its last observation."""
    last = datetime.strptime(series[-1][0], "%Y-%m-%d")
    cutoff = (last - timedelta(days=days_back)).strftime("%Y-%m-%d")
    prior = [v for d, v in series if d <= cutoff]
    return prior[-1] if prior else series[0][1]


def macro_regime(fred, gaps):
    f = {}
    def g(k):
        s = fred.get(k)
        if not s:
            gaps.append(f"FRED {k} unavailable")
        return s
    def factor(key, parts, rule):
        parts = [p for p in parts if p is not None]
        sig = round(mean(p["s"] for p in parts), 2) if parts else None
        f[key] = {"key": key, "label": FACTOR_LABELS[key], "signal": sig, "inputs": parts, "rule": rule}
    P = lambda name, value, s, asof, detail="": {"name": name, "value": round(value, 3), "s": round(Q.clamp(s), 2), "asof": asof, "detail": detail}

    parts = []
    if (s := g("PAYEMS")) and len(s) > 4:
        avg3 = (s[-1][1] - s[-4][1]) / 3
        parts.append(P("Payrolls, 3m avg change (k)", avg3, (avg3 - 100) / 100, s[-1][0]))
    if (s := g("INDPRO")) and len(s) > 13:
        yoy = s[-1][1] / s[-13][1] - 1
        parts.append(P("Industrial production y/y", yoy * 100, yoy / 0.03, s[-1][0], "%"))
    if (s := g("UNRATE")) and len(s) > 15:
        avg = [mean(v for _, v in s[i - 2:i + 1]) for i in range(len(s) - 14, len(s))]
        sahm = avg[-1] - min(avg[:-1][-12:])
        parts.append(P("Sahm-rule gap (pp)", sahm, -(sahm - 0.25) / 0.25, s[-1][0], ">=0.5 historically signals recession"))
    factor("growth", parts, "Payroll momentum, IP growth, unemployment trend. + = growth firming")

    parts = []
    if (s := g("CPIAUCSL")) and len(s) > 13:
        yoy = s[-1][1] / s[-13][1] - 1
        ann3 = (s[-1][1] / s[-4][1]) ** 4 - 1
        parts.append(P("CPI y/y %", yoy * 100, (3.0 - yoy * 100) / 1.5, s[-1][0]))
        parts.append(P("CPI 3m annualized %", ann3 * 100, (yoy - ann3) / 0.01, s[-1][0], "below y/y = disinflation momentum"))
    if (s := g("T5YIE")):
        chg = s[-1][1] - value_at(s, 91)
        parts.append(P("5y breakeven, 3m change (pp)", chg, -chg / 0.25, s[-1][0]))
    factor("inflation", parts, "Inflation level and momentum. + = disinflation")

    parts = []
    if (s := g("DGS2")):
        chg = s[-1][1] - value_at(s, 91)
        parts.append(P("2y yield, 3m change (pp)", chg, -chg / 0.5, s[-1][0], f"level {s[-1][1]:.2f}%"))
    if (s := g("DFF")):
        chg = s[-1][1] - value_at(s, 182)
        parts.append(P("Fed funds, 6m change (pp)", chg, -chg / 0.5, s[-1][0], f"level {s[-1][1]:.2f}%"))
    if (s := g("DFII10")):
        parts.append(P("10y real yield %", s[-1][1], (1.5 - s[-1][1]) / 1.0, s[-1][0]))
    factor("policy", parts, "Rate direction and real-rate restrictiveness. + = easing")

    parts = []
    if (s := g("WALCL")):
        yoy = s[-1][1] / value_at(s, 365) - 1
        parts.append(P("Fed balance sheet y/y %", yoy * 100, yoy / 0.05, s[-1][0]))
    if (s := g("NFCI")):
        parts.append(P("Chicago Fed NFCI", s[-1][1], -s[-1][1] / 0.3, s[-1][0], "<0 = looser than average"))
    factor("liquidity", parts, "Central-bank balance sheet and financial conditions. + = easier")

    parts = []
    if (s := g("BAMLH0A0HYM2")):
        chg = s[-1][1] - value_at(s, 91)
        parts.append(P("High-yield spread %", s[-1][1], (4.0 - s[-1][1]) / 1.5, s[-1][0]))
        parts.append(P("HY spread, 3m change (pp)", chg, -chg / 0.75, s[-1][0]))
    factor("credit", parts, "Corporate credit spreads. + = tight/tightening spreads")

    parts = []
    if (s := g("DTWEXBGS")):
        chg = s[-1][1] / value_at(s, 91) - 1
        parts.append(P("Broad dollar, 3m change %", chg * 100, -chg / 0.03, s[-1][0]))
    factor("dollar", parts, "Trade-weighted dollar. + = weakening dollar")

    parts = []
    if (s := g("VIXCLS")):
        yr = [v for _, v in s[-260:]]
        med = median(yr)
        parts.append(P("VIX vs 1y median", s[-1][1], (med - s[-1][1]) / 5, s[-1][0], f"median {med:.1f}"))
    if (s := g("T10Y2Y")):
        parts.append(P("10y-2y curve (pp)", s[-1][1], 0, s[-1][0], "context only: inversion historically precedes slowdowns"))
    factor("risk", parts, "Implied volatility vs its norm. + = calm / risk-on")
    return f


def cot_flows(code, gaps):
    try:
        rows = C.cftc_tff(code)
    except Exception as e:
        gaps.append(f"CFTC {code}: {e}")
        return None
    if len(rows) < 30:
        return None
    am = [r["am_net"] / r["oi"] for r in rows]
    lev = [r["lev_net"] / r["oi"] for r in rows]
    am_chg4 = am[-1] - am[-5]
    lev_z = Q.zscore(lev, lev[-1])
    crowd = 0.0
    if lev_z > 1.5:
        crowd = -0.3 * Q.clamp((lev_z - 1.5) / 1.0, 0, 1)
    elif lev_z < -1.5:
        crowd = 0.3 * Q.clamp((-lev_z - 1.5) / 1.0, 0, 1)
    sig = round(Q.clamp(0.7 * Q.clamp(am_chg4 / 0.03) + crowd), 2)
    return {"market": rows[-1]["market"], "asof": rows[-1]["date"], "am_net_pct": round(am[-1] * 100, 1), "am_chg4_pp": round(am_chg4 * 100, 2),
            "am_z": round(Q.zscore(am, am[-1]), 2), "lev_net_pct": round(lev[-1] * 100, 1), "lev_z": round(lev_z, 2),
            "lev_chg1_pp": round((lev[-1] - lev[-2]) * 100, 2), "signal": sig,
            "rule": "0.7 x asset-manager 4-week net change (scaled at 3pp of OI) + crowding adjustment when leveraged-fund z beyond +/-1.5",
            "hist": [{"d": r["date"], "am": round(a * 100, 1), "lev": round(l * 100, 1)} for r, a, l in zip(rows[-104:], am[-104:], lev[-104:])]}


def compact(series):
    """Store dates as day offsets from the first date and closes to 6 significant figures."""
    d0 = datetime.strptime(series["dates"][0], "%Y-%m-%d")
    days = [(datetime.strptime(d, "%Y-%m-%d") - d0).days for d in series["dates"]]
    return {"d0": series["dates"][0], "o": days, "c": [float(f"{x:.6g}") for x in series["close"]]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="work/db")
    ap.add_argument("--out", default="work")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    gaps = []
    wl_doc = load_db_doc(a.db, "config", "watchlist")
    pf_doc = load_db_doc(a.db, "config", "portfolio")
    watchlist = (wl_doc or {}).get("items") or WATCHLIST
    portfolio = pf_doc if pf_doc and pf_doc.get("holdings") else PORTFOLIO
    t0 = time.time()

    # ---- prices ----
    syms = set()
    for s in watchlist:
        syms.update(s["symbols"])
        if s.get("bench"):
            syms.add(s["bench"])
    syms.update(h["sym"] for h in portfolio["holdings"])
    syms.add(portfolio.get("bench") or "SPY")
    prices = {}
    def fetch(sym):
        try:
            return sym, C.yahoo_history(sym)
        except Exception as e:
            gaps.append(f"Prices {sym}: {e}")
            return sym, None
    def fetch_all(symbols, record):
        for sym in symbols:  # serial on purpose: Yahoo throttles parallel bursts
            try:
                s = C.yahoo_history(sym)
                if len(s["close"]) > 30:
                    prices[sym] = s
            except Exception as e:
                if record:
                    gaps.append(f"Prices {sym}: {e}")
            time.sleep(0.6)
    fetch_all(sorted(syms), record=False)
    missing = sorted(syms - set(prices))
    if missing:
        time.sleep(20)  # let Yahoo's rate limit cool down, then one final pass
        fetch_all(missing, record=True)

    # ---- Google Finance quotes & valuation (sheet feed) ----
    gf = {}
    if GOOGLE_FINANCE_SHEET:
        try:
            gf = C.google_finance(GOOGLE_FINANCE_SHEET)
        except Exception as e:
            gaps.append(f"Google Finance sheet: {e}")
    eod_token = os.environ.get("EODHD_API_TOKEN", "").strip()

    # ---- FRED regime ----
    fred = {}
    def ff(k):
        try:
            return k, C.fred_series(k)
        except Exception as e:
            gaps.append(f"FRED {k}: {e}")
            return k, None
    with ThreadPoolExecutor(4) as ex:
        for k, s in ex.map(ff, FRED):
            if s:
                fred[k] = s
    regime = macro_regime(fred, gaps)

    # ---- macro panel ----
    panel = {}
    for name, fn in [("treasury_debt", lambda: C.treasury_debt()[-120:]), ("gdp_growth", lambda: C.worldbank("NY.GDP.MKTP.KD.ZG")),
                     ("cpi_inflation", lambda: C.worldbank("FP.CPI.TOTL.ZG")), ("fx", C.fx_latest), ("crypto_global", C.coingecko_global)]:
        try:
            panel[name] = fn()
        except Exception as e:
            gaps.append(f"{name}: {e}")
    panel["rates"] = {k: {"label": FRED[k], "last": fred[k][-1][1], "asof": fred[k][-1][0],
                          "hist": [[d, v] for d, v in fred[k][-520:]][::5]} for k in ("DGS2", "DGS10", "DFII10", "T10Y2Y", "BAMLH0A0HYM2", "VIXCLS", "DFF") if k in fred}

    # ---- subjects ----
    subjects = []
    for spec in watchlist:
        sid = spec["id"]
        sub = {"id": sid, "spec": spec, "gaps": []}
        val = {sym: gf[sym] for sym in spec["symbols"] if sym in gf and gf[sym].get("price") is not None}
        if val:
            sub["valuation"] = val
        if eod_token and spec.get("type") in ("Stock", "Industry / sub-sector"):
            for sym in spec["symbols"]:
                es = C.eodhd_symbol(sym)
                if not es:
                    continue
                snap, errs = C.eodhd_snapshot(es, eod_token)
                if snap:
                    sub.setdefault("eodhd", {})[sym] = snap
                for e in errs:
                    if e not in sub["gaps"]:
                        sub["gaps"].append(e)
        legs = [prices[s] for s in spec["symbols"] if s in prices]
        if not legs:
            sub["gaps"].append("No price history (Yahoo)" + ("; latest quote from Google Finance only" if val else ""))
        else:
            series = legs[0] if len(legs) == 1 else Q.basket(legs)
            crypto = spec.get("profile") == "crypto"
            bench = prices.get(spec.get("bench")) if spec.get("bench") else None
            close, bclose, ppy, dates = series["close"], None, 365 if crypto else 252, series["dates"]
            if bench:
                d, x, y = Q.align(series, bench)
                if len(d) > 300:
                    close, bclose, ppy, dates = x, y, 252, d
            b = Q.behavior(close, bclose, ppy)
            b["asof"] = dates[-1]
            b["ppy"] = ppy
            sub["behavior"] = b
            sub["chart"] = {"dates": dates[-504:][::2], "close": [float(f"{v:.6g}") for v in close[-504:][::2]]}
            prof = spec.get("profile", "us_equity")
            sub["scenarios_baseline"] = Q.baseline_scenarios(max(0.02, b["volLong"]), DRIFT_PRIOR.get(prof, 0.0), spec.get("horizon_m", 6))
            sub["drift_prior"] = DRIFT_PRIOR.get(prof, 0.0)
        # top-down: map regime signals through the subject's profile
        sens = PROFILES.get(spec.get("profile", "us_equity"), PROFILES["us_equity"])
        td = []
        for key, fac in regime.items():
            if fac["signal"] is None:
                continue
            raw = sens.get(key, 0) * fac["signal"]
            td.append({"factor": fac["label"], "key": key, "score": int(round(2 * Q.clamp(raw))), "raw": round(raw, 2), "by": "rule",
                       "why": f"regime signal {fac['signal']:+.2f} x sensitivity {sens.get(key, 0):+.1f}"})
        sub["topdown"] = td
        if spec.get("cot"):
            sub["cot"] = cot_flows(spec["cot"], sub["gaps"])
        if spec.get("coingecko"):
            try:
                sub["onchain"] = C.coingecko_coin(spec["coingecko"])
            except Exception as e:
                sub["gaps"].append(f"CoinGecko: {e}")
        try:
            sub["headlines"] = C.google_news(spec.get("news") or spec["name"])
        except Exception as e:
            sub["headlines"] = []
            sub["gaps"].append(f"News: {e}")
        subjects.append(sub)
        time.sleep(0.3)

    # ---- crowd sentiment (Reddit, ApeWisdom, Tradestie) ----
    crowd = CR.collect(watchlist, gaps)
    for sub in subjects:
        sub["crowd"] = crowd["subjects"].get(sub["id"])
    crowd_overview = {k: v for k, v in crowd.items() if k != "subjects"}

    run_at = datetime.now(timezone.utc)
    out = {"runId": run_at.strftime("r%Y%m%dT%H%MZ"), "at": run_at.isoformat(timespec="seconds"), "secs": round(time.time() - t0, 1),
           "watchlist": watchlist, "portfolio": portfolio, "regime": regime, "crowd": crowd_overview, "panel": panel, "subjects": subjects,
           "prices": {k: compact(v) for k, v in prices.items()}, "priceMeta": {k: {"name": v["name"], "currency": v["currency"]} for k, v in prices.items()},
           "gaps": gaps}
    with open(os.path.join(a.out, "collected.json"), "w") as f:
        json.dump(out, f)
    with open(os.path.join(a.out, "digest.md"), "w") as f:
        f.write(digest(out))
    print(f"collected {len(subjects)} subjects, {len(prices)} price series, {len(fred)} FRED series in {out['secs']}s; gaps: {len(gaps) + sum(len(s['gaps']) for s in subjects)}")


def pct(x):
    return "n/a" if x is None else f"{x * 100:+.1f}%"


def digest(o):
    L = [f"# Market Desk digest {o['runId']} ({o['at']})", "", "## Top-down regime (rule-based; signal -1..+1, + = supportive of risk assets)"]
    for f in o["regime"].values():
        L.append(f"- **{f['label']}** {f['signal']:+.2f}" if f["signal"] is not None else f"- **{f['label']}** n/a")
        for p in f["inputs"]:
            L.append(f"  - {p['name']}: {p['value']} (signal {p['s']:+.2f}, as of {p['asof']}) {p['detail']}")
    cw = o.get("crowd") or {}
    L += ["", "## Crowd sentiment (Reddit / ApeWisdom / Tradestie; lexicon-scored, noisy, often contrarian at extremes)"]
    for name, t in (cw.get("threads") or {}).items():
        L.append(f"- r/{name} '{t['title']}' ({t['created']}): {t['n']} top comments, bullish share of opinionated comments "
                 f"{'n/a' if t['bullShare'] is None else round(t['bullShare'] * 100)}%, opinionated {'n/a' if t['opinionated'] is None else round(t['opinionated'] * 100)}%")
        L.append("  - Most-mentioned: " + ", ".join(f"{x['ticker']} {x['mentions']} (net {x['net']:+.2f})" for x in t["tickers"][:12]))
        L.append("  - Frequent words: " + ", ".join(t["themes"][:20]))
        L.append("  - Top comments by upvotes (score | lean | text):")
        for c in t["top"][:15]:
            L.append(f"    {c['score']} | {c['lean']:+d} | " + c["text"].replace(chr(10), " ")[:220])
    src = cw.get("sources") or {}
    if src.get("apewisdom_wsb"):
        L.append("- ApeWisdom WSB mention ranks (ticker mentions vs 24h ago): " + ", ".join(f"{r['ticker']} {r['mentions']}/{r['mentions_24h_ago']}" for r in src["apewisdom_wsb"][:15]))
    if src.get("tradestie"):
        L.append("- Tradestie WSB sentiment: " + ", ".join(f"{r['ticker']} {r['sentiment']} ({r['comments']})" for r in src["tradestie"][:15]))
    if o["gaps"]:
        L += ["", "## Data gaps", *[f"- {g}" for g in o["gaps"]]]
    for s in o["subjects"]:
        sp, b = s["spec"], s.get("behavior")
        L += ["", f"## [{s['id']}] {sp['name']}  ({sp['scope']}, {sp['type']}, horizon {sp.get('horizon_m', 6)}m)", f"Question: {sp['question']}"]
        if b:
            L.append(f"- Price {b['last']:.6g} as of {b['asof']}: 1m {pct(b['r1m'])}, 3m {pct(b['r3m'])}, 12m {pct(b['r12m'])}, 12-1 mom {pct(b['mom12_1'])}, "
                     f"from 52w high {pct(b['fromHigh'])}, RSI {b['rsi14'] and round(b['rsi14'])}, vol {b['volNow'] * 100:.0f}% vs 1y {b['volLong'] * 100:.0f}%, "
                     f"trend score {b['trendScore']}/3" + (f", RS vs bench 3m {pct(b.get('rs3m'))} 12m {pct(b.get('rs12m'))}" if b.get("rs3m") is not None else ""))
        L.append("- Top-down (rule): " + ", ".join(f"{t['factor']} {t['score']:+d}" for t in s["topdown"]))
        if s.get("cot"):
            c = s["cot"]
            L.append(f"- CFTC {c['market']} ({c['asof']}): asset managers net {c['am_net_pct']}% of OI (4wk {c['am_chg4_pp']:+}pp, z {c['am_z']}), "
                     f"leveraged funds net {c['lev_net_pct']}% (z {c['lev_z']}), flow signal {c['signal']:+.2f}")
        for sym, v in (s.get("valuation") or {}).items():
            L.append(f"- Google Finance {sym}: price {v['price']} {v['currency'] or ''} ({v['chg_pct']}% today), P/E {v['pe']}, EPS {v['eps']}, "
                     f"mkt cap {v['mcap']}, 52w {v['low52']}-{v['high52']}, delay {v['delay_min']} min")
        for sym, e in (s.get("eodhd") or {}).items():
            L.append(f"- EODHD {sym}: {json.dumps(e)[:600]}")
        if s.get("onchain"):
            L.append(f"- CoinGecko: {json.dumps(s['onchain'])}")
        c = s.get("crowd")
        if c and (c.get("threads") or c.get("subreddits") or c.get("apewisdom") or c.get("tradestie")):
            L.append(f"- Crowd: lean {c['lean']} on {c['volume']} items{' (EXTREME)' if c['extreme'] else ''}; "
                     + "; ".join(f"r/{k} {v['n']} mentions, bull share {v['bullShare']}" for k, v in {**c['threads'], **c['subreddits']}.items())
                     + ("; ApeWisdom " + ", ".join(f"{r['ticker']} rank {r['rank']} ({r['mentions']} mentions, {r['mentions_24h_ago']} 24h ago)" for r in c["apewisdom"]) if c["apewisdom"] else ""))
            for sl in list(c["threads"].values()) + list(c["subreddits"].values()):
                for x in sl.get("samples", sl.get("top", []))[:4]:
                    L.append(f"    crowd sample {x['score']} | {x['lean']:+d} | " + x["text"].replace(chr(10), " ")[:200])
        if s.get("scenarios_baseline"):
            L.append("- Baseline scenarios (vol-based, drift prior {:.0%}): ".format(s["drift_prior"]) + ", ".join(f"{x['name']} {x['p']}% -> {x['r']:+.1f}%" for x in s["scenarios_baseline"]))
        L.append("- Headlines (index | tier | flags | lean | source | date | title):")
        for i, h in enumerate(s.get("headlines", [])):
            flags = ",".join(k for k in ("rumor", "hedged", "opinion") if h[k]) or "-"
            L.append(f"  {i:>2} | {h['tier']} | {flags} | {h['lean']:+d} | {h['source']} | {h['published']} | {h['title']}")
        if s["gaps"]:
            L.append("- Gaps: " + "; ".join(s["gaps"]))
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.exit(main())
