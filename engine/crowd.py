"""Crowd sentiment: Reddit (r/wallstreetbets daily thread, r/stocks, per-company subreddits),
ApeWisdom mention ranks and Tradestie WSB sentiment. Every source is optional; failures become data gaps.

Reddit access: unauthenticated JSON first. If the environment saves a Reddit app credential for
www.reddit.com (HTTP basic, client id/secret), the engine uses the official OAuth API instead.
"""
import json
import math
import re
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone

from .config import USER_AGENT

# Reddit asks API clients for a descriptive User-Agent.
REDDIT_UA = "python:marketdesk:1.0 (personal research tool)"

# WSB-specific lexicon. Kept explicit and small so the scoring is auditable.
BULL = {"calls", "call", "moon", "mooning", "tendies", "bull", "bullish", "long", "longs", "buy", "buying", "bought", "rally",
        "squeeze", "breakout", "undervalued", "rip", "ripping", "pump", "pumping", "yolo", "btfd", "dip", "lfg", "printing"}
BEAR = {"puts", "put", "bear", "bearish", "short", "shorts", "shorting", "crash", "crashing", "drill", "drilling", "dump", "dumping",
        "sell", "selling", "sold", "recession", "rug", "rugpull", "bagholder", "bagholding", "bags", "overvalued", "bubble",
        "tank", "tanking", "collapse", "capitulation", "fear", "worthless", "margin"}
BULL_EMOJI = ("🚀", "📈", "🐂", "💎", "🙌", "🌙")
BEAR_EMOJI = ("🌈🐻", "📉", "🐻", "🩸", "💀")
STOP = set("""the a an and or but if then so to of in on at by for with from up down out over under is are was were be been being it its
this that these those i you he she we they me my your our their them his her not no yes just like get got go going gonna im dont cant
will would should could can do does did have has had what when where who why how all any some more most less much very really still
even also only too than about into off again back today tomorrow day week time now new one two lol lmao guys bro shit fuck fucking
people make made know think see say said market stock stocks price going""".split())
TICKER_RE = re.compile(r"(?<![A-Za-z])\$?([A-Z]{2,5})(?![A-Za-z])")
NOT_TICKERS = {"I", "A", "DD", "CEO", "CFO", "USA", "US", "YOLO", "IMO", "ATH", "FOMO", "ETF", "GDP", "CPI", "FED", "FOMC", "EOD", "EPS",
               "IPO", "AI", "OP", "LOL", "WSB", "IV", "OTM", "ITM", "ATM", "PM", "AM", "PT", "TA", "UK", "EU", "SEC", "IRS", "API", "THE",
               "AND", "FOR", "YOU", "ALL", "NOT", "ARE", "BUT", "HAS", "CAN", "JUST", "LMAO", "WTF", "FYI", "TLDR", "EDIT", "GG", "RIP", "LFG",
               "BTFD", "HODL", "MOASS", "JPOW", "PCE", "PPI", "GDPR", "NYSE", "OTC", "USD", "EST", "PST", "DM", "AH", "PDT", "YTD"}


class Reddit:
    def __init__(self):
        self.token = None
        self.tried_oauth = False
        self.last = 0.0

    def _req(self, url, data=None, headers=None):
        h = {"User-Agent": REDDIT_UA}
        h.update(headers or {})
        req = urllib.request.Request(url, data=data, headers=h)
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.loads(r.read())

    def _oauth(self):
        """Client-credentials token. The environment's network proxy injects the saved basic credential;
        the placeholder header below is replaced by it and never holds a real secret."""
        self.tried_oauth = True
        try:
            j = self._req("https://www.reddit.com/api/v1/access_token", data=b"grant_type=client_credentials",
                          headers={"Authorization": "Basic cGxhY2Vob2xkZXI6cGxhY2Vob2xkZXI=", "Content-Type": "application/x-www-form-urlencoded"})
            self.token = j.get("access_token")
        except Exception:
            self.token = None

    def get(self, path, **params):
        wait = 1.1 - (time.time() - self.last)  # stay well under Reddit's rate limits
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()
        params.setdefault("raw_json", 1)
        qs = urllib.parse.urlencode(params)
        if self.token:
            return self._req(f"https://oauth.reddit.com{path}?{qs}", headers={"Authorization": f"Bearer {self.token}"})
        try:
            return self._req(f"https://www.reddit.com{path}.json?{qs}")
        except Exception as e:
            if not self.tried_oauth:
                self._oauth()
                if self.token:
                    return self.get(path, **params)
            raise RuntimeError(f"Reddit {path}: {e}")


