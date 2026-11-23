# Working on Market Desk together

1. **Branch:** `git checkout -b feature/<short-name>`. Never push straight to `main`: the daily runs use `main`.
2. **Test locally** (see CLAUDE.md). For engine changes, run collect + finalize and check the printed scores and WARN lines.
3. **Pull request** into `main` with a short description; the other person reviews and merges.
4. **Dashboard changes** go live when someone with Editor access on the artifact asks Claude to republish `dashboard/` to the same link.
5. **Watchlist and holdings** are edited in the dashboard (Automation and Builder tabs), not in code. `engine/config.py` holds only defaults.

Live data needs network access to the hosts listed in README.md. In Claude Code on the web, create an environment that allows them.
