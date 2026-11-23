# Market Desk (ddmachine): notes for Claude sessions

Automated market research: a scheduled Claude session runs `RUNBOOK.md` every run. Read it before changing the pipeline.

## Architecture
- `engine/` is stdlib-only Python (no pip installs, on purpose: scheduled sessions run it cold).
  - `collect.py`: phase 1. Data, rule-based scoring, `work/collected.json` + `work/digest.md`
  - `finalize.py`: phase 2. Merges the agent's `work/judgments.json`, computes conviction and alerts, writes `work/out/*.json` database docs
  - `collectors.py` (prices, FRED, CFTC, CoinGecko, Treasury, World Bank, FX, Google News), `crowd.py` (ApeWisdom, Tradestie, Reddit), `quant.py`, `config.py` (default watchlist, profiles), `snapshot.py`
- `dashboard/` is the published page (claude.ai artifact https://claude.ai/artifact/AaceZus6QeKmgcYa1d1pAM).
  Vanilla JS, no build. It reads the artifact database (`state/latest` → `runs/<id>`, `subj/<id>--<subject>`, `prices/<id>--pN`, `hist/<id>`;
  config in `config/watchlist|portfolio|automation`). `data/snapshot.js` is the offline fallback.
- `js/quant.js` (math), `js/store.js` (data), `js/app.js` (portfolio/forecast/stress/hedge), `js/research.js` (overview, pipeline report, macro, desk chat, automation).

## Rules
- Never commit API keys. Credentials live in the cloud environment's network secrets, not in code.
- Data sources must be accessed honestly (descriptive User-Agent, respect rate limits and refusals; no browser impersonation, no scrapers that refuse automated clients).
- Missing data is recorded as a data gap. Never fabricate or fill it with placeholder market data.
- Keep document bodies under 250 KB (the artifact DB limit is 256 KiB) and the doc count bounded (runbook prunes to 90 runs).
- Changing the `judgments.json` shape means updating `RUNBOOK.md`, `finalize.py` and `research.js` together.

## Test
```bash
python3 -m engine.collect --out work && python3 -m engine.finalize --work work && python3 -m engine.snapshot --work work --dest /tmp/snap.js
```
Dashboard: open `dashboard/index.html` locally (it falls back to the bundled snapshot); Playwright + Chromium work for screenshots.
Republishing the dashboard to the same URL needs a Claude session whose user has Editor access to the artifact.
