/* Automated research views: overview, 7-step pipeline report, macro regime, desk chat, automation. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const { pct, num, money, esc, cls, kpi, chart, line, palette, css } = App;
  const S = Store;
  const sgn = x => (x > 0 ? '+' : '') ;
  const fmtScore = x => (x == null ? '–' : `${x > 0 ? '+' : ''}${(+x).toFixed(0)}`);
  const ago = iso => { const m = (Date.now() - Date.parse(iso)) / 60000; return m < 90 ? `${Math.round(m)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const local = iso => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const link = (txt, url) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(txt)}</a>` : esc(txt));
  const pill = (t, k = '') => `<span class="pill ${k}">${esc(t)}</span>`;
  const by = b => `<span class="by ${b === 'agent' ? 'agent' : 'rule'}" title="${b === 'agent' ? 'Judgment by the Claude research agent' : 'Computed by deterministic rules'}">${b === 'agent' ? 'Claude' : 'rule'}</span>`;
  const STEPS = ['Specification', 'Information process', 'Bottom-up × Top-down', 'Market behaviour', 'Flows', 'Plausibility', 'Summary'];
  let current = null;

  // ---------- header / badge ----------
  function renderChrome() {
    const b = $('#dataBadge');
    b.className = 'badge ' + (S.mode === 'live' ? 'ok' : 'warn');
    b.textContent = S.mode === 'live' ? 'Live: automated runs' : S.mode === 'snapshot' ? 'Snapshot' : S.mode === 'loading' ? 'Loading…' : 'No data';
    const note = $('#modeNote');
    note.hidden = !S.note; note.textContent = S.note || '';
    if (!S.run) return;
    const st = S.config.automation;
    $('#runLine').innerHTML = `Last run <b>${local(S.run.at)}</b> (${ago(S.run.at)}) · run ${esc(S.run.runId)}` + (st && st.schedule ? ` · schedule: ${esc(st.schedule)}` : '');
  }

  // ---------- overview ----------
  function renderOverview() {
    const r = S.run; if (!r) return;
    $('#regimeStrip').innerHTML = Object.values(r.regime).map(f => {
      const v = f.signal; const w = v == null ? 0 : Math.abs(v) * 50;
      return `<div class="rg"><div class="rg-l">${esc(f.label)}</div><div class="rg-bar"><div class="rg-fill ${v >= 0 ? 'p' : 'n'}" style="width:${w}%;${v >= 0 ? 'left:50%' : `left:${50 - w}%`}"></div></div><div class="rg-v ${cls(v)}">${v == null ? 'n/a' : (v > 0 ? '+' : '') + v.toFixed(2)}</div></div>`;
    }).join('');
    $('#macroNote').textContent = r.macro_note ? 'Agent: ' + r.macro_note : '';
    const al = r.alerts || [];
    $('#alertCount').textContent = `${al.length} this run`;
    $('#alertList').innerHTML = al.length ? al.slice(0, 12).map(a => `<a class="al ${a.level}" href="#research/${a.subject}"><b>${esc(a.name)}</b>${a.by === 'agent' ? ' ' + by('agent') : ''}<span>${esc(a.text)}</span></a>`).join('') : '<p class="hint">No alerts.</p>';
    renderCrowd(r);
    const ids = r.subjects || Object.keys(r.summary);
    $('#cards').innerHTML = ids.map(id => {
      const s = r.summary[id]; if (!s) return '';
      const sub = S.subj[id];
      const unit = sub && sub.spec.type === 'Currency (FX)' ? '' : '';
      return `<a class="scard" href="#research/${id}">
        <div class="sc-top"><div><div class="sc-name">${esc(s.name)}</div><div class="sc-px">${s.last == null ? '' : num(s.last, s.last > 1000 ? 0 : 2) + unit} <span class="${cls(s.r1m)}">${pct(s.r1m)} 1m</span></div></div>
        <div class="sc-score ${cls(s.conviction)}">${fmtScore(s.conviction)}</div></div>
        <div class="gauge sm"><div class="pin" style="left:${(s.conviction + 100) / 2}%"></div></div>
        <div class="sc-lab">${esc(s.label)} ${s.alerts ? `<span class="pill bear">${s.alerts} alert${s.alerts > 1 ? 's' : ''}</span>` : ''}</div>
        <div class="sc-meta"><span>EV <b class="${cls(s.ev)}">${s.ev == null ? '–' : (s.ev > 0 ? '+' : '') + s.ev.toFixed(1) + '%'}</b></span><span>P(loss) <b>${s.pLoss == null ? '–' : pct(s.pLoss, 0)}</b></span><span>Trend <b class="${cls(s.trend)}">${s.trend == null ? '–' : (s.trend > 0 ? '+' : '') + s.trend + '/3'}</b></span>${s.crowd != null ? `<span>Crowd <b class="${cls(s.crowd)}">${s.crowd > 0 ? '+' : ''}${s.crowd.toFixed(2)}</b></span>` : ''}</div>
        <div class="sc-x">${esc(s.headline || s.xref || '')}</div></a>`;
    }).join('');
    const H = S.hist || [];
    if (H.length >= 2) {
      const col = palette();
      chart('chHist', { type: 'line', data: { labels: H.map(h => h.at.slice(0, 10)), datasets: ids.map((id, i) => line(r.summary[id] ? r.summary[id].name : id, H.map(h => (h.s[id] ? h.s[id].c : null)), col[i % col.length], { spanGaps: true, pointRadius: 2 })) },
        options: { scales: { y: { min: -100, max: 100 } } } });
      $('#histHint').textContent = '';
    } else {
      const c = $('#chHist'); if (App.charts.chHist) { App.charts.chHist.destroy(); delete App.charts.chHist; }
      c.getContext('2d').clearRect(0, 0, c.width, c.height);
      $('#histHint').textContent = 'History builds up with each scheduled run. One run so far.';
    }
  }

  // ---------- crowd ----------
  const share = x => (x == null ? '–' : Math.round(x * 100) + '%');
  function renderCrowd(r) {
    const c = r.crowd, el = $('#crowdBox');
    if (!c || (!Object.keys(c.threads || {}).length && !Object.keys(c.sources || {}).length)) {
      el.innerHTML = '<p class="hint">No crowd data this run. Reddit, ApeWisdom and Tradestie were unreachable from the run environment (see Automation → data gaps).</p>'; return;
    }
    const th = c.threads || {}, src = c.sources || {};
    el.innerHTML = `<div class="grid g4">${Object.entries(th).map(([k, t]) => kpi(`r/${k} bullish share`, share(t.bullShare), `${t.n} top comments · ${share(t.opinionated)} opinionated`, t.bullShare > 0.65 ? 'pos' : t.bullShare < 0.35 ? 'neg' : '')).join('')}</div>
      ${r.crowd_note ? `<p>${by('agent')} ${esc(r.crowd_note)}</p>` : ''}
      <div class="grid g2 mt">
        <div>${Object.entries(th).map(([k, t]) => `<h4>${link('r/' + k + ': ' + (t.title || ''), t.url)}</h4>
          <div class="chips">${(t.tickers || []).slice(0, 14).map(x => `<span class="pill ${x.net > 0.2 ? 'bull' : x.net < -0.2 ? 'bear' : ''}">${esc(x.ticker)} ${x.mentions}</span>`).join('')}</div>
          <p class="muted small">Frequent words: ${esc((t.themes || []).slice(0, 15).join(', '))}</p>`).join('')}</div>
        <div>${src.apewisdom_wsb ? `<h4>Most-mentioned on WSB (24h) ${by('rule')}</h4><table class="tbl num"><thead><tr><th>Ticker</th><th>Mentions</th><th>24h ago</th><th>Rank</th></tr></thead><tbody>${src.apewisdom_wsb.slice(0, 10).map(x => `<tr><td>${esc(x.ticker)}</td><td>${x.mentions}</td><td class="muted">${x.mentions_24h_ago}</td><td>${x.rank}${x.rank_24h_ago ? ` <span class="muted">(was ${x.rank_24h_ago})</span>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}</div>
      </div><p class="hint">Lexicon-scored from comment text and weighted by upvotes. Crowd sentiment is noisy and historically a contrarian signal at extremes: it is shown as evidence, not counted in conviction.</p>`;
  }

  // ---------- research report ----------
  function renderResearchSelect() {
    const ids = S.run ? S.run.subjects : [];
    $('#rsSelect').innerHTML = ids.map(id => `<option value="${id}" ${id === current ? 'selected' : ''}>${esc((S.subj[id] && S.subj[id].spec.name) || id)}</option>`).join('');
  }
  $('#rsSelect').onchange = e => { location.hash = 'research/' + e.target.value; };
  function renderResearch() {
    if (!S.run) return;
    if (!current || !S.subj[current]) current = S.run.subjects[0];
    renderResearchSelect();
    const d = S.subj[current]; if (!d) return;
    const sp = d.spec, cv = d.conviction;
    $('#rsTitle').textContent = sp.name;
    $('#rsSub').innerHTML = `${esc(sp.scope === 'micro' ? 'Micro-market' : 'Macro-market')} · ${esc(sp.type)} · horizon ${sp.horizon_m || 6} months · run ${esc(d.runId)} (${ago(d.at)})${d.agentRan ? '' : ' · <span class="warnc">agent judgments missing: rule-based pillars only</span>'}`;
    $('#rsConv').innerHTML = `<div><div class="muted" style="font-size:12px">Composite conviction</div><div class="score-big ${cls(cv.score)}">${fmtScore(cv.score)}</div><div style="font-size:13px">${esc(cv.label)}</div></div>
      <div><div class="gauge"><div class="pin" style="left:${(cv.score + 100) / 2}%"></div></div>
      <div class="subscores">${cv.parts.map(p => `<span>${p.pillar} <b class="${cls(p.value)}">${p.value >= 0 ? '+' : ''}${(p.value * 100).toFixed(0)}</b> <small>×${p.weight}</small></span>`).join('')}<span>Coverage <b>${cv.coverage}%</b></span></div>
      <div class="hint">Weighted blend of six pillars: rule-based (top-down, behaviour, positioning, baseline scenarios) and agent-judged (evidence, bottom-up, scenario tilts). It measures how consistent the evidence is, not certainty.</div></div>`;
    $('#rsNav').innerHTML = STEPS.map((s, i) => `<a href="#research/${current}" data-step="${i}"><span>${i + 1}</span>${s}</a>`).join('');
    $('#rsNav').querySelectorAll('a').forEach(a => a.onclick = e => { e.preventDefault(); document.getElementById('step' + a.dataset.step).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('#rsBody').innerHTML = [s1, s2, s3, s4, s5, s6, s7].map((f, i) => `<section class="card step" id="step${i}"><h2><span class="sn">${i + 1}</span>${STEPS[i]}</h2>${f(d)}</section>`).join('');
    drawResearchCharts(d);
    const cp = $('#copyBrief'); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(brief(d)); cp.textContent = 'Copied'; } catch (e) { cp.textContent = 'Clipboard blocked'; } };
    const ev = $('#evToMc'); if (ev) ev.onclick = () => { $('#mcDrift').value = (d.scenarioStats.ev * 12 / (sp.horizon_m || 6)).toFixed(1); location.hash = 'forecast'; };
  }
  const s1 = d => { const sp = d.spec; return `<div class="kv">
      <div><span>Decision question</span><b>${esc(sp.question)}</b></div>
      <div><span>Scope</span>${sp.scope === 'micro' ? 'Micro-market (asset / industry)' : 'Macro-market (sector / economy)'}</div>
      <div><span>Instrument(s)</span>${esc(sp.symbols.join(', '))}${sp.symbols.length > 1 ? ' (equal-weight basket)' : ''}${sp.bench ? ` vs ${esc(sp.bench)}` : ''}</div>
      <div><span>Macro profile</span>${esc(sp.profile)} · CFTC ${esc(sp.cot || 'n/a')}</div>
      <div><span>News query</span>${esc(sp.news || sp.name)}</div></div>`; };
  const s2 = d => {
    const es = d.evidenceStats || {};
    const warn = [];
    if (es.n >= 3 && (es.bullShare > 0.8 || es.bullShare < 0.2)) warn.push(['bad', `Evidence is one-sided (${pct(es.bullShare, 0)} bullish weight).`]);
    if (es.rumorShare > 0.2) warn.push(['bad', `Rumors carry ${pct(es.rumorShare, 0)} of the evidence weight.`]);
    if (es.n && !es.core) warn.push(['', 'No agent-curated evidence this run: raw headlines are shown as low-weight context only.']);
    else if (!warn.length && es.n) warn.push(['good', 'Balanced evidence set anchored in core facts.']);
    const bias = Object.entries(d.bias_checks || {});
    return `<div class="grid g4">${kpi('Net evidence', fmtScore(es.net * 100), 'weighted, −100…+100', cls(es.net))}${kpi('Bullish weight', pct(es.bullShare, 0), '50% = balanced')}${kpi('Rumor share', pct(es.rumorShare, 0), 'of weight', es.rumorShare > 0.2 ? 'neg' : '')}${kpi('Corroborated', `${es.corroborated || 0}/${es.n || 0}`, 'confirmed in a 2nd source')}</div>
      ${warn.map(w => `<div class="alert ${w[0]}">${w[1]}</div>`).join('')}
      <div class="scrollx"><table class="tbl"><thead><tr><th>Evidence</th><th>Type</th><th>Relevance</th><th>Dir.</th><th>Rel.</th><th>Weight</th><th></th></tr></thead><tbody>
      ${(d.evidence || []).map(e => `<tr><td>${link(e.claim, e.url)}<div class="muted small">${esc(e.source || '')}${e.corroborated ? ' · <span class="pos">corroborated</span>' : ''}${e.note ? ' · ' + esc(e.note) : ''}</div></td>
        <td>${pill(e.kind, e.kind === 'Rumor' ? 'rumor' : '')}</td><td>${esc(e.rel)}</td><td class="${cls(+e.dir)}">${+e.dir > 0 ? 'Bull' : +e.dir < 0 ? 'Bear' : '·'}</td><td>${e.rely}</td><td>${(e.weight ?? 0).toFixed(2)}</td><td>${by(e.by)}</td></tr>`).join('')}
      </tbody></table></div>
      ${(d.narratives || []).length ? `<h4>Narratives</h4>${d.narratives.map(n => `<div class="narr">${pill(n.status, n.status === 'priced in' ? '' : n.status === 'emerging' ? 'bull' : 'rumor')} <b>${esc(n.text)}</b> <span class="muted">${esc(n.note || '')}</span></div>`).join('')}` : ''}
      ${bias.length ? `<h4>Bias checks ${by('agent')}</h4><ul class="tight">${bias.map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('')}</ul>` : ''}
      ${crowdSection(d)}
      <details><summary>Raw headlines collected (${(d.headlines || []).length}) ${by('rule')}</summary><table class="tbl"><tbody>${(d.headlines || []).map(h => `<tr><td>${link(h.title, h.url)}<div class="muted small">${esc(h.source)} · ${esc(h.published)}</div></td><td>${pill(h.tier, h.tier === 'high' ? 'bull' : '')}</td><td>${['rumor', 'hedged', 'opinion'].filter(k => h[k]).map(k => pill(k, 'rumor')).join('')}</td></tr>`).join('')}</tbody></table></details>`;
  };
  function crowdSection(d) {
    const c = d.crowd; if (!c) return '';
    const slices = [...Object.entries(c.threads || {}).map(([k, v]) => ['r/' + k + ' daily thread', v]), ...Object.entries(c.subreddits || {}).map(([k, v]) => ['r/' + k, v])];
    if (!slices.length && !(c.apewisdom || []).length && !(c.tradestie || []).length && !d.crowd_read) return `<h4>Crowd sentiment</h4><p class="hint">No crowd data for ${esc((c.terms || []).join(', '))} this run.</p>`;
    return `<h4>Crowd sentiment ${by('rule')} <span class="muted small">terms: ${esc((c.terms || []).join(', '))}</span></h4>
      <div class="grid g4">${kpi('Crowd lean', c.lean == null ? '–' : (c.lean > 0 ? '+' : '') + c.lean.toFixed(2), `${c.volume} items · −1 bearish … +1 bullish`, cls(c.lean))}
      ${slices.slice(0, 3).map(([n, v]) => kpi(n, share(v.bullShare) + ' bullish', `${v.n} items`)).join('')}</div>
      ${c.extreme ? '<div class="alert bad">Crowd is at an extreme. Historically that is a contrarian warning, not confirmation.</div>' : ''}
      ${(c.apewisdom || []).length ? `<p class="small">ApeWisdom: ${c.apewisdom.map(x => `${esc(x.ticker)} rank #${x.rank}, ${x.mentions} mentions (${x.mentions_24h_ago} a day earlier)`).join(' · ')}</p>` : ''}
      ${(c.tradestie || []).length ? `<p class="small">Tradestie: ${c.tradestie.map(x => `${esc(x.ticker)} ${esc(x.sentiment)} on ${x.comments} comments`).join(' · ')}</p>` : ''}
      ${d.crowd_read ? `<p>${by('agent')} ${esc(d.crowd_read)}</p>` : ''}
      ${slices.length ? `<details><summary>Most-upvoted crowd comments</summary>${slices.map(([n, v]) => `<p class="muted small"><b>${esc(n)}</b></p><ul class="tight">${(v.samples || v.top || []).slice(0, 6).map(x => `<li><span class="${cls(x.lean)}">${x.lean > 0 ? '▲' : x.lean < 0 ? '▼' : '•'}</span> ${esc(x.text)} <span class="muted">(${x.score})</span></li>`).join('')}</ul>`).join('')}</details>` : ''}`;
  }
  function valuationBox(d) {
    const v = d.valuation || {}, e = d.eodhd || {};
    const big = x => (x == null ? '–' : x >= 1e12 ? (x / 1e12).toFixed(2) + 'T' : x >= 1e9 ? (x / 1e9).toFixed(1) + 'B' : x >= 1e6 ? (x / 1e6).toFixed(0) + 'M' : num(x, 0));
    const rows = Object.entries(v);
    let h = '';
    if (rows.length) h += `<h4>Valuation snapshot ${by('rule')} <span class="muted small">Google Finance</span></h4><div class="scrollx"><table class="tbl num"><thead><tr><th>Symbol</th><th>Price</th><th>Today</th><th>P/E</th><th>EPS</th><th>Market cap</th><th>52w range</th><th>Position in range</th></tr></thead><tbody>${
      rows.map(([s, x]) => { const pos = x.high52 && x.low52 && x.high52 > x.low52 ? (x.price - x.low52) / (x.high52 - x.low52) : null;
        return `<tr><td>${esc(s)}</td><td>${num(x.price, 2)} ${esc(x.currency || '')}</td><td class="${cls(x.chg_pct)}">${x.chg_pct == null ? '–' : (x.chg_pct > 0 ? '+' : '') + x.chg_pct.toFixed(2) + '%'}</td><td>${x.pe == null ? '–' : x.pe.toFixed(1) + 'x'}</td><td>${x.eps == null ? '–' : num(x.eps, 2)}</td><td>${big(x.mcap)}</td><td>${num(x.low52, 2)} – ${num(x.high52, 2)}</td><td>${pos == null ? '–' : Math.round(pos * 100) + '%'}</td></tr>`; }).join('')}</tbody></table></div>`;
    Object.entries(e).forEach(([s, x]) => { const f = x.fundamentals; if (!f) return;
      h += `<h4>Fundamentals ${by('rule')} <span class="muted small">EODHD · ${esc(s)}</span></h4><div class="grid g4">${kpi('Forward P/E', f.fwd_pe == null ? '–' : (+f.fwd_pe).toFixed(1) + 'x', 'trailing ' + (f.pe == null ? '–' : (+f.pe).toFixed(1) + 'x'))}${kpi('Revenue growth y/y', f.rev_growth_yoy == null ? '–' : pct(f.rev_growth_yoy), 'earnings ' + (f.earn_growth_yoy == null ? '–' : pct(f.earn_growth_yoy)), cls(f.rev_growth_yoy))}${kpi('Profit margin', f.profit_margin == null ? '–' : pct(f.profit_margin), 'ROE ' + (f.roe == null ? '–' : pct(f.roe)))}${kpi('Analyst target', f.target_price == null ? '–' : num(f.target_price, 2), 'rating ' + (f.analyst_rating == null ? '–' : (+f.analyst_rating).toFixed(1) + '/5'))}</div>`; });
    return h;
  }
  const s3 = d => `<div class="grid g2"><div><h4>Bottom-up ${by('agent')}</h4>${(d.bu || []).length ? `<table class="tbl"><thead><tr><th>Factor</th><th>Value</th><th>Score</th></tr></thead><tbody>${d.bu.map(b => `<tr><td>${esc(b.factor)}<div class="muted small">${link(b.source || '', b.url)}</div></td><td>${esc(b.value)}</td><td class="${cls(b.score)}"><b>${b.score > 0 ? '+' : ''}${b.score}</b></td></tr>`).join('')}</tbody></table>` : '<p class="hint">No bottom-up assessment this run.</p>'}</div>
      <div><h4>Top-down</h4><table class="tbl"><thead><tr><th>Factor</th><th>Score</th><th></th></tr></thead><tbody>${(d.topdown || []).map(t => `<tr><td>${esc(t.factor)}<div class="muted small">${esc(t.why || '')}${t.rule_score != null ? ` (rule said ${t.rule_score > 0 ? '+' : ''}${t.rule_score})` : ''}</div></td><td class="${cls(t.score)}"><b>${t.score > 0 ? '+' : ''}${t.score}</b></td><td>${by(t.by)}</td></tr>`).join('')}</tbody></table></div></div>
      ${valuationBox(d)}
      <div class="grid g3 mt">${kpi('Bottom-up avg', d.buAvg == null ? '–' : num(d.buAvg), '−2…+2', cls(d.buAvg))}${kpi('Top-down avg', d.tdAvg == null ? '–' : num(d.tdAvg), '−2…+2', cls(d.tdAvg))}${kpi('Cross-reference', esc(d.xref), '')}</div>`;
  const s4 = d => {
    const b = d.behavior; if (!b) return '<p class="hint">No price data.</p>';
    const row = (k, v, c = '') => `<div class="line"><span>${k}</span><b class="${c}">${v}</b></div>`;
    return `<div class="grid g-side"><div class="out">${row('Last (' + esc(b.asof) + ')', num(b.last, b.last > 1000 ? 0 : 4))}${row('Return 1m / 3m', `${pct(b.r1m)} / ${pct(b.r3m)}`, cls(b.r3m))}${row('Return 6m / 12m', `${pct(b.r6m)} / ${pct(b.r12m)}`, cls(b.r12m))}
      ${row('12-1 momentum', pct(b.mom12_1), cls(b.mom12_1))}${row('Above 50d / 200d avg', `${b.above50 == null ? '–' : b.above50 ? 'Yes' : 'No'} / ${b.above200 == null ? '–' : b.above200 ? 'Yes' : 'No'}`)}
      ${row('RSI(14)', num(b.rsi14, 0), b.rsi14 > 70 || b.rsi14 < 30 ? 'warnc' : '')}${row('Vol now vs 1y', `${pct(b.volNow, 0)} vs ${pct(b.volLong, 0)}`, b.volRegime > 1.3 ? 'neg' : '')}
      ${row('From 52w high', pct(b.fromHigh), cls(b.fromHigh))}${b.rs3m != null ? row('Rel. strength 3m / 12m vs ' + esc(d.spec.bench), `${pct(b.rs3m)} / ${pct(b.rs12m)}`, cls(b.rs12m)) : ''}${row('Trend score', `${b.trendScore > 0 ? '+' : ''}${b.trendScore} / 3`, cls(b.trendScore))}</div>
      <div><div class="chartbox"><canvas id="chBh"></canvas></div></div></div>
      ${d.confirm ? `<div class="alert ${d.confirm === 'confirms' ? 'good' : d.confirm === 'diverges' ? 'bad' : ''}">Price behaviour <b>${d.confirm}</b> the weight of evidence.</div>` : ''}
      ${d.behavior_read ? `<p>${by('agent')} ${esc(d.behavior_read)}</p>` : ''}`;
  };
  const s5 = d => {
    const c = d.cot;
    return `${c ? `<div class="grid g4">${kpi('Asset managers net', c.am_net_pct + '% OI', `4wk ${c.am_chg4_pp > 0 ? '+' : ''}${c.am_chg4_pp}pp · z ${c.am_z}`, cls(c.am_chg4_pp))}${kpi('Leveraged funds net', c.lev_net_pct + '% OI', `z ${c.lev_z} · 1wk ${c.lev_chg1_pp > 0 ? '+' : ''}${c.lev_chg1_pp}pp`, Math.abs(c.lev_z) > 2 ? 'warnc' : '')}${kpi('Flow signal', (c.signal > 0 ? '+' : '') + c.signal.toFixed(2), 'rule-based', cls(c.signal))}${kpi('Report', esc(c.asof), esc(c.market))}</div>
      <div class="chartbox"><canvas id="chCot"></canvas></div><p class="hint">${by('rule')} CFTC Traders in Financial Futures. ${esc(c.rule)}.</p>` : '<p class="hint">No futures-positioning data for this subject.</p>'}
      ${d.onchain ? `<h4>Market data ${by('rule')}</h4><div class="grid g4">${kpi('Market cap', money(d.onchain.market_cap), '#' + (d.onchain.rank || '–'))}${kpi('24h volume', money(d.onchain.volume_24h), '')}${kpi('From ATH', d.onchain.ath_change_pct == null ? '–' : d.onchain.ath_change_pct.toFixed(1) + '%', '', 'neg')}${kpi('Supply', num(d.onchain.circulating, 0), d.onchain.max_supply ? 'max ' + num(d.onchain.max_supply, 0) : 'no max')}</div>` : ''}
      <h4>Notable actors ${by('agent')}</h4>${(d.flows_extra || []).length ? `<table class="tbl"><thead><tr><th>Date</th><th>Actor</th><th>Side</th><th>Size</th><th>Note</th></tr></thead><tbody>${d.flows_extra.map(f => `<tr><td>${esc(f.date || '')}</td><td>${link(f.actor, f.url)}<div class="muted small">${esc(f.type || '')}${f.informed ? ' · informed' : ''}</div></td><td class="${String(f.side).startsWith('Buy') ? 'pos' : String(f.side).startsWith('Sell') ? 'neg' : ''}">${esc(f.side)}</td><td>${f.size ? money(f.size) : '–'}</td><td>${esc(f.note || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No notable large-actor flows found this run.</p>'}`;
  };
  const s6 = d => {
    const st = d.scenarioStats; if (!st) return '<p class="hint">No scenarios.</p>';
    const base = Object.fromEntries((d.scenarioBaseline || []).map(x => [x.name, x]));
    return `<div class="scrollx"><table class="tbl"><thead><tr><th>Scenario</th><th>Prob.</th><th>Return</th><th>Baseline</th><th>Mechanism</th><th>Trigger</th></tr></thead><tbody>${d.scenarios.map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${s.p}%</td><td class="${cls(s.r)}">${s.r > 0 ? '+' : ''}${s.r}%</td><td class="muted">${base[s.name] ? `${base[s.name].p}% / ${base[s.name].r > 0 ? '+' : ''}${base[s.name].r}%` : '–'}</td><td>${esc(s.why)}</td><td>${esc(s.trigger)}</td></tr>`).join('')}</tbody></table></div>
      <div class="grid g4 mt">${kpi('Expected return', (st.ev > 0 ? '+' : '') + st.ev.toFixed(1) + '%', `over ${d.spec.horizon_m || 6} months`, cls(st.ev))}${kpi('Dispersion σ', st.sd.toFixed(1) + '%', '')}${kpi('P(loss)', pct(st.pLoss, 0), '', st.pLoss > 0.4 ? 'neg' : '')}${kpi('Half-Kelly', pct(st.kelly / 2, 0), `full ${pct(st.kelly, 0)}`)}</div>
      <p class="hint">Baseline = vol-based lognormal buckets (bottom 25 / middle 50 / top 25%) with a neutral drift prior of ${pct(d.driftPrior || 0, 0)}/yr. The agent tilts probabilities and returns only with a mechanism and an observable trigger. Kelly assumes the probabilities are right, so size well below it.</p>
      <button id="evToMc" class="small">Use EV as drift in Forecast →</button>`;
  };
  const s7 = d => `<ul class="points">${(d.summary || []).map(p => `<li>${esc(p)}</li>`).join('') || '<li class="muted">No agent summary this run.</li>'}</ul>
      <div class="grid g2"><div><h4>Invalidation</h4><p>${esc(d.invalidation || '–')}</p></div><div><h4>Next actions</h4><p>${esc(d.actions || '–')}</p></div></div>
      ${(d.alerts || []).length ? `<h4>Alerts</h4>${d.alerts.map(a => `<div class="alert ${a.level === 'high' ? 'bad' : ''}">${esc(a.text)}</div>`).join('')}` : ''}
      ${(d.gaps || []).length ? `<p class="hint warnc">Data gaps: ${esc(d.gaps.join('; '))}</p>` : ''}
      <button id="copyBrief" class="small mt">Copy brief (Markdown)</button>`;
  function brief(d) {
    const st = d.scenarioStats || {}, b = d.behavior || {};
    return [`# ${d.spec.name}: ${d.conviction.label} (${fmtScore(d.conviction.score)})`, `Run ${d.runId} · ${d.at}`, '', `**Question:** ${d.spec.question}`, '',
      '## Summary', ...(d.summary || []).map(x => `- ${x}`), '', '## Key evidence', ...(d.evidence || []).filter(e => e.rel === 'Core').map(e => `- ${+e.dir > 0 ? '▲' : +e.dir < 0 ? '▼' : '•'} ${e.claim} [${e.kind}; ${e.source}${e.url ? ' ' + e.url : ''}]`),
      '', `## Bottom-up ${d.buAvg == null ? '–' : d.buAvg.toFixed(2)} × Top-down ${d.tdAvg == null ? '–' : d.tdAvg.toFixed(2)} → ${d.xref}`, '',
      `## Behaviour: 1m ${pct(b.r1m)}, 12m ${pct(b.r12m)}, trend ${b.trendScore}/3, ${d.confirm || ''} evidence`, d.behavior_read || '', '',
      '## Scenarios', ...(d.scenarios || []).map(s => `- ${s.name} ${s.p}% → ${s.r}%: ${s.why}${s.trigger ? ' (trigger: ' + s.trigger + ')' : ''}`), `EV ${st.ev}% · P(loss) ${pct(st.pLoss, 0)} · half-Kelly ${pct((st.kelly || 0) / 2, 0)}`, '',
      `**Invalidation:** ${d.invalidation || '–'}`, `**Next:** ${d.actions || '–'}`, '', '_Market Desk automated research. Not investment advice._'].join('\n');
  }
  function drawResearchCharts(d) {
    const col = palette();
    if (d.chart && document.getElementById('chBh')) {
      const c = d.chart.close, n = c.length;
      const ma = k => c.map((_, i) => (i + 1 < k ? null : c.slice(i + 1 - k, i + 1).reduce((a, b) => a + b, 0) / k));
      chart('chBh', { type: 'line', data: { labels: d.chart.dates, datasets: [line(d.spec.name, c, col[0]), line('~50d', ma(25), col[2], { borderWidth: 1 }), line('~200d', ma(100), col[3], { borderWidth: 1 })] } });
      void n;
    }
    if (d.cot && document.getElementById('chCot')) {
      const h = d.cot.hist;
      chart('chCot', { type: 'line', data: { labels: h.map(x => x.d), datasets: [line('Asset managers net % OI', h.map(x => x.am), col[0]), line('Leveraged funds net % OI', h.map(x => x.lev), col[2])] } });
    }
  }

  // ---------- macro ----------
  function renderMacro() {
    const r = S.run; if (!r) return;
    $('#regimeTbl').innerHTML = `<table class="tbl"><thead><tr><th>Factor</th><th>Signal</th><th>Input</th><th>Value</th><th>Input signal</th><th>As of</th></tr></thead><tbody>${
      Object.values(r.regime).map(f => f.inputs.map((p, i) => `<tr>${i === 0 ? `<td rowspan="${f.inputs.length}"><b>${esc(f.label)}</b><div class="muted small">${esc(f.rule)}</div></td><td rowspan="${f.inputs.length}" class="${cls(f.signal)}"><b>${f.signal == null ? 'n/a' : (f.signal > 0 ? '+' : '') + f.signal.toFixed(2)}</b></td>` : ''}<td>${esc(p.name)}${p.detail ? `<div class="muted small">${esc(p.detail)}</div>` : ''}</td><td>${num(p.value, 2)}</td><td class="${cls(p.s)}">${p.s > 0 ? '+' : ''}${p.s.toFixed(2)}</td><td class="muted">${esc(p.asof)}</td></tr>`).join('')).join('')}</tbody></table>`;
    const P = r.panel || {}, col = palette(), R = P.rates || {};
    const ser = k => (R[k] ? R[k].hist : []);
    if (R.DGS10) chart('chRates', { type: 'line', data: { labels: ser('DGS10').map(x => x[0]), datasets: [['DGS2', '2y'], ['DGS10', '10y'], ['DFII10', '10y real'], ['DFF', 'Fed funds']].filter(([k]) => R[k]).map(([k, l], i) => line(l, ser(k).map(x => x[1]), col[i])) } });
    if (R.BAMLH0A0HYM2) chart('chRisk', { type: 'line', data: { labels: ser('BAMLH0A0HYM2').map(x => x[0]), datasets: [line('HY spread %', ser('BAMLH0A0HYM2').map(x => x[1]), col[4], { yAxisID: 'y' }), line('VIX', (R.VIXCLS ? R.VIXCLS.hist : []).map(x => x[1]), col[6], { yAxisID: 'y1' })] },
      options: { scales: { y1: { position: 'right', grid: { display: false }, ticks: { color: css('--muted') } } } } });
    const wb = (obj, id) => { if (!obj) return; const ctry = Object.keys(obj); const years = [...new Set(ctry.flatMap(c => Object.keys(obj[c])))].sort();
      chart(id, { type: 'line', data: { labels: years, datasets: ctry.map((c, i) => line(c, years.map(y => obj[c][y] ?? null), col[i % col.length], { pointRadius: 2, spanGaps: true })) } }); };
    wb(P.gdp_growth, 'chGdp'); wb(P.cpi_inflation, 'chCpi');
    if (P.treasury_debt) chart('chDebt', { type: 'line', data: { labels: P.treasury_debt.map(x => x.date), datasets: [line('Debt $T', P.treasury_debt.map(x => x.debt / 1e12), col[3])] }, options: { plugins: { legend: { display: false } } } });
    const fx = P.fx, cg = P.crypto_global;
    $('#fxTbl').innerHTML = `${fx ? `<table class="tbl num"><thead><tr><th>Per USD (${esc(fx.date)})</th><th>Rate</th></tr></thead><tbody>${['EUR', 'JPY', 'GBP', 'CNY', 'CHF', 'IDR', 'INR', 'SGD'].filter(k => fx.rates[k]).map(k => `<tr><td>${k}</td><td>${num(fx.rates[k], fx.rates[k] > 100 ? 0 : 4)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${cg ? `<div class="grid g2 mt">${kpi('Crypto market cap', '$' + num(cg.total_mcap / 1e12, 2) + 'T', `24h ${num(cg.mcap_chg_24h_pct, 1)}%`, cls(cg.mcap_chg_24h_pct))}${kpi('BTC dominance', num(cg.btc_dominance, 1) + '%', 'ETH ' + num(cg.eth_dominance, 1) + '%')}</div>` : ''}`;
  }

  // ---------- desk chat (sample + page tools) ----------
  let sample = null, turns = [], ctl = null;
  const chips = ['What is the WallStreetBets crowd betting on, and is it a contrarian signal?', 'Where do evidence and price behaviour disagree most?', 'Which subject has the best risk/reward right now, and why?', 'Summarize the macro regime in 4 bullets for a PM.', 'How should I hedge my portfolio given the current regime?', 'Play devil\'s advocate on the highest-conviction view.'];
  $('#chatChips').innerHTML = chips.map(c => `<button class="ghost small chip">${esc(c)}</button>`).join('');
  $('#chatChips').onclick = e => { const b = e.target.closest('.chip'); if (b) { $('#chatInput').value = b.textContent; $('#chatForm').requestSubmit(); } };
  const cut = (o, n = 24000) => { const s = JSON.stringify(o); return s.length > n ? s.slice(0, n) + '…(truncated)' : s; };
  const TOOLS = [
    { name: 'list_subjects', description: 'Watchlist summary from the latest run: id, name, conviction (-100..100), label, price, 1m and 12m return, trend score, scenario EV %, P(loss), cross-reference verdict, alert count.',
      execute: () => S.run.summary },
    { name: 'get_subject', description: 'Full pipeline output for one subject id: section is one of spec, evidence, bottomup_topdown, behavior, flows, scenarios, summary, or all.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, section: { type: 'string' } }, required: ['id'] },
      execute: ({ id, section }) => { const d = S.subj[String(id)]; if (!d) throw new Error('unknown subject id; call list_subjects'); const m = {
        spec: { spec: d.spec }, evidence: { evidence: d.evidence, stats: d.evidenceStats, narratives: d.narratives, bias_checks: d.bias_checks, crowd: d.crowd && { ...d.crowd, threads: undefined, subreddits: undefined }, crowd_read: d.crowd_read },
        bottomup_topdown: { bu: d.bu, buAvg: d.buAvg, topdown: d.topdown, tdAvg: d.tdAvg, xref: d.xref }, behavior: { behavior: d.behavior, read: d.behavior_read, confirm: d.confirm },
        flows: { cot: d.cot && { ...d.cot, hist: undefined }, onchain: d.onchain, flows_extra: d.flows_extra }, scenarios: { scenarios: d.scenarios, baseline: d.scenarioBaseline, stats: d.scenarioStats },
        summary: { conviction: d.conviction, summary: d.summary, invalidation: d.invalidation, actions: d.actions, alerts: d.alerts } };
        const sec = String(section || 'all'); return cut(sec === 'all' ? { ...m.spec, ...m.summary, behavior: m.behavior, scenarios: m.scenarios, xref: d.xref, evidence: (d.evidence || []).slice(0, 8) } : (m[sec] || m.summary)); } },
    { name: 'get_regime', description: 'Top-down macro regime: factor signals (-1..+1, + supportive of risk assets) with their underlying data inputs and dates, plus the agent macro note.',
      execute: () => cut({ regime: S.run.regime, note: S.run.macro_note }) },
    { name: 'get_crowd', description: 'Retail crowd sentiment from the latest run: r/wallstreetbets and r/stocks daily-thread bullish share, most-mentioned tickers and frequent words, ApeWisdom mention ranks, Tradestie sentiment, the agent crowd note, and per-subject crowd lean (-1..+1).',
      execute: () => cut({ overview: S.run.crowd, note: S.run.crowd_note, perSubject: Object.fromEntries(Object.entries(S.subj).map(([k, d]) => [k, d.crowd ? { lean: d.crowd.lean, volume: d.crowd.volume, extreme: d.crowd.extreme, read: d.crowd_read } : null])) }) },
    { name: 'get_alerts', description: 'Alerts raised in the latest run (conviction changes, trend flips, volatility, positioning extremes, agent-flagged material events).', execute: () => S.run.alerts },
    { name: 'get_portfolio', description: 'The user\'s holdings and, if they have analysed it on the Builder tab, its risk metrics (CAGR, vol, Sharpe, max drawdown, VaR, beta) and per-asset risk contributions.',
      execute: () => { const p = App.pf; return cut({ holdings: App.holdings(), metrics: p ? p.m : 'not analysed yet in this view', riskContrib: p ? p.syms.map((s, i) => [s, +(Q.riskContributions(p.w, p.C)[i]).toFixed(3)]) : null }); } },
  ];
  function rules() {
    return `You are the analyst on Market Desk, a research dashboard for a portfolio manager and hedger. Answer from the data the page tools return. They come from the latest automated run (${S.run ? S.run.runId + ', ' + S.run.at : 'none'}), so cite the run date when it matters. Reason like a careful PM: separate facts from interpretation, weigh both sides, quantify, and name what would change the view. Never invent prices, figures or sources. If the tools lack something, say so. Be concise: short paragraphs or tight bullets, under 250 words unless asked for more. This is analysis, not personal investment advice.`;
  }
  function addMsg(role, text) {
    const el = document.createElement('div'); el.className = 'msg-' + role; el.textContent = text; $('#chatLog').append(el); $('#chatLog').scrollTop = 1e9; return el;
  }
  $('#chatForm').onsubmit = async e => {
    e.preventDefault();
    const q = $('#chatInput').value.trim(); if (!q || ctl) return;
    if (!sample) { addMsg('sys', 'Asking Claude is not available in this view. Open the dashboard on claude.ai.'); return; }
    if (!S.run) { addMsg('sys', 'No run data loaded yet.'); return; }
    $('#chatInput').value = ''; addMsg('user', q);
    turns.push({ role: 'user', content: q });
    const out = addMsg('assistant', 'Thinking…');
    ctl = new AbortController(); $('#chatStop').hidden = false; $('#chatSend').disabled = true;
    const limits = await sample.limits().catch(() => null);
    try {
      const { text } = await sample([{ role: 'user', content: rules() }, ...turns.slice(-10)], { cache: false, signal: ctl.signal, tools: limits && limits.tools ? TOOLS : undefined,
        onText: ({ text }) => { out.textContent = text; $('#chatLog').scrollTop = 1e9; } });
      turns.push({ role: 'assistant', content: text });
    } catch (err) {
      out.textContent = err.text || '';
      const m = { not_granted: 'Permission to use Claude was declined for this page.', rate_limited: 'Rate limited. Try again in a bit.', cancelled: '' }[err.code];
      if (m !== '') addMsg('sys', m || `Could not answer (${err.code}).`);
      turns.pop();
    } finally { ctl = null; $('#chatStop').hidden = true; $('#chatSend').disabled = false; }
  };
  $('#chatStop').onclick = () => ctl && ctl.abort();
  $('#deskClear').onclick = () => { turns = []; $('#chatLog').innerHTML = ''; };

  // ---------- automation ----------
  const FLOW = [
    ['Due diligence & specification', 'Watchlist subjects with a falsifiable question, scope (micro/macro), horizon, instruments and macro profile.', 'Config', 'You (Automation tab)'],
    ['Information process', 'Crowd sentiment from the r/wallstreetbets and r/stocks daily threads and company subreddits (upvote-weighted bull/bear lexicon, ticker mentions, recurring words), plus ApeWisdom and Tradestie. Claude summarizes the majority view and its patterns, and treats extremes as contrarian warnings. Headlines collected and tagged by source tier and rumor/hedge/opinion flags. Claude filters noise, classifies Fact / Estimate / Opinion / Rumor, corroborates in a second source, names narratives and who benefits, and runs bias checks.', 'Rules + Claude', 'Google News RSS, WebSearch'],
    ['Bottom-up × top-down', 'Top-down: 7 regime factors from FRED data mapped through each subject\'s sensitivity profile. Bottom-up: Claude fills sourced fundamentals. The two are cross-referenced into a verdict.', 'Rules + Claude', 'FRED, WebSearch'],
    ['Market behaviour', 'Trend, momentum, RSI, volatility regime and relative strength. Checks whether price confirms or diverges from the evidence.', 'Rules', 'Yahoo Finance'],
    ['Flows', 'CFTC positioning (asset managers vs leveraged funds, z-scores, crowding), plus notable actors Claude finds: ETF flows, foreign flows, insiders, politicians.', 'Rules + Claude', 'CFTC, CoinGecko, WebSearch'],
    ['Plausibility & forecast', 'Vol-based baseline scenarios. Claude tilts probabilities only with a mechanism and an observable trigger. Outputs EV, dispersion, P(loss) and Kelly sizing.', 'Rules + Claude', 'Engine'],
    ['Summary & alerts', 'Composite conviction, change alerts against the previous run, and a compact brief per subject.', 'Rules + Claude', 'Dashboard'],
  ];
  $('#flow').innerHTML = FLOW.map((f, i) => `<div class="fstep"><div class="fn">${i + 1}</div><div><b>${f[0]}</b> <span class="pill">${f[2]}</span><p>${f[1]}</p><div class="muted small">${f[3]}</div></div></div>`).join('<div class="farrow">↓</div>');
  const PROFILES = ['us_equity', 'us_equity_growth', 'duration', 'usd', 'crypto', 'em_equity', 'em_fx_usdquote'];
  let wl = null, wlDirty = false;
  function renderAutomation() {
    const a = S.config.automation;
    $('#schedBox').innerHTML = `<div class="out">
      <div class="line"><span>Schedule</span><b>${esc(a && a.schedule || 'Not configured')}</b></div>
      <div class="line"><span>Engine repository</span><b>${a && a.repo ? link(a.repo, 'https://github.com/' + a.repo) : '–'}</b></div>
      <div class="line"><span>Last run</span><b>${S.run ? local(S.run.at) : '–'}</b></div>
      <div class="line"><span>Data mode</span><b>${esc(S.mode)}</b></div></div>
      ${S.run && (S.run.problems || []).length ? `<p class="hint warnc">Last run warnings: ${esc(S.run.problems.join('; '))}</p>` : ''}
      ${S.run && (S.run.gaps || []).length ? `<p class="hint warnc">Data gaps: ${esc(S.run.gaps.join('; '))}</p>` : ''}
      <p class="hint">Each run: a fresh Claude session clones the engine, collects data, does the judgment steps with web search, scores everything, and writes the results here.</p>`;
    const H = (S.hist || []).slice().reverse();
    $('#runHist').innerHTML = H.length ? `<table class="tbl"><thead><tr><th>Run</th><th>When</th><th>Alerts</th></tr></thead><tbody>${H.slice(0, 30).map(h => `<tr><td>${esc(h.runId)}</td><td>${local(h.at)}</td><td>${h.alerts}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No runs yet.</p>';
    if (!wlDirty) wl = JSON.parse(JSON.stringify(S.watchlist()));
    renderWl();
  }
  function renderWl() {
    const F = ['id', 'name', 'scope', 'type', 'symbols', 'bench', 'profile', 'horizon_m', 'cot', 'news', 'question'];
    $('#wlEditor').innerHTML = `<table class="tbl wl"><thead><tr>${F.map(f => `<th>${f}</th>`).join('')}<th></th></tr></thead><tbody>${(wl || []).map((s, i) => `<tr>${F.map(f => {
      const v = f === 'symbols' ? (s.symbols || []).join(', ') : s[f] ?? '';
      if (f === 'scope') return `<td><select data-i="${i}" data-f="${f}"><option ${v === 'micro' ? 'selected' : ''}>micro</option><option ${v === 'macro' ? 'selected' : ''}>macro</option></select></td>`;
      if (f === 'profile') return `<td><select data-i="${i}" data-f="${f}">${PROFILES.map(p => `<option ${p === v ? 'selected' : ''}>${p}</option>`).join('')}</select></td>`;
      return `<td><input data-i="${i}" data-f="${f}" value="${esc(v)}" ${f === 'horizon_m' ? 'type="number"' : ''}></td>`; }).join('')}<td><button class="ghost small" data-del="${i}" aria-label="Remove">✕</button></td></tr>`).join('')}</tbody></table>`;
    $('#wlEditor').querySelectorAll('[data-f]').forEach(el => el.onchange = () => {
      const s = wl[+el.dataset.i], f = el.dataset.f; wlDirty = true;
      s[f] = f === 'symbols' ? el.value.split(',').map(x => x.trim()).filter(Boolean) : f === 'horizon_m' ? +el.value : f === 'bench' || f === 'cot' ? (el.value.trim() || null) : el.value;
    });
    $('#wlEditor').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { wl.splice(+b.dataset.del, 1); wlDirty = true; renderWl(); });
  }
  $('#wlAdd').onclick = () => { wl.push({ id: 'new' + (wl.length + 1), name: '', scope: 'micro', type: 'Stock', symbols: [], bench: 'SPY', profile: 'us_equity', horizon_m: 6, cot: null, news: '', question: '' }); wlDirty = true; renderWl(); };
  $('#wlSave').onclick = async () => {
    const m = $('#wlMsg');
    const bad = wl.find(s => !/^[a-z0-9_-]{1,24}$/.test(s.id) || !s.name || !(s.symbols || []).length || !s.question);
    if (bad) { m.className = 'msg err'; m.textContent = `Subject "${bad.id || '?'}" needs: id (a-z, 0-9, -, _), name, symbols and question.`; return; }
    try { await S.saveConfig('watchlist', { items: wl, savedAt: new Date().toISOString() }); wlDirty = false; m.className = 'msg ok'; m.textContent = 'Saved. The next run will use it.'; }
    catch (e) { m.className = 'msg err'; m.textContent = e.message || String(e.code); }
  };

  // ---------- run now + schedule editor (through the Claude Code Remote connector) ----------
  let mcp = null, trig = null;
  const SRV = 'Claude Code Remote';
  const tz0 = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return 'UTC'; } })();
  try { $('#tzList').innerHTML = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC', 'Asia/Jakarta', 'America/New_York', 'Europe/London']).map(z => `<option value="${z}">`).join(''); } catch (e) { /* older browser */ }
  const mcpErr = e => ({ server_not_connected: 'Connect "Claude Code Remote" in claude.ai Settings → Connectors.', not_in_manifest: 'Permission for the Claude Code Remote connector was declined for this page.',
    blocked_by_policy: 'Your organization blocks this action.', approval_required: 'This action needs your approval. Click again and allow it.', tool_error: 'The scheduler refused: ' + (e.message || '') }[e.code] || `Failed (${e.code}).`);
  async function setupRunNow() {
    try { mcp = await claude.use('mcp'); } catch (e) { mcp = null; }
    const a = S.config.automation, ok = !!(mcp && a && a.triggerId);
    $('#runNow').hidden = !ok; $('#runNow2').disabled = !ok; $('#schSave').disabled = !ok;
    if (!mcp) $('#schedMsg').textContent = 'Run and schedule controls work when this page is opened on claude.ai.';
    else if (!(a && a.triggerId)) $('#schedMsg').textContent = 'Automation is not set up yet.';
  }
  async function fireNow(msgEl, btn) {
    const a = S.config.automation;
    btn.disabled = true; msgEl.className = 'msg'; msgEl.textContent = 'Starting…';
    try {
      await mcp.callTool(SRV, 'fire_trigger', { trigger_id: a.triggerId }); // no extra text: it arrives as a second turn and repeats the run
      msgEl.className = 'msg ok'; msgEl.textContent = 'Run started. Results appear here automatically in about 10–20 minutes.';
    } catch (e) { msgEl.className = 'msg err'; msgEl.textContent = mcpErr(e); } finally { btn.disabled = false; }
  }
  $('#runNow').onclick = () => fireNow($('#runNowMsg'), $('#runNow'));
  $('#runNow2').onclick = () => fireNow($('#schedMsg'), $('#runNow2'));

  // cron <-> form
  function buildCron() {
    const f = $('#schFreq').value, [hh, mm] = ($('#schTime').value || '05:13').split(':').map(Number), tz = $('#schTz').value.trim() || 'UTC';
    let c;
    if (f === 'hours') c = `0 */${$('#schHours').value} * * *`;
    else if (f === 'daily') c = `${mm} ${hh} * * *`;
    else if (f === 'weekdays') c = `${mm} ${hh} * * 1-5`;
    else if (f === 'weekly') c = `${mm} ${hh} * * ${$('#schDay').value}`;
    else c = $('#schCron').value.trim();
    return f === 'hours' ? c : `CRON_TZ=${tz} ${c}`;
  }
  function describe(cron) {
    if (!cron) return 'No schedule';
    let tz = 'UTC', c = cron;
    const m = cron.match(/^CRON_TZ=(\S+)\s+(.*)$/); if (m) { tz = m[1]; c = m[2]; }
    const [mi, h, dom, mon, dow] = c.split(/\s+/);
    const t = /^\d+$/.test(h) && /^\d+$/.test(mi) ? `${h.padStart(2, '0')}:${mi.padStart(2, '0')} ${tz}` : '';
    if (/^\*\/\d+$/.test(h)) return `Every ${h.slice(2)} hour(s)`;
    if (h === '*') return 'Every hour';
    if (dom === '*' && mon === '*' && dow === '*') return `Every day at ${t}`;
    if (dow === '1-5') return `Weekdays at ${t}`;
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (/^\d$/.test(dow)) return `Every ${days[+dow]} at ${t}`;
    return `Custom: ${cron}`;
  }
  function fillForm(cron, enabled) {
    $('#schEnabled').checked = enabled !== false;
    let tz = tz0, c = cron || '13 5 * * 1-5';
    const m = (cron || '').match(/^CRON_TZ=(\S+)\s+(.*)$/); if (m) { tz = m[1]; c = m[2]; }
    $('#schTz').value = tz; $('#schCron').value = c;
    const [mi, h, dom, mon, dow] = c.split(/\s+/);
    if (/^\*\/\d+$/.test(h || '')) { $('#schFreq').value = 'hours'; $('#schHours').value = h.slice(2); }
    else if (h === '*') { $('#schFreq').value = 'hours'; $('#schHours').value = '1'; }
    else if (/^\d+$/.test(h) && /^\d+$/.test(mi)) {
      $('#schTime').value = `${h.padStart(2, '0')}:${mi.padStart(2, '0')}`;
      if (dom === '*' && mon === '*' && dow === '*') $('#schFreq').value = 'daily';
      else if (dow === '1-5') $('#schFreq').value = 'weekdays';
      else if (/^\d$/.test(dow)) { $('#schFreq').value = 'weekly'; $('#schDay').value = dow; }
      else $('#schFreq').value = 'custom';
    } else $('#schFreq').value = 'custom';
    syncForm();
  }
  function syncForm() {
    const f = $('#schFreq').value;
    $('#schHoursL').hidden = f !== 'hours'; $('#schDayL').hidden = f !== 'weekly'; $('#schTimeL').hidden = f === 'hours' || f === 'custom';
    $('#schCronL').hidden = f !== 'custom';
    $('#schPreview').textContent = ($('#schEnabled').checked ? 'Will run: ' : 'Paused. When enabled it would run: ') + describe(buildCron()) + (f === 'hours' ? ' (counted from the moment you save)' : '');
  }
  ['schFreq', 'schHours', 'schDay', 'schTime', 'schCron', 'schTz', 'schEnabled'].forEach(id => { $('#' + id).addEventListener('input', syncForm); $('#' + id).addEventListener('change', syncForm); });
  async function loadTrigger() {
    const a = S.config.automation; if (!mcp || !a || !a.triggerId) return;
    const m = $('#schedMsg'); m.className = 'msg'; m.textContent = 'Reading schedule…';
    try {
      const r = await mcp.callTool(SRV, 'get_trigger', { trigger_id: a.triggerId }, { cache: false });
      trig = r.payload && (r.payload.trigger || r.payload);
      fillForm(trig.cron_expression, trig.enabled);
      const lr = trig.last_run;
      m.className = 'msg ok';
      m.textContent = `${trig.enabled ? 'Active' : 'Paused'} · ${describe(trig.cron_expression)}` + (trig.next_run_at ? ` · next ${local(trig.next_run_at)}` : '') + (lr ? ` · last fired ${local(lr.fired_at)} (${String(lr.status).toLowerCase()})` : '');
    } catch (e) { m.className = 'msg err'; m.textContent = mcpErr(e); }
  }
  $('#schedLoad').onclick = loadTrigger;
  $('#schSave').onclick = async () => {
    const a = S.config.automation, m = $('#schedMsg'), cron = buildCron(), enabled = $('#schEnabled').checked;
    if (!/^(CRON_TZ=\S+\s+)?\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(cron)) { m.className = 'msg err'; m.textContent = 'The cron expression needs 5 fields: minute hour day-of-month month day-of-week.'; return; }
    $('#schSave').disabled = true; m.className = 'msg'; m.textContent = 'Saving…';
    try {
      await mcp.callTool(SRV, 'update_trigger', { trigger_id: a.triggerId, cron_expression: cron, enabled });
      try { await S.saveConfig('automation', { ...a, cron, enabled, schedule: enabled ? describe(cron) : 'Paused', savedAt: new Date().toISOString() }); } catch (e) { /* display copy only */ }
      await loadTrigger();
    } catch (e) { m.className = 'msg err'; m.textContent = mcpErr(e); } finally { $('#schSave').disabled = false; }
  };
  let formFilled = false;
  function prefill() { const a = S.config.automation; if (!formFilled && a && a.cron) { fillForm(a.cron, a.enabled); formFilled = true; } else if (!formFilled) { fillForm(null, true); } }

  // ---------- wiring ----------
  function renderAll() {
    renderChrome();
    if (!S.run) return;
    renderOverview(); renderMacro(); renderAutomation();
    const h = location.hash.slice(1).split('/');
    if (h[0] === 'research') renderResearch();
    setupRunNow(); prefill();
  }
  S.on(renderAll);
  window.addEventListener('tabshown', ev => {
    if (ev.detail === 'research') { const id = location.hash.split('/')[1]; if (id) current = id; renderResearch(); }
    if (ev.detail === 'overview' && S.run) renderOverview();
    if (ev.detail === 'macro' && S.run) renderMacro();
    if (ev.detail === 'automation' && mcp && !trig) loadTrigger();
  });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1).split('/'); if (h[0] === 'research' && h[1] && h[1] !== current) { current = h[1]; renderResearch(); } });
  window.addEventListener('themechange', renderAll);
  (async () => { try { sample = await claude.use('sample'); } catch (e) { sample = null; } if (!sample) $('#chatHint').textContent = 'Asking Claude is available when this page is opened on claude.ai.'; })();
  renderAll();
})();