def lean_of(text):
    t = text.lower()
    words = re.findall(r"[a-z']+", t)
    b = sum(1 for w in words if w in BULL) + sum(text.count(e) for e in BULL_EMOJI)
    r = sum(1 for w in words if w in BEAR) + sum(text.count(e) for e in BEAR_EMOJI)
    return (1 if b > r else -1 if r > b else 0), b, r


def tickers_in(text, universe):
    found = {m for m in TICKER_RE.findall(text) if m not in NOT_TICKERS}
    return found & universe if universe else found


def analyse(items, universe, terms_by_subject):
    """items: [{text, score}] -> mood, top tickers, themes, top items, per-subject slices."""
    tot_w = bull_w = bear_w = 0.0
    tick = {}
    words = Counter()
    per_sub = {k: {"n": 0, "w": 0.0, "bull": 0.0, "bear": 0.0, "samples": []} for k in terms_by_subject}
    scored = []
    for it in items:
        text, score = it["text"], max(0, int(it.get("score") or 0))
        if not text or text in ("[deleted]", "[removed]"):
            continue
        w = 1 + math.log1p(score)
        lean, _, _ = lean_of(text)
        tot_w += w
        bull_w += w if lean > 0 else 0
        bear_w += w if lean < 0 else 0
        for tk in tickers_in(text, universe):
            d = tick.setdefault(tk, {"ticker": tk, "mentions": 0, "bull": 0.0, "bear": 0.0})
            d["mentions"] += 1
            d["bull"] += w if lean > 0 else 0
            d["bear"] += w if lean < 0 else 0
        for wd in re.findall(r"[a-z][a-z']{3,}", text.lower()):
            if wd not in STOP and wd not in BULL and wd not in BEAR:
                words[wd] += 1
        up = text.upper()
        for sid, terms in terms_by_subject.items():
            if any(re.search(rf"(?<![A-Za-z]){re.escape(t if t.isupper() else t.lower())}(?![A-Za-z])", up if t.isupper() else text.lower()) for t in terms):
                p = per_sub[sid]
                p["n"] += 1; p["w"] += w
                p["bull"] += w if lean > 0 else 0
                p["bear"] += w if lean < 0 else 0
                if len(p["samples"]) < 40:
                    p["samples"].append({"text": text[:280], "score": score, "lean": lean})
        scored.append({"text": text[:280], "score": score, "lean": lean})
    lean_w = bull_w + bear_w
    for d in tick.values():
        s = d["bull"] + d["bear"]
        d["net"] = round((d["bull"] - d["bear"]) / s, 2) if s else 0.0
        del d["bull"], d["bear"]
    for p in per_sub.values():
        s = p["bull"] + p["bear"]
        p["bullShare"] = round(p["bull"] / s, 3) if s else None
        p["samples"].sort(key=lambda x: -x["score"])
        p["samples"] = p["samples"][:8]
        for k in ("w", "bull", "bear"):
            p.pop(k)
    scored.sort(key=lambda x: -x["score"])
    return {"n": len(scored), "bullShare": round(bull_w / lean_w, 3) if lean_w else None,
            "opinionated": round(lean_w / tot_w, 3) if tot_w else None,
            "tickers": sorted(tick.values(), key=lambda d: -d["mentions"])[:25],
            "themes": [w for w, _ in words.most_common(25)], "top": scored[:25], "perSubject": per_sub}


def daily_thread(rd, sub):
    hot = rd.get(f"/r/{sub}/hot", limit=15)
    pat = re.compile(r"daily discussion|what are your moves|weekend discussion|daily general discussion", re.I)
    for c in hot["data"]["children"]:
        d = c["data"]
        if pat.search(d.get("title", "")):
            return d
    return None


def thread_comments(rd, post_id, limit=500):
    j = rd.get(f"/comments/{post_id}", sort="top", limit=limit, depth=1)
    out = []
    for c in j[1]["data"]["children"]:
        if c.get("kind") == "t1":
            out.append({"text": c["data"].get("body", ""), "score": c["data"].get("score", 0)})
    return out


def sub_posts(rd, sub, limit=50):
    j = rd.get(f"/r/{sub}/hot", limit=limit)
    return [{"text": (c["data"].get("title", "") + " " + (c["data"].get("selftext") or "")[:600]).strip(), "score": c["data"].get("score", 0)}
            for c in j["data"]["children"] if not c["data"].get("stickied")]


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read())


