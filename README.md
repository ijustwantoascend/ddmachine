# Market Desk

Automated market research for a portfolio manager / hedger. Every weekday a fresh Claude session runs the
information-process flowchart end to end and publishes the results to a dashboard.

**Dashboard:** https://claude.ai/artifact/AaceZus6QeKmgcYa1d1pAM (private to you until you share it)

## How it works
```
 schedule ──> Claude session ──> engine.collect ──> digest.md ──> Claude judgment (+ web search) ──> judgments.json
                                     │ rules                                                      │
                                     ▼                                                            ▼
              Yahoo, FRED, CFTC, CoinGecko, Treasury, World Bank, ECB, Google News      engine.finalize (scoring, alerts)
                                                                                                  │
                                                                                                  ▼
                                                                  dashboard database (runs / subj / prices / hist)
```
| Flowchart step | Rules (engine) | Claude (agent) |
|---|---|---|
| Specification | Watchlist from `config/watchlist` | – |
| Information process | Headlines + source tier, rumor/hedge/opinion flags | Filter, classify Fact/Estimate/Opinion/Rumor, corroborate, narratives, bias checks |
| Bottom-up × top-down | 7 regime factors from FRED → per-subject sensitivity profiles | Sourced fundamentals; overrides with reasons |
| Market behaviour | Trend, momentum, RSI, vol regime, relative strength | Interpretation |
| Flows | CFTC TFF positioning, z-scores, crowding | ETF/foreign/insider/politician flows |
| Plausibility | Vol-based baseline scenarios, EV, Kelly | Probability tilts with mechanism + trigger |
| Summary | Composite conviction, change alerts | Brief, invalidation, actions |

## Layout
- `engine/` – stdlib-only Python: `collect.py` (phase 1), `finalize.py` (phase 2), `snapshot.py`, `collectors.py`, `quant.py`, `config.py`
- `RUNBOOK.md` – the instructions each scheduled session follows
- `dashboard/` – the published page (reads the database; bundled snapshot as fallback)

## Run locally
```bash
python3 -m engine.collect --out work      # needs network access to the data hosts
# write work/judgments.json (see RUNBOOK.md), or skip for rules-only
python3 -m engine.finalize --work work
python3 -m engine.snapshot --work work
```
Analytical tooling, not investment advice.

## Network hosts the engine needs
query1.finance.yahoo.com, fred.stlouisfed.org, publicreporting.cftc.gov, api.coingecko.com, api.fiscaldata.treasury.gov, api.worldbank.org,
api.frankfurter.dev, news.google.com, apewisdom.io, tradestie.com, and optionally www.reddit.com + oauth.reddit.com (needs a Reddit app key).

## Collaborating
See CONTRIBUTING.md and CLAUDE.md.
