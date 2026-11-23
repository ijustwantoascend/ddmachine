/* UI controller for portfolio, forecast, stress, hedge, macro and sources tabs. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const pct = (x, d = 1) => (x == null || !isFinite(x) ? '–' : (x * 100).toFixed(d) + '%');
  const num = (x, d = 2) => (x == null || !isFinite(x) ? '–' : (+x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const money = x => (x == null || !isFinite(x) ? '–' : (x < 0 ? '−' : '') + '$' + Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 0 }));
  const cls = x => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const palette = () => ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7'].map(css);
  const kpi = (l, v, d = '', c = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${c}">${v}</div><div class="d">${d}</div></div>`;

  const CLASSES = ['Equity', 'Intl Equity', 'Bonds', 'Credit', 'Real Estate', 'Commodities', 'Gold', 'Crypto', 'Cash'];

  // ---------- charts ----------
  const charts = {};
  function chart(id, cfg) {
    if (typeof Chart === 'undefined') { const el = document.getElementById(id); if (el) el.parentElement.innerHTML = '<p class="hint">Chart library failed to load (offline?).</p>'; return null; }
    if (charts[id]) charts[id].destroy();
    const grid = css('--line'), tick = css('--muted');
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: tick, boxWidth: 12 } } } }, cfg.options || {});
    cfg.options.scales = cfg.options.scales || {};
    ['x', 'y'].forEach(ax => {
      cfg.options.scales[ax] = Object.assign({ grid: { color: grid }, ticks: { color: tick, maxTicksLimit: 8 } }, cfg.options.scales[ax] || {});
    });
    charts[id] = new Chart(document.getElementById(id), cfg);
    return charts[id];
  }
  const line = (label, data, color, extra = {}) => Object.assign({ label, data, borderColor: color, backgroundColor: color, borderWidth: 1.6, pointRadius: 0, tension: 0.1 }, extra);

  // ---------- nav & theme ----------
  function showTab(name) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
    $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
    if (name === 'stress') renderStress();
    window.dispatchEvent(new CustomEvent('tabshown', { detail: name }));
  }
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1).split('/')[0] || 'overview'));
  $('#themeBtn').onclick = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark';
    LS.set('md.theme', document.documentElement.dataset.theme);
    Object.values(charts).forEach(c => c && c.destroy());
    if (App.pf) renderPortfolio();
    if (App.mc) renderMC();
    window.dispatchEvent(new Event('themechange'));
  };
  const savedTheme = LS.get('md.theme', null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  // ---------- holdings ----------
  let holdings = [];
  let holdingsDirty = false;
  function syncHoldings() {
    if (holdingsDirty) return;
    const p = Store.portfolio();
    holdings = (p.holdings || []).map(h => ({ ...h }));
    if (p.bench) $('#pfBench').value = p.bench;
    if (p.rf != null) $('#pfRf').value = p.rf;
    renderHoldings();
  }
  function renderHoldings() {
    const tb = $('#holdTbl tbody');
    tb.innerHTML = holdings.map((h, i) => `<tr>
      <td><input data-i="${i}" data-k="sym" value="${esc(h.sym)}" aria-label="Symbol"></td>
      <td><select data-i="${i}" data-k="cls" aria-label="Asset class">${CLASSES.map(c => `<option ${c === h.cls ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><input data-i="${i}" data-k="w" type="number" step="1" value="${+(+h.w).toFixed(2)}" aria-label="Weight"></td>
      <td><button class="ghost small" data-del="${i}" aria-label="Remove">✕</button></td></tr>`).join('') +
      `<tr><td colspan="2" class="muted">Total</td><td><b>${num(holdings.reduce((s, h) => s + +h.w, 0), 1)}%</b></td><td></td></tr>`;
    tb.querySelectorAll('input,select').forEach(el => el.onchange = () => {
      const h = holdings[+el.dataset.i]; const k = el.dataset.k;
      h[k] = k === 'w' ? +el.value : k === 'sym' ? el.value.trim().toUpperCase() : el.value;

      saveHold(); renderHoldings();
    });
    tb.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { holdings.splice(+b.dataset.del, 1); saveHold(); renderHoldings(); });
  }
  const saveHold = () => { holdingsDirty = true; };
  $('#saveHold').onclick = async () => {
    const msg = $('#pfMsg');
    try {
      await Store.saveConfig('portfolio', { holdings: holdings.filter(h => h.sym), bench: $('#pfBench').value.trim().toUpperCase(), rf: +$('#pfRf').value || 0, savedAt: new Date().toISOString() });
      holdingsDirty = false; msg.className = 'msg ok'; msg.textContent = 'Saved. The next run will collect prices for any new symbols.';
    } catch (e) { msg.className = 'msg err'; msg.textContent = e.message || String(e.code); }
  };
  $('#addHold').onclick = () => { holdings.push({ sym: '', cls: 'Equity', w: 0 }); renderHoldings(); };
  $('#normHold').onclick = () => { const s = holdings.reduce((a, h) => a + +h.w, 0) || 1; holdings.forEach(h => h.w = +(h.w * 100 / s).toFixed(2)); saveHold(); renderHoldings(); };

  // ---------- portfolio analysis ----------
  const App = (window.App = { charts, chart, line, pct, num, money, esc, cls, kpi, palette, css, showTab, holdings: () => holdings });

  async function buildPortfolio() {
    const msg = $('#pfMsg'); msg.className = 'msg'; msg.textContent = 'Loading prices…';
    const syms = holdings.filter(h => h.sym).map(h => h.sym);
    const bench = $('#pfBench').value.trim().toUpperCase();
    const all = [...new Set([...syms, bench].filter(Boolean))];
    const loaded = {}, errors = [];
    await Promise.all(all.map(async s => { try { loaded[s] = await Store.getSeries(s); } catch (e) { errors.push(e.message); } }));
    const ok = syms.filter(s => loaded[s]);
    if (!ok.length) { msg.className = 'msg err'; msg.textContent = errors.join('\n') || 'No holdings.'; return null; }
    const look = Math.max(0.5, +$('#pfLook').value || 3);
    const map = {}; ok.forEach(s => map[s] = loaded[s]);
    if (loaded[bench]) map['__bench'] = loaded[bench];
    const al = Q.align(map);
    const keep = Math.min(al.dates.length, Math.round(look * Q.TD) + 1);
    const dates = al.dates.slice(-keep);
    if (dates.length < 60) { msg.className = 'msg err'; msg.textContent = `Only ${dates.length} overlapping dates. Need 60+. Check symbols or shorten the lookback.`; return null; }
    const px = {}; Object.keys(al.prices).forEach(k => px[k] = al.prices[k].slice(-keep));
    const rets = ok.map(s => Q.returns(px[s]));
    const benchR = px['__bench'] ? Q.returns(px['__bench']) : null;
    const wRaw = ok.map(s => +holdings.find(h => h.sym === s).w || 0);
    const wsum = wRaw.reduce((a, b) => a + b, 0) || 1;
    const w = wRaw.map(x => x / wsum);
    const rf = (+$('#pfRf').value || 0) / 100;
    const C = Q.covMatrix(rets).map(r => r.map(x => x * Q.TD));
    const mu = rets.map(r => Q.mean(r) * Q.TD);
    const pr = Q.portfolioReturns(rets, w);
    const synthetic = ok.some(s => loaded[s].synthetic);
    App.pf = { syms: ok, cls: ok.map(s => holdings.find(h => h.sym === s).cls), dates, px, rets, benchR, bench, w, rf, C, mu, pr, synthetic,
      m: Q.metrics(pr, rf, benchR), bm: benchR ? Q.metrics(benchR, rf) : null, sources: [...new Set(ok.map(s => loaded[s].source))] };
    msg.className = errors.length ? 'msg err' : 'msg ok';
    msg.textContent = (errors.length ? errors.join('\n') + '\n' : '') + `${ok.length} assets · ${dates[0]} → ${dates[dates.length - 1]} · ${dates.length} days · ${App.pf.sources.join(', ')}` +
      (Math.abs(wsum - 100) > 0.5 ? `\nWeights summed to ${num(wsum, 1)}%; normalized for analysis.` : '');
    renderPortfolio();
    window.dispatchEvent(new Event('portfolio'));
    return App.pf;
  }
  App.buildPortfolio = buildPortfolio;

  function renderPortfolio() {
    const p = App.pf; if (!p) return;
    const m = p.m, b = p.bm;
    $('#pfKpis').innerHTML = [
      kpi('CAGR', pct(m.cagr), b ? `Benchmark ${pct(b.cagr)}` : '', cls(m.cagr)),
      kpi('Volatility (ann.)', pct(m.vol), b ? `Benchmark ${pct(b.vol)}` : ''),
      kpi('Sharpe / Sortino', `${num(m.sharpe)} / ${num(m.sortino)}`, `rf ${pct(p.rf)}`),
      kpi('Max drawdown', pct(m.mdd), `Calmar ${num(m.calmar)}`, 'neg'),
      kpi('1-day VaR 95% / CVaR', `${pct(m.var95, 2)} / ${pct(m.cvar95, 2)}`, `99% VaR ${pct(m.var99, 2)}`),
      kpi('Beta vs ' + esc(p.bench), num(m.beta), `Corr ${num(m.corrBench)} · α ${pct(m.alpha)}`),
      kpi('Diversification ratio', num(Q.diversificationRatio(p.w, p.C)), '>1 = diversification benefit'),
      kpi('Skew / excess kurtosis', `${num(m.skew)} / ${num(m.kurt)}`, m.kurt > 1 ? 'Fat tails: VaR understates' : 'Near-normal tails'),
    ].join('');
    const col = palette();
    const labels = p.dates;
    const eq = Q.cumulative(p.pr);
    const ds = [line('Portfolio', eq, col[0])];
    if (p.benchR) ds.push(line(p.bench, Q.cumulative(p.benchR), col[6], { borderDash: [4, 3] }));
    chart('chEquity', { type: 'line', data: { labels, datasets: ds } });
    const ddp = Q.drawdownSeries(eq).map(x => x * 100);
    const ddsets = [line('Portfolio', ddp, col[4], { fill: true, backgroundColor: col[4] + '33' })];
    if (p.benchR) ddsets.push(line(p.bench, Q.drawdownSeries(Q.cumulative(p.benchR)).map(x => x * 100), col[6], { borderDash: [4, 3] }));
    chart('chDD', { type: 'line', data: { labels, datasets: ddsets }, options: { scales: { y: { ticks: { callback: v => v + '%', color: css('--muted') } } } } });

    const cap = Math.max(1 / p.syms.length, (+$('#pfCap').value || 100) / 100);
    const fr = Q.frontier(p.mu, p.C, cap, 18);
    chart('chFrontier', { type: 'scatter', data: { datasets: [
      { label: 'Frontier', data: fr.map(f => ({ x: f.vol * 100, y: f.ret * 100 })), showLine: true, borderColor: col[0], backgroundColor: col[0], pointRadius: 0, borderWidth: 2 },
      { label: 'Assets', data: p.syms.map((s, i) => ({ x: Math.sqrt(p.C[i][i]) * 100, y: p.mu[i] * 100, s })), backgroundColor: col[6], pointRadius: 4 },
      { label: 'Current', data: [{ x: Math.sqrt(Q.quad(p.w, p.C)) * 100, y: Q.dot(p.w, p.mu) * 100 }], backgroundColor: col[2], pointRadius: 7, pointStyle: 'rectRot' },
    ] }, options: { interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { labels: { color: css('--muted') } }, tooltip: { callbacks: { label: c => `${c.raw.s || c.dataset.label}: vol ${c.raw.x.toFixed(1)}%, ret ${c.raw.y.toFixed(1)}%` } } },
      scales: { x: { title: { display: true, text: 'Volatility %', color: css('--muted') } }, y: { title: { display: true, text: 'Return %', color: css('--muted') } } } } });

    const rc = Q.riskContributions(p.w, p.C);
    chart('chRC', { type: 'bar', data: { labels: p.syms, datasets: [
      { label: 'Weight %', data: p.w.map(x => x * 100), backgroundColor: col[0] },
      { label: 'Risk contribution %', data: rc.map(x => x * 100), backgroundColor: col[2] }] }, options: { interaction: { mode: 'index' } } });

    $('#assetTbl').innerHTML = `<table class="tbl num"><thead><tr><th>Asset</th><th>Class</th><th>Weight</th><th>Ann. return</th><th>Vol</th><th>Sharpe</th><th>Max DD</th><th>Beta</th><th>Risk contrib.</th></tr></thead><tbody>${
      p.syms.map((s, i) => { const am = Q.metrics(p.rets[i], p.rf, p.benchR); return `<tr><td><b>${esc(s)}</b></td><td style="text-align:left">${esc(p.cls[i])}</td><td>${pct(p.w[i])}</td><td class="${cls(am.annReturn)}">${pct(am.annReturn)}</td><td>${pct(am.vol)}</td><td>${num(am.sharpe)}</td><td class="neg">${pct(am.mdd)}</td><td>${num(am.beta)}</td><td class="${rc[i] > p.w[i] * 1.5 ? 'warnc' : ''}">${pct(rc[i])}</td></tr>`; }).join('')}</tbody></table>
      <p class="hint">Risk contribution far above weight (amber) means the position dominates portfolio risk.${p.synthetic ? ' <b class="warnc">Synthetic demo prices: figures illustrate the method only.</b>' : ''}</p>`;
    const R = Q.corrMatrix(p.rets);
    const heat = v => { const a = Math.min(1, Math.abs(v)); const c = v >= 0 ? css('--c5') : css('--c1'); return `background:${c}${Math.round(a * 0.75 * 255).toString(16).padStart(2, '0')}`; };
    $('#corrTbl').innerHTML = `<table class="tbl heat"><thead><tr><th></th>${p.syms.map(s => `<th>${esc(s)}</th>`).join('')}</tr></thead><tbody>${
      R.map((row, i) => `<tr><th>${esc(p.syms[i])}</th>${row.map(v => `<td style="${heat(v)}">${v.toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  $('#pfRun').onclick = buildPortfolio;
  $$('.opt').forEach(b => b.onclick = async () => {
    if (!App.pf) await buildPortfolio();
    const p = App.pf; if (!p) return;
    const cap = Math.max(1 / p.syms.length, (+$('#pfCap').value || 100) / 100);
    const n = p.syms.length;
    let w;
    switch (b.dataset.opt) {
      case 'equal': w = Array(n).fill(1 / n); break;
      case 'invvol': w = Q.projectCappedSimplex(Q.inverseVol(p.C), cap); break;
      case 'minvar': w = Q.minVariance(p.C, cap); break;
      case 'rp': w = Q.projectCappedSimplex(Q.riskParity(p.C), cap); break;
      case 'maxsharpe': w = Q.maxSharpe(p.mu, p.C, p.rf, cap); break;
    }
    p.syms.forEach((s, i) => { const h = holdings.find(x => x.sym === s); h.w = +(w[i] * 100).toFixed(2); });
    saveHold(); renderHoldings(); buildPortfolio();
  });

  // ---------- Monte Carlo ----------
  async function runMC() {
    if (!App.pf) await buildPortfolio();
    const p = App.pf; if (!p) { $('#mcKpis').innerHTML = '<p class="msg err">Build a portfolio first.</p>'; return; }
    const years = Math.max(0.25, +$('#mcYears').value || 5), start = +$('#mcStart').value || 100000;
    const drift = $('#mcDrift').value === '' ? null : +$('#mcDrift').value / 100;
    const method = $('#mcMethod').value;
    const res = Q.monteCarlo({ hist: p.pr, days: Math.round(years * Q.TD), paths: Math.min(20000, +$('#mcPaths').value || 3000), start, method,
      contrib: +$('#mcContrib').value || 0, driftOverride: method === 'bootstrap' ? drift : null, mu: method === 'gbm' ? (drift ?? p.m.annReturn) : null, sigma: method === 'gbm' ? p.m.vol : null });
    App.mc = { res, years, start, target: +$('#mcTarget').value || 0, contrib: +$('#mcContrib').value || 0 };
    renderMC();
  }
  function renderMC() {
    const { res, years, start, target, contrib } = App.mc;
    const f = res.finals, invested = start + contrib * years;
    const pLoss = f.filter(x => x < invested).length / f.length, pT = f.filter(x => x >= target).length / f.length;
    const med = Q.quantile(f, 0.5);
    $('#mcKpis').innerHTML = [
      kpi('Median ending value', money(med), `CAGR ${pct((med / start) ** (1 / years) - 1)}`),
      kpi('5th–95th percentile', `${money(Q.quantile(f, 0.05))} – ${money(Q.quantile(f, 0.95))}`, '90% of simulated outcomes'),
      kpi('P(reach target)', pct(pT, 0), money(target)),
      kpi('P(below amount invested)', pct(pLoss, 0), `Median worst drawdown ${pct(Q.quantile(res.mdds, 0.5))}`, pLoss > 0.2 ? 'neg' : ''),
    ].join('');
    const col = palette();
    const labels = res.t.map(t => (t / Q.TD).toFixed(1) + 'y');
    const b = res.bands;
    chart('chFan', { type: 'line', data: { labels, datasets: [
      line('95th', b[4], col[1] + '00', { fill: '+1', backgroundColor: col[0] + '22' }),
      line('75th', b[3], col[0] + '66', { fill: '+1', backgroundColor: col[0] + '44' }),
      line('Median', b[2], col[0], { borderWidth: 2.2 }),
      line('25th', b[1], col[0] + '66', { fill: '-1', backgroundColor: col[0] + '44' }),
      line('5th', b[0], col[4] + '00', { fill: '-1', backgroundColor: col[0] + '22' }),
      line('Target', b[2].map(() => target), col[2], { borderDash: [5, 4], borderWidth: 1 }),
    ] }, options: { scales: { y: { ticks: { callback: v => money(v), color: css('--muted') } } } } });
    const lo = Q.quantile(f, 0.01), hi = Q.quantile(f, 0.99), bins = 40, w = (hi - lo) / bins || 1, h = Array(bins).fill(0);
    f.forEach(x => { if (x >= lo && x <= hi) h[Math.min(bins - 1, Math.floor((x - lo) / w))]++; });
    chart('chMcHist', { type: 'bar', data: { labels: h.map((_, i) => money(lo + w * (i + 0.5))), datasets: [{ label: 'Paths', data: h, backgroundColor: h.map((_, i) => (lo + w * (i + 0.5) < invested ? col[4] : col[0])) }] },
      options: { plugins: { legend: { display: false } } } });
  }
  $('#mcRun').onclick = runMC;

  // ---------- Stress ----------
  // Approximate peak-to-trough total-return moves by asset class, rounded. Editable; verify before relying on them.
  const PRESETS = {
    'Global Financial Crisis (Oct 2007 – Mar 2009)': { Equity: -51, 'Intl Equity': -58, Bonds: 15, Credit: -8, 'Real Estate': -68, Commodities: -55, Gold: 20, Crypto: 0, Cash: 2 },
    'COVID crash (Feb 19 – Mar 23, 2020)': { Equity: -34, 'Intl Equity': -33, Bonds: 5, Credit: -13, 'Real Estate': -42, Commodities: -30, Gold: -3, Crypto: -40, Cash: 0 },
    '2022 inflation & rate shock (Jan – Oct 2022)': { Equity: -24, 'Intl Equity': -27, Bonds: -16, Credit: -21, 'Real Estate': -31, Commodities: 15, Gold: -8, Crypto: -70, Cash: 1 },
    'Dot-com bust (Mar 2000 – Oct 2002)': { Equity: -47, 'Intl Equity': -48, Bonds: 25, Credit: 20, 'Real Estate': 30, Commodities: 10, Gold: 15, Crypto: 0, Cash: 10 },
    'Stagflation (hypothetical)': { Equity: -25, 'Intl Equity': -28, Bonds: -15, Credit: -18, 'Real Estate': -20, Commodities: 25, Gold: 20, Crypto: -50, Cash: 2 },
    'Liquidity crunch / risk-off (hypothetical)': { Equity: -20, 'Intl Equity': -25, Bonds: 6, Credit: -10, 'Real Estate': -25, Commodities: -20, Gold: 3, Crypto: -55, Cash: 0 },
    'Custom': Object.fromEntries(CLASSES.map(c => [c, 0])),
  };
  let shocks = LS.get('md.shocks', null);
  $('#stPreset').innerHTML = Object.keys(PRESETS).map(k => `<option>${k}</option>`).join('');
  $('#stPreset').onchange = () => { shocks = { ...PRESETS[$('#stPreset').value] }; renderStress(); };
  $('#stValue').onchange = renderStress;
  function renderStress() {
    if (!shocks) shocks = { ...PRESETS[$('#stPreset').value] };
    const V = +$('#stValue').value || 0;
    const tot = holdings.reduce((s, h) => s + +h.w, 0) || 1;
    const byCls = {}; CLASSES.forEach(c => byCls[c] = 0);
    holdings.forEach(h => byCls[h.cls] = (byCls[h.cls] || 0) + (+h.w / tot));
    let pnl = 0; const contrib = [];
    $('#stTbl tbody').innerHTML = CLASSES.map(c => {
      const sh = shocks[c] ?? 0, x = byCls[c] * sh / 100 * V; pnl += x; contrib.push(x);
      return `<tr><td>${c}</td><td><input type="number" step="1" data-c="${c}" value="${sh}" aria-label="${c} shock"></td><td>${pct(byCls[c])}</td><td class="${cls(x)}">${money(x)}</td></tr>`;
    }).join('');
    $$('#stTbl input').forEach(el => el.onchange = () => { shocks[el.dataset.c] = +el.value; LS.set('md.shocks', shocks); renderStress(); });
    $('#stKpis').innerHTML = kpi('Scenario P&amp;L', money(pnl), pct(pnl / (V || 1)), cls(pnl)) + kpi('Value after shock', money(V + pnl), 'Before any hedges');
    const col = palette();
    chart('chStress', { type: 'bar', data: { labels: CLASSES, datasets: [{ label: 'P&L', data: contrib, backgroundColor: contrib.map(x => (x < 0 ? col[4] : col[1])) }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, interaction: { mode: 'nearest', intersect: true }, scales: { x: { ticks: { callback: v => money(v), color: css('--muted') } } } } });
    const p = App.pf;
    if (!p) { $('#stHist').innerHTML = '<p class="hint">Run “Analyze portfolio” in Builder to see the worst historical windows.</p>'; return; }
    const worst = k => { const eq = Q.cumulative(p.pr); let w = 0, at = 0; for (let i = k; i < eq.length; i++) { const r = eq[i] / eq[i - k] - 1; if (r < w) { w = r; at = i; } } return [w, p.dates[at] || '']; };
    $('#stHist').innerHTML = `<table class="tbl num"><thead><tr><th>Window</th><th>Worst return</th><th>Ending</th><th>On portfolio value</th></tr></thead><tbody>${
      [[1, '1 day'], [5, '1 week'], [21, '1 month'], [63, '1 quarter']].map(([k, l]) => { const [w, d] = worst(k); return `<tr><td>${l}</td><td class="neg">${pct(w)}</td><td>${d}</td><td class="neg">${money(w * V)}</td></tr>`; }).join('')}</tbody></table>`;
  }

  // ---------- Hedge ----------
  const outLines = rows => rows.map(([k, v, c]) => `<div class="line"><span>${k}</span><b class="${c || ''}">${v}</b></div>`).join('');
  $('#hgRun').onclick = async () => {
    if (!App.pf) await buildPortfolio();
    const p = App.pf; const out = $('#hgOut');
    if (!p) { out.innerHTML = '<p class="msg err">Build a portfolio first.</p>'; return; }
    try {
      const s = await Store.getSeries($('#hgSym').value.trim().toUpperCase());
      const al = Q.align({ pf: { dates: p.dates, close: Q.cumulative(p.pr) }, h: s });
      const r1 = Q.returns(al.prices.pf), r2 = Q.returns(al.prices.h);
      const hr = Q.hedgeRatio(r1, r2);
      const V = +$('#hgValue').value, F = +$('#hgPx').value, m = +$('#hgMult').value || 1;
      const N = (hr.h * V) / (F * m);
      out.innerHTML = outLines([
        ['Hedge ratio h*', num(hr.h, 3)], ['Correlation ρ', num(hr.rho, 3)], ['Hedge effectiveness (R²)', pct(hr.effectiveness)],
        ['Contracts to sell', num(N, 1), 'neg'], ['Notional hedged', money(hr.h * V)],
        ['Vol unhedged → hedged', `${pct(hr.volSpot)} → ${pct(hr.volHedged)}`, 'pos'],
      ]) + `<p class="hint">Based on ${r1.length} overlapping daily returns. Ratios drift over time, so re-estimate regularly. Low R² means large basis risk.</p>`;
      $('#btBeta').value = (p.m.beta ?? 1).toFixed(2);
    } catch (e) { out.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
  };
  $('#btRun').onclick = () => {
    const b = +$('#btBeta').value, t = +$('#btTarget').value, V = +$('#btValue').value, F = +$('#btPx').value, m = +$('#btMult').value || 1;
    const N = ((t - b) * V) / (F * m);
    $('#btOut').innerHTML = outLines([['Contracts', `${N < 0 ? 'Sell' : 'Buy'} ${num(Math.abs(N), 1)}`, N < 0 ? 'neg' : 'pos'], ['Beta-adjusted exposure change', money((t - b) * V)], ['Rounded contracts', Math.round(N)],
      ['Residual beta after rounding', num(b + (Math.round(N) * F * m) / V, 3)]]);
  };
  $('#opRun').onclick = () => {
    const S = +$('#opS').value, Qn = +$('#opQ').value, K1 = +$('#opK1').value, K2 = +$('#opK2').value, T = (+$('#opT').value) / 365;
    const v = +$('#opV').value / 100, r = +$('#opR').value / 100, q = +$('#opQd').value / 100, st = $('#opStrat').value;
    const put = Q.bs('put', S, K1, T, r, v, q), call = Q.bs('call', S, K2, T, r, v, q), putLo = Q.bs('put', S, K2, T, r, v, q);
    let legs, label;
    if (st === 'put') { legs = [{ t: 'put', K: K1, n: 1, px: put.price, g: put }]; label = `Long ${K1} put`; }
    else if (st === 'collar') { legs = [{ t: 'put', K: K1, n: 1, px: put.price, g: put }, { t: 'call', K: K2, n: -1, px: call.price, g: call }]; label = `Long ${K1} put / short ${K2} call`; }
    else if (st === 'cc') { legs = [{ t: 'call', K: K2, n: -1, px: call.price, g: call }]; label = `Short ${K2} call`; }
    else { legs = [{ t: 'put', K: K1, n: 1, px: put.price, g: put }, { t: 'put', K: K2, n: -1, px: putLo.price, g: putLo }]; label = `Long ${K1} / short ${K2} put spread (set lower strike < put strike)`; }
    const cost = legs.reduce((s, l) => s + l.n * l.px, 0) * Qn;
    const greek = k => legs.reduce((s, l) => s + l.n * l.g[k], 0) * Qn;
    const pay = x => legs.reduce((s, l) => s + l.n * (l.t === 'put' ? Math.max(0, l.K - x) : Math.max(0, x - l.K)), 0);
    const xs = []; for (let x = S * 0.6; x <= S * 1.4 + 1e-9; x += S * 0.01) xs.push(+x.toFixed(2));
    const un = xs.map(x => (x - S) * Qn), he = xs.map(x => (x - S + pay(x)) * Qn - cost);
    const floor = Math.min(...he), cap = Math.max(...he);
    $('#opOut').innerHTML = outLines([['Structure', label], ['Net premium', `${money(cost)} (${pct(cost / (S * Qn), 2)} of notional)`, cost > 0 ? 'neg' : 'pos'],
      ['Max loss in range shown', money(floor), 'neg'], ['Max gain in range shown', money(cap), 'pos'],
      ['Delta (shares equiv.)', num(Qn + greek('delta'), 0)], ['Gamma / Vega(1 vol pt) / Theta(day)', `${num(greek('gamma'), 2)} / ${money(greek('vega'))} / ${money(greek('theta'))}`]]) +
      `<p class="hint">Black-Scholes with flat implied vol. Real quotes include skew (OTM puts cost more) and bid/ask spreads.</p>`;
    const col = palette();
    chart('chPayoff', { type: 'line', data: { labels: xs, datasets: [line('Unhedged', un, col[6], { borderDash: [4, 3] }), line('Hedged', he, col[0], { borderWidth: 2.4 })] },
      options: { scales: { x: { title: { display: true, text: 'Underlying price at expiry', color: css('--muted') } }, y: { ticks: { callback: v => money(v), color: css('--muted') } } } } });
  };

  // ---------- init ----------
  Store.on(syncHoldings);
  syncHoldings();
  showTab(location.hash.slice(1).split('/')[0] || 'overview');
})();