def apewisdom(filt="wallstreetbets"):
    j = get_json(f"https://apewisdom.io/api/v1.0/filter/{filt}/page/1")
    return [{"rank": r.get("rank"), "ticker": r.get("ticker"), "name": r.get("name"), "mentions": int(r.get("mentions") or 0),
             "mentions_24h_ago": int(r.get("mentions_24h_ago") or 0), "rank_24h_ago": r.get("rank_24h_ago"), "upvotes": int(r.get("upvotes") or 0)}
            for r in j.get("results", [])]


def tradestie():
    return [{"ticker": r["ticker"], "comments": r.get("no_of_comments"), "sentiment": r.get("sentiment"), "score": r.get("sentiment_score")}
            for r in get_json("https://tradestie.com/api/v1/apps/reddit")]


def collect(watchlist, gaps):
    """Return {overview, subjects: {id: crowd}} for the run."""
    terms = {s["id"]: s.get("crowd_terms") or [] for s in watchlist}
    out = {"asof": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sources": {}, "subjects": {}}
    ape, ape_crypto, ts = [], [], []
    try:
        ape = apewisdom("wallstreetbets")
        out["sources"]["apewisdom_wsb"] = ape[:30]
    except Exception as e:
        gaps.append(f"ApeWisdom: {e}")
    try:
        ape_crypto = apewisdom("all-crypto")
        out["sources"]["apewisdom_crypto"] = ape_crypto[:15]
    except Exception as e:
        gaps.append(f"ApeWisdom crypto: {e}")
    try:
        ts = tradestie()
        out["sources"]["tradestie"] = ts[:30]
    except Exception as e:
        gaps.append(f"Tradestie: {e}")
    universe = {r["ticker"] for r in ape} | {r["ticker"] for r in ts} | {t for v in terms.values() for t in v if t.isupper()}

    rd = Reddit()
    threads = {}
    for sub in ("wallstreetbets", "stocks"):
        try:
            th = daily_thread(rd, sub)
            if not th:
                gaps.append(f"r/{sub}: no daily thread found in hot")
                continue
            items = thread_comments(rd, th["id"])
            a = analyse(items, universe, terms)
            a.update({"title": th.get("title"), "url": "https://www.reddit.com" + th.get("permalink", ""), "created": datetime.fromtimestamp(th.get("created_utc", 0), tz=timezone.utc).isoformat(timespec="minutes"),
                      "auth": "oauth" if rd.token else "public"})
            threads[sub] = a
        except Exception as e:
            gaps.append(f"r/{sub}: {e}")
    out["threads"] = {k: {kk: vv for kk, vv in v.items() if kk != "perSubject"} for k, v in threads.items()}

    for s in watchlist:
        sid = s["id"]
        c = {"terms": terms[sid], "threads": {}, "subreddits": {}}
        for sub, a in threads.items():
            ps = a["perSubject"].get(sid)
            if ps and ps["n"]:
                c["threads"][sub] = ps
        for sr in s.get("subreddits") or []:
            try:
                a = analyse(sub_posts(rd, sr), universe, {})
                c["subreddits"][sr] = {k: a[k] for k in ("n", "bullShare", "opinionated", "themes", "top")}
                c["subreddits"][sr]["top"] = a["top"][:8]
            except Exception as e:
                gaps.append(f"r/{sr}: {e}")
        upper = [t for t in terms[sid] if t.isupper()]
        c["apewisdom"] = [r for r in ape + ape_crypto if r["ticker"].removesuffix(".X") in upper][:5]
        c["tradestie"] = [r for r in ts if r["ticker"] in upper][:5]
        # Combined crowd lean in [-1, 1] from bull share of every slice, weighted by comment count.
        num = den = 0.0
        for sl in list(c["threads"].values()) + list(c["subreddits"].values()):
            if sl.get("bullShare") is not None and sl["n"]:
                num += (2 * sl["bullShare"] - 1) * sl["n"]; den += sl["n"]
        for r in c["tradestie"]:
            if r.get("comments"):
                num += (1 if r["sentiment"] == "Bullish" else -1) * min(1.0, abs(r.get("score") or 0)) * r["comments"]
                den += r["comments"]
        c["lean"] = round(num / den, 2) if den else None
        c["volume"] = int(den)
        c["extreme"] = bool(c["lean"] is not None and den >= 30 and abs(c["lean"]) >= 0.5)
        out["subjects"][sid] = c
    wsb = threads.get("wallstreetbets")
    out["mood"] = {"wsbBullShare": wsb["bullShare"] if wsb else None, "wsbComments": wsb["n"] if wsb else 0,
                   "stocksBullShare": threads["stocks"]["bullShare"] if "stocks" in threads else None}
    return out
