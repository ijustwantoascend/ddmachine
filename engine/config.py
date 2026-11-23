"""Default configuration. The live watchlist and portfolio come from the dashboard database
(config/watchlist, config/portfolio) and override these when present."""

USER_AGENT = "MarketDesk/1.0 (personal research tool)"

# profile -> sensitivity of the subject's price to each top-down factor signal.
# Factor signals are oriented so +1 = growth up / disinflation / easier policy / easier liquidity /
# tighter credit spreads / weaker dollar / risk-on. Sensitivity +1 means that condition is bullish for the subject.
PROFILES = {
    "us_equity":        {"growth": 1.0, "inflation": 0.6, "policy": 0.6, "liquidity": 0.5, "credit": 0.8, "dollar": 0.2, "risk": 0.8},
    "us_equity_growth": {"growth": 0.8, "inflation": 0.8, "policy": 1.0, "liquidity": 0.8, "credit": 0.8, "dollar": 0.3, "risk": 1.0},
    "duration":         {"growth": -0.8, "inflation": 1.0, "policy": 1.0, "liquidity": 0.2, "credit": -0.4, "dollar": 0.0, "risk": -0.6},
    "usd":              {"growth": 0.3, "inflation": -0.3, "policy": -0.8, "liquidity": -0.6, "credit": -0.4, "dollar": -1.0, "risk": -0.6},
    "crypto":           {"growth": 0.3, "inflation": 0.4, "policy": 0.8, "liquidity": 1.0, "credit": 0.5, "dollar": 0.8, "risk": 1.0},
    "em_equity":        {"growth": 0.6, "inflation": 0.4, "policy": 0.7, "liquidity": 0.7, "credit": 0.6, "dollar": 1.0, "risk": 0.8},
    "em_fx_usdquote":   {"growth": -0.3, "inflation": -0.3, "policy": -0.7, "liquidity": -0.7, "credit": -0.6, "dollar": -1.0, "risk": -0.8},
}
# Neutral annual drift prior per profile (an assumption, shown as such): used only for baseline scenarios.
DRIFT_PRIOR = {"us_equity": 0.06, "us_equity_growth": 0.07, "duration": 0.04, "usd": 0.0, "crypto": 0.0,
               "em_equity": 0.07, "em_fx_usdquote": 0.02}

