/* Store: reads automated runs from the artifact database (live), falling back to the bundled snapshot. */
(function (g) {
  'use strict';
  const S = { mode: 'loading', note: '', state: null, run: null, subj: {}, series: {}, hist: [], config: { watchlist: null, portfolio: null, automation: null },
    db: null, user: null, canWrite: false, versions: {} };
  const subs = [];
  S.on = f => subs.push(f);
  const emit = () => subs.forEach(f => { try { f(); } catch (e) { console.error(e); } });

  function expand(c) {
    const d0 = Date.parse(c.d0 + 'T00:00:00Z');
    return { dates: c.o.map(o => new Date(d0 + o * 864e5).toISOString().slice(0, 10)), close: c.c };
  }
  function setPrices(priceDocs) {
    S.series = {};
    priceDocs.forEach(p => Object.entries(p.symbols || {}).forEach(([sym, c]) => {
      S.series[sym] = Object.assign(expand(c), { symbol: sym, source: 'Yahoo Finance via engine', name: (p.meta && p.meta[sym] && p.meta[sym].name) || sym });
    }));
  }
  S.getSeries = async sym => {
    const s = S.series[sym] || S.series[String(sym).toUpperCase()];
    if (!s) throw new Error(`${sym}: not collected yet. Add it to your holdings and the next automated run will fetch it.`);
    return s;
  };
  S.portfolio = () => S.config.portfolio || (S.run && S.run.portfolio) || { bench: 'SPY', rf: 4, holdings: [] };
  S.watchlist = () => (S.config.watchlist && S.config.watchlist.items) || (S.run && S.run.subjects && S.run.subjects.map(id => S.subj[id] && S.subj[id].spec).filter(Boolean)) || [];

  function useSnapshot(note) {
    const snap = g.MD_SNAPSHOT;
    if (!snap) { S.mode = 'empty'; S.note = note || 'No data yet.'; emit(); return; }
    S.mode = 'snapshot'; S.note = note;
    S.state = snap.state; S.run = snap.run; S.subj = snap.subj; S.hist = snap.hist || [];
    setPrices(Object.values(snap.prices));
    emit();
  }

  async function loadRun(runId) {
    const db = S.db;
    const runSnap = await db.doc('runs/' + runId).get();
    if (!runSnap.exists) throw new Error('run document missing');
    const run = runSnap.data();
    const subjSnaps = await Promise.all((run.subjects || []).map(id => db.doc(`subj/${runId}--${id}`).get()));
    const priceSnaps = await Promise.all((run.priceDocs || []).map(id => db.doc('prices/' + id).get()));
    const subj = {};
    subjSnaps.forEach(s => { if (s.exists) { const d = s.data(); subj[d.subjectId] = d; } });
    S.run = run; S.subj = subj;
    setPrices(priceSnaps.filter(s => s.exists).map(s => s.data()));
    try {
      const h = await db.collection('hist').orderBy('at', 'desc').limit(250).get();
      S.hist = h.docs.map(d => d.data()).reverse();
    } catch (e) { S.hist = []; }
    S.mode = 'live'; S.note = '';
    emit();
  }

  S.saveConfig = async (name, body) => {
    if (!S.db) throw new Error('Database unavailable in this view; changes cannot be saved.');
    await S.db.doc('config/' + name).set(body);
  };

  async function init() {
    let timer = setTimeout(() => { if (S.mode === 'loading') useSnapshot('Live database not reachable yet: showing the bundled snapshot.'); }, 10000);
    let db = null;
    try { db = await (g.claude && g.claude.use ? g.claude.use('db') : null); } catch (e) { db = null; }
    if (!db) { clearTimeout(timer); useSnapshot('Open this page on claude.ai for live runs. Showing the bundled snapshot.'); return; }
    S.db = db;
    try {
      const user = await g.claude.use('user');
      S.user = user;
      const cw = user ? await user.can('data.write') : null;
      S.canWrite = cw !== false;
    } catch (e) { S.canWrite = true; }
    ['watchlist', 'portfolio', 'automation'].forEach(name => db.doc('config/' + name).onSnapshot(s => {
      S.config[name] = s.exists ? s.data() : null; emit();
    }, () => {}));
    let current = null;
    db.doc('state/latest').onSnapshot(async s => {
      clearTimeout(timer);
      if (!s.exists) { if (!s.metadata.fromCache) useSnapshot('No automated run in the database yet: showing the bundled snapshot.'); return; }
      const st = s.data();
      if (st.runId === current) return;
      current = st.runId; S.state = st;
      try { await loadRun(st.runId); } catch (e) { useSnapshot('Could not load the latest run (' + (e.message || e.code) + '): showing the bundled snapshot.'); }
    }, e => { clearTimeout(timer); useSnapshot('Database error (' + e.code + '): showing the bundled snapshot.'); });
  }
  g.Store = S;
  init();
})(window);
