"""Quant helpers (stdlib only), mirroring dashboard/js/quant.js where they overlap."""
import math
from statistics import mean, pstdev, median

TD = 252


def std(a):
    if len(a) < 2:
        return 0.0
    m = mean(a)
    return math.sqrt(sum((x - m) ** 2 for x in a) / (len(a) - 1))


def returns(c):
    return [c[i] / c[i - 1] - 1 for i in range(1, len(c))]


def sma(c, n):
    return sum(c[-n:]) / n if len(c) >= n else None


def rsi(c, n=14):
    if len(c) <= n:
        return None
    g = l = 0.0
    for i in range(1, n + 1):
        d = c[i] - c[i - 1]
        g += max(d, 0); l += max(-d, 0)
    g /= n; l /= n
    for i in range(n + 1, len(c)):
        d = c[i] - c[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n
        l = (l * (n - 1) + max(-d, 0)) / n
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def align(a, b):
    """Align two {dates, close} series on common dates."""
    mb = dict(zip(b["dates"], b["close"]))
    d = [x for x in a["dates"] if x in mb]
    ma = dict(zip(a["dates"], a["close"]))
    return d, [ma[x] for x in d], [mb[x] for x in d]


def basket(series_list):
    """Equal-weight, daily-rebalanced basket index (=100 at start) on common dates."""
    common = set(series_list[0]["dates"])
    for s in series_list[1:]:
        common &= set(s["dates"])
    dates = sorted(common)
    maps = [dict(zip(s["dates"], s["close"])) for s in series_list]
    idx = [100.0]
    for i in range(1, len(dates)):
        r = mean(m[dates[i]] / m[dates[i - 1]] - 1 for m in maps)
        idx.append(idx[-1] * (1 + r))
    return {"dates": dates, "close": idx}


def behavior(close, bench=None, ppy=TD):
    n = len(close)
    last = close[-1]
    k = lambda days: round(days * ppy / TD)
    ret = lambda days: (last / close[-1 - k(days)] - 1) if n > k(days) else None
    r = returns(close)
    s50, s200 = sma(close, k(50)), sma(close, k(200))
    out = {
        "last": last, "r1m": ret(21), "r3m": ret(63), "r6m": ret(126), "r12m": ret(252),
        "mom12_1": (close[-1 - k(21)] / close[-1 - k(252)] - 1) if n > k(252) else None,
        "above50": (last > s50) if s50 else None, "above200": (last > s200) if s200 else None,
        "golden": (s50 > s200) if (s50 and s200) else None, "rsi14": rsi(close, 14),
        "volNow": std(r[-k(21):]) * math.sqrt(ppy), "volLong": std(r[-k(252):]) * math.sqrt(ppy),
        "fromHigh": last / max(close[-k(252):]) - 1, "lastDayZ": (r[-1] / (std(r[-k(252):]) or 1)) if r else None,
    }
    out["volRegime"] = out["volNow"] / out["volLong"] if out["volLong"] else None
    if bench and len(bench) == n:
        b = lambda days: (bench[-1] / bench[-1 - k(days)] - 1) if n > k(days) else None
        out["rs3m"] = out["r3m"] - b(63) if out["r3m"] is not None and b(63) is not None else None
        out["rs12m"] = out["r12m"] - b(252) if out["r12m"] is not None and b(252) is not None else None
    score = 0
    for key in ("above50", "above200"):
        if out[key] is not None:
            score += 1 if out[key] else -1
    if out["mom12_1"] is not None:
        score += 1 if out["mom12_1"] > 0 else -1
    out["trendScore"] = score
    return out


def zscore(vals, x):
    s = std(vals)
    return (x - mean(vals)) / s if s else 0.0


def clamp(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


# --- normal helpers for scenario baselines ---
def npdf(z):
    return math.exp(-0.5 * z * z) / math.sqrt(2 * math.pi)


def baseline_scenarios(vol_annual, drift_annual, horizon_m):
    """Three buckets of a lognormal horizon return: bottom 25%, middle 50%, top 25%.
    Returns each bucket's conditional mean return (in %) with its probability."""
    h = horizon_m / 12
    mu = (drift_annual - 0.5 * vol_annual ** 2) * h
    sig = vol_annual * math.sqrt(h)
    z = 0.6745  # 25th/75th percentile
    # E[exp(mu+sig Z) | Z in (a,b)] = exp(mu+sig^2/2) * (Phi(b-sig)-Phi(a-sig)) / (Phi(b)-Phi(a))
    Phi = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
    def cm(a, b):
        p = Phi(b) - Phi(a)
        return math.exp(mu + sig * sig / 2) * (Phi(b - sig) - Phi(a - sig)) / p - 1
    inf = 12.0
    return [
        {"name": "Bear", "p": 25, "r": round(100 * cm(-inf, -z), 1)},
        {"name": "Base", "p": 50, "r": round(100 * cm(-z, z), 1)},
        {"name": "Bull", "p": 25, "r": round(100 * cm(z, inf), 1)},
    ]


def kelly(scen, fmax=2.0):
    tot = sum(s["p"] for s in scen) or 1
    best, bg = 0.0, 0.0
    f = 0.0
    while f <= fmax + 1e-9:
        ok, g = True, 0.0
        for s in scen:
            x = 1 + f * s["r"] / 100
            if x <= 0:
                ok = False
                break
            g += s["p"] / tot * math.log(x)
        if ok and g > bg:
            bg, best = g, f
        f += 0.01
    return round(best, 2)