WATCHLIST = [
    {"id": "spx", "crowd_terms": ["SPY", "SPX", "VOO", "S&P"], "name": "US large caps (S&P 500)", "scope": "macro", "type": "Equity index", "symbols": ["^GSPC"], "bench": "IEF",
     "profile": "us_equity", "horizon_m": 6, "cot": "13874A", "news": "S&P 500 stock market outlook",
     "question": "Do US large caps offer better risk-adjusted returns than Treasuries over the next 6 months?"},
    {"id": "ndx", "crowd_terms": ["QQQ", "NDX", "TQQQ", "SQQQ", "NASDAQ", "nasdaq"], "name": "US tech (Nasdaq 100)", "scope": "macro", "type": "Equity index", "symbols": ["^NDX"], "bench": "^GSPC",
     "profile": "us_equity_growth", "horizon_m": 6, "cot": "209742", "news": "Nasdaq tech stocks AI earnings",
     "question": "Will US mega-cap tech keep outperforming the broad market over the next 6 months?"},
    {"id": "ust", "crowd_terms": ["TLT", "IEF", "TMF", "TBT", "bonds", "yields"], "name": "US Treasuries 7-10y", "scope": "macro", "type": "Rates", "symbols": ["IEF"], "bench": None,
     "profile": "duration", "horizon_m": 6, "cot": "043602", "news": "Treasury yields Fed rate outlook",
     "question": "Is adding duration (7-10y Treasuries) attractive over the next 6 months?"},
    {"id": "usd", "crowd_terms": ["DXY", "UUP", "dollar"], "name": "US dollar index", "scope": "macro", "type": "Currency (FX)", "symbols": ["DX-Y.NYB"], "bench": None,
     "profile": "usd", "horizon_m": 6, "cot": "098662", "news": "US dollar index outlook",
     "question": "Will the dollar strengthen or weaken over the next 6 months?"},
    {"id": "btc", "crowd_terms": ["BTC", "IBIT", "MSTR", "bitcoin"], "subreddits": ["Bitcoin"], "name": "Bitcoin", "scope": "micro", "type": "Cryptocurrency", "symbols": ["BTC-USD"], "bench": "^NDX",
     "profile": "crypto", "horizon_m": 6, "cot": "133741", "coingecko": "bitcoin", "news": "Bitcoin price ETF flows",
     "question": "Is the risk/reward of holding Bitcoin attractive over the next 6 months?"},
    {"id": "eth", "crowd_terms": ["ETH", "ETHA", "ethereum"], "subreddits": ["ethereum"], "name": "Ethereum", "scope": "micro", "type": "Cryptocurrency", "symbols": ["ETH-USD"], "bench": "BTC-USD",
     "profile": "crypto", "horizon_m": 6, "cot": "146021", "coingecko": "ethereum", "news": "Ethereum price ETF",
     "question": "Will Ethereum outperform Bitcoin over the next 6 months?"},
    {"id": "jci", "crowd_terms": ["EIDO", "indonesia", "IHSG"], "subreddits": ["indonesia_stocks"], "name": "Indonesia equities (IDX Composite)", "scope": "macro", "type": "Equity index", "symbols": ["^JKSE"], "bench": "EEM",
     "profile": "em_equity", "horizon_m": 6, "news": "Indonesia stocks Jakarta Composite",
     "question": "Is the Indonesian equity market attractive versus broad emerging markets over the next 6 months?"},
    {"id": "idr", "crowd_terms": ["IDR", "rupiah"], "name": "Rupiah (USD/IDR)", "scope": "macro", "type": "Currency (FX)", "symbols": ["IDR=X"], "bench": None,
     "profile": "em_fx_usdquote", "horizon_m": 6, "news": "rupiah Bank Indonesia",
     "question": "Will USD/IDR rise (rupiah weaken) over the next 6 months? Bullish = USD/IDR up."},
    {"id": "idbanks", "crowd_terms": ["BBCA", "BBRI", "BMRI"], "name": "Indonesian big banks (BBCA, BBRI, BMRI)", "scope": "micro", "type": "Industry / sub-sector",
     "symbols": ["BBCA.JK", "BBRI.JK", "BMRI.JK"], "bench": "^JKSE", "profile": "em_equity", "horizon_m": 6,
     "news": "Bank Central Asia OR Bank Rakyat Indonesia OR Bank Mandiri", "question": "Do Indonesia's big banks offer an edge over the IDX Composite over the next 6 months?"},
    {"id": "nvda", "crowd_terms": ["NVDA", "nvidia", "Nvidia"], "subreddits": ["NVDA_Stock"], "name": "Nvidia", "scope": "micro", "type": "Stock",
     "symbols": ["NVDA"], "bench": "^NDX", "profile": "us_equity_growth", "horizon_m": 6, "news": "Nvidia stock",
     "question": "Does Nvidia offer an edge over the Nasdaq 100 over the next 6 months?"},
    {"id": "rcat", "crowd_terms": ["RCAT", "Red Cat"], "subreddits": ["RCAT"], "name": "Red Cat Holdings", "scope": "micro", "type": "Stock",
     "symbols": ["RCAT"], "bench": "IWM", "profile": "us_equity_growth", "horizon_m": 6, "news": "Red Cat Holdings drone",
     "question": "Is the risk/reward of holding Red Cat Holdings attractive over the next 6 months?"},
]

PORTFOLIO = {
    "bench": "SPY", "rf": 4.0,
    "holdings": [
        {"sym": "SPY", "cls": "Equity", "w": 35}, {"sym": "QQQ", "cls": "Equity", "w": 10}, {"sym": "EEM", "cls": "Intl Equity", "w": 5},
        {"sym": "EIDO", "cls": "Intl Equity", "w": 5}, {"sym": "IEF", "cls": "Bonds", "w": 20}, {"sym": "GLD", "cls": "Gold", "w": 10},
        {"sym": "BTC-USD", "cls": "Crypto", "w": 5}, {"sym": "SHV", "cls": "Cash", "w": 10},
    ],
}

# FRED series used for the top-down regime (fetched keyless via fredgraph.csv).
FRED = {
    "PAYEMS": "Nonfarm payrolls (k)", "INDPRO": "Industrial production", "UNRATE": "Unemployment rate %",
    "CPIAUCSL": "CPI index", "T5YIE": "5y breakeven inflation %", "DGS2": "2y Treasury %", "DGS10": "10y Treasury %",
    "DFII10": "10y real yield %", "DFF": "Fed funds effective %", "WALCL": "Fed balance sheet ($m)", "BAMLH0A0HYM2": "High-yield spread %",
    "T10Y2Y": "10y-2y curve %", "DTWEXBGS": "Broad trade-weighted dollar", "VIXCLS": "VIX", "NFCI": "Chicago Fed financial conditions",
}
