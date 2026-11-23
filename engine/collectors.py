"""Data collectors. Each returns plain data or raises; callers record failures as data gaps."""
import csv
import io
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

from .config import USER_AGENT


def http_get(url, timeout=25, retries=2):
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # network hiccup or 429: back off and retry
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET failed {urllib.parse.urlparse(url).netloc}: {last}")


def get_json(url, **kw):
    return json.loads(http_get(url, **kw))


# ---------------- prices (Yahoo Finance chart API) ----------------
def yahoo_history(symbol, rng="3y"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?range={rng}&interval=1d&includeAdjustedClose=true"
    j = get_json(url)
    res = j["chart"]["result"][0]
    ts = res.get("timestamp") or []
    ind = res["indicators"]
    closes = (ind.get("adjclose") or [{}])[0].get("adjclose") or ind["quote"][0]["close"]
    dates, vals = [], []
    for t, c in zip(ts, closes):
        if c is None:
            continue
        d = datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d")
        if dates and dates[-1] == d:
            vals[-1] = c
            continue
        dates.append(d)
        vals.append(float(c))
    meta = res.get("meta", {})
    return {"symbol": symbol, "dates": dates, "close": vals, "currency": meta.get("currency"),
            "name": meta.get("longName") or meta.get("shortName") or symbol, "source": "Yahoo Finance"}


# ---------------- FRED (keyless CSV) ----------------
def fred_series(series_id, start="2018-01-01"):
    raw = http_get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={start}").decode()
    rows = list(csv.reader(io.StringIO(raw)))[1:]
    out = [(r[0], float(r[1])) for r in rows if len(r) > 1 and r[1] not in ("", ".")]
    return out


# ---------------- CFTC Traders in Financial Futures ----------------
def cftc_tff(code, weeks=160):
    q = urllib.parse.urlencode({"$limit": weeks, "$order": "report_date_as_yyyy_mm_dd DESC",
                                "$where": f"cftc_contract_market_code='{code}'"})
    rows = get_json(f"https://publicreporting.cftc.gov/resource/gpe5-46if.json?{q}")
    out = []
    for r in reversed(rows):
        f = lambda k: float(r.get(k) or 0)
        oi = f("open_interest_all") or 1
        out.append({"date": r["report_date_as_yyyy_mm_dd"][:10], "oi": oi,
                    "am_net": f("asset_mgr_positions_long") - f("asset_mgr_positions_short"),
                    "lev_net": f("lev_money_positions_long") - f("lev_money_positions_short"),
                    "dealer_net": f("dealer_positions_long_all") - f("dealer_positions_short_all"),
                    "market": r.get("contract_market_name")})
    return out


# ---------------- CoinGecko ----------------
def coingecko_coin(cid):
    j = get_json(f"https://api.coingecko.com/api/v3/coins/{cid}?localization=false&tickers=false&community_data=false&developer_data=false")
    m = j["market_data"]
    g = lambda k: (m.get(k) or {}).get("usd") if isinstance(m.get(k), dict) else m.get(k)
    return {"market_cap": g("market_cap"), "volume_24h": g("total_volume"), "circulating": m.get("circulating_supply"),
            "max_supply": m.get("max_supply"), "ath_change_pct": (m.get("ath_change_percentage") or {}).get("usd"),
            "chg_30d_pct": m.get("price_change_percentage_30d"), "chg_1y_pct": m.get("price_change_percentage_1y"),
            "rank": j.get("market_cap_rank")}


def coingecko_global():
    d = get_json("https://api.coingecko.com/api/v3/global")["data"]
    return {"total_mcap": d["total_market_cap"]["usd"], "btc_dominance": d["market_cap_percentage"].get("btc"),
            "eth_dominance": d["market_cap_percentage"].get("eth"), "mcap_chg_24h_pct": d.get("market_cap_change_percentage_24h_usd")}


# ---------------- official / macro ----------------
def treasury_debt():
    d = get_json("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=260")["data"]
    return [{"date": x["record_date"], "debt": float(x["tot_pub_debt_out_amt"])} for x in reversed(d)]


def worldbank(indicator, countries="USA;IDN;CHN;EUU", years=10):
    y = datetime.now(timezone.utc).year
    j = get_json(f"https://api.worldbank.org/v2/country/{countries}/indicator/{indicator}?format=json&per_page=500&date={y - years}:{y}")
    rows = [r for r in (j[1] or []) if r.get("value") is not None]
    out = {}
    for r in rows:
        out.setdefault(r["country"]["value"], {})[r["date"]] = round(r["value"], 2)
    return out


def fx_latest():
    try:
        return get_json("https://api.frankfurter.dev/v1/latest?base=USD")
    except Exception:
        return get_json("https://api.frankfurter.app/latest?from=USD")


# ---------------- news (Google News RSS) ----------------
HIGH = ("reuters", "bloomberg", "wsj", "wall street journal", "financial times", "ft.com", "associated press", "apnews",
        "federal reserve", "sec.gov", "treasury", "bank indonesia", "bi.go.id", "imf", "world bank", "the economist", "nikkei")
MED = ("cnbc", "marketwatch", "barron", "yahoo finance", "fortune", "axios", "coindesk", "the block", "kontan", "bisnis",
       "jakarta post", "jakarta globe", "cnbc indonesia", "investing.com", "business insider", "forbes", "fox business", "nasdaq")
RUMOR = re.compile(r"\b(reportedly|rumou?rs?|sources say|people familiar|speculat\w*|leak\w*|unconfirmed|whisper\w*)\b", re.I)
HEDGED = re.compile(r"\b(could|may|might|set to|poised|expected to|eyes|weighs|mulls)\b", re.I)
OPINION = re.compile(r"\b(why|should you|opinion|analysis|i think|my take|top \d+|best|buy now|prediction|forecast|bull case|bear case)\b", re.I)
BULL = re.compile(r"\b(surge|soar|rall(y|ies)|jump|record high|beat|upgrade|inflows?|gain|rebound|bullish|strong|boost|cut rates|easing)\b", re.I)
BEAR = re.compile(r"\b(plunge|slump|tumble|fall|drop|sell-?off|miss|downgrade|outflows?|loss|bearish|weak|crash|fear|hike|tighten|recession)\b", re.I)


def google_news(query, days=7, limit=15):
    url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": f"{query} when:{days}d", "hl": "en-US", "gl": "US", "ceid": "US:en"})
    root = ET.fromstring(http_get(url))
    seen, out = set(), []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        src_el = it.find("source")
        source = (src_el.text if src_el is not None else "") or ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        key = re.sub(r"\W+", "", title.lower())[:80]
        if not title or key in seen:
            continue
        seen.add(key)
        try:
            pub = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
        except Exception:
            pub = ""
        s = source.lower()
        tier = "high" if any(h in s for h in HIGH) else "medium" if any(m in s for m in MED) else "low"
        b, r = len(BULL.findall(title)), len(BEAR.findall(title))
        out.append({"title": title, "source": source, "url": it.findtext("link"), "published": pub, "tier": tier,
                    "rumor": bool(RUMOR.search(title)), "hedged": bool(HEDGED.search(title)), "opinion": bool(OPINION.search(title)),
                    "lean": 1 if b > r else -1 if r > b else 0})
        if len(out) >= limit:
            break
    return out
