/* Quant engine: statistics, portfolio math, optimizers, Monte Carlo, options. Pure functions, no DOM. */
(function (global) {
  'use strict';
  const TD = 252; // trading days per year

  // ---------- basic stats ----------
  const sum = a => a.reduce((s, x) => s + x, 0);
  const mean = a => (a.length ? sum(a) / a.length : 0);
  function variance(a) {
    if (a.length < 2) return 0;
    const m = mean(a);
    return sum(a.map(x => (x - m) ** 2)) / (a.length - 1);
  }
  const std = a => Math.sqrt(variance(a));
  function cov(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 2) return 0;
    const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
    return s / (n - 1);
  }
  const corr = (a, b) => { const d = std(a) * std(b); return d ? cov(a, b) / d : 0; };
  function quantile(a, q) {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function skew(a) {
    const m = mean(a), s = std(a), n = a.length;
    if (!s || n < 3) return 0;
    return (n / ((n - 1) * (n - 2))) * sum(a.map(x => ((x - m) / s) ** 3));
  }
  function kurtosisExcess(a) {
    const m = mean(a), s = std(a), n = a.length;
    if (!s || n < 4) return 0;
    const k = sum(a.map(x => ((x - m) / s) ** 4)) / n;
    return k - 3;
  }

  // ---------- series helpers ----------
  /** series: {dates:[], close:[]} -> simple returns aligned to dates[1..] */
  function returns(close) {
    const r = [];
    for (let i = 1; i < close.length; i++) r.push(close[i] / close[i - 1] - 1);
    return r;
  }
  /** Align multiple {dates, close} series on the intersection of dates. */
  function align(seriesMap) {
    const keys = Object.keys(seriesMap);
    if (!keys.length) return { dates: [], prices: {} };
    const sets = keys.map(k => new Map(seriesMap[k].dates.map((d, i) => [d, seriesMap[k].close[i]])));
    let common = seriesMap[keys[0]].dates.filter(d => sets.every(s => s.has(d)));
    common.sort();
    const prices = {};
    keys.forEach((k, j) => { prices[k] = common.map(d => sets[j].get(d)); });
    return { dates: common, prices };
  }
  function maxDrawdown(equity) {
    let peak = -Infinity, mdd = 0, peakI = 0, start = 0, end = 0;
    equity.forEach((v, i) => {
      if (v > peak) { peak = v; peakI = i; }
      const dd = v / peak - 1;
      if (dd < mdd) { mdd = dd; start = peakI; end = i; }
    });
    return { mdd, start, end };
  }
  function drawdownSeries(equity) {
    let peak = -Infinity;
    return equity.map(v => { peak = Math.max(peak, v); return v / peak - 1; });
  }
  function cumulative(rets, start = 1) {
    const out = [start];
    rets.forEach(r => out.push(out[out.length - 1] * (1 + r)));
    return out;
  }
  function rollingStd(r, w) {
    const out = [];
    for (let i = 0; i < r.length; i++) out.push(i + 1 < w ? null : std(r.slice(i + 1 - w, i + 1)) * Math.sqrt(TD));
    return out;
  }

  // ---------- matrices ----------
  function covMatrix(retMat) { // retMat: array of return arrays (assets)
    const n = retMat.length;
    const C = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) { C[i][j] = C[j][i] = cov(retMat[i], retMat[j]); }
    return C;
  }
  function corrMatrix(retMat) {
    const n = retMat.length;
    return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : corr(retMat[i], retMat[j]))));
  }
  const matVec = (M, v) => M.map(row => sum(row.map((x, j) => x * v[j])));
  const dot = (a, b) => sum(a.map((x, i) => x * b[i]));
  const quad = (w, C) => dot(w, matVec(C, w));
  /** Cholesky decomposition with small jitter for PSD matrices. */
  function cholesky(A) {
    const n = A.length, L = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][j] = Math.sqrt(Math.max(s, 1e-12)); else L[i][j] = s / L[j][j];
    }
    return L;
  }

  // ---------- portfolio analytics ----------
  function portfolioReturns(retMat, w) {
    const T = retMat[0] ? retMat[0].length : 0, out = new Array(T).fill(0);
    for (let i = 0; i < retMat.length; i++) for (let t = 0; t < T; t++) out[t] += w[i] * retMat[i][t];
    return out;
  }
  function metrics(r, rf = 0, bench = null) {
    const ann = mean(r) * TD, vol = std(r) * Math.sqrt(TD);
    const rfD = rf / TD;
    const downside = Math.sqrt(mean(r.map(x => Math.min(0, x - rfD) ** 2))) * Math.sqrt(TD);
    const eq = cumulative(r);
    const years = r.length / TD;
    const cagr = years > 0 ? eq[eq.length - 1] ** (1 / years) - 1 : 0;
    const dd = maxDrawdown(eq);
    const var95 = -quantile(r, 0.05), var99 = -quantile(r, 0.01);
    const tail = r.filter(x => x <= -var95);
    const cvar95 = tail.length ? -mean(tail) : var95;
    const out = {
      annReturn: ann, cagr, vol, sharpe: vol ? (ann - rf) / vol : 0,
      sortino: downside ? (ann - rf) / downside : 0, mdd: dd.mdd, calmar: dd.mdd ? cagr / -dd.mdd : 0,
      var95, var99, cvar95, skew: skew(r), kurt: kurtosisExcess(r), hitRate: r.filter(x => x > 0).length / (r.length || 1),
      totalReturn: eq[eq.length - 1] - 1,
    };
    if (bench) {
      const v = variance(bench);
      out.beta = v ? cov(r, bench) / v : 0;
      out.alpha = ann - (rf + out.beta * (mean(bench) * TD - rf));
      out.corrBench = corr(r, bench);
      const te = std(r.map((x, i) => x - bench[i])) * Math.sqrt(TD);
      out.trackingError = te;
      out.infoRatio = te ? (ann - mean(bench) * TD) / te : 0;
    }
    return out;
  }
  /** Euler risk decomposition: share of portfolio variance from each asset. */
  function riskContributions(w, C) {
    const Cw = matVec(C, w), pv = dot(w, Cw);
    return w.map((wi, i) => (pv ? (wi * Cw[i]) / pv : 0));
  }
  function diversificationRatio(w, C) {
    const vols = C.map((row, i) => Math.sqrt(row[i]));
    const pv = Math.sqrt(quad(w, C));
    return pv ? dot(w, vols) / pv : 1;
  }

  // ---------- optimizers (long-only, sum=1, per-asset cap) ----------
  function projectCappedSimplex(v, cap = 1) {
    const n = v.length;
    cap = Math.max(cap, 1 / n + 1e-9);
    let lo = Math.min(...v) - cap - 1, hi = Math.max(...v) + 1;
    for (let it = 0; it < 100; it++) {
      const tau = (lo + hi) / 2;
      const s = sum(v.map(x => Math.min(cap, Math.max(0, x - tau))));
      if (s > 1) lo = tau; else hi = tau;
    }
    const tau = (lo + hi) / 2;
    return v.map(x => Math.min(cap, Math.max(0, x - tau)));
  }
  function minVariance(C, cap = 1, iters = 3000) {
    const n = C.length;
    let w = Array(n).fill(1 / n);
    const L = Math.max(...C.map(row => sum(row.map(Math.abs)))) * 2 || 1;
    for (let k = 0; k < iters; k++) {
      const g = matVec(C, w).map(x => 2 * x);
      w = projectCappedSimplex(w.map((x, i) => x - g[i] / L), cap);
    }
    return w;
  }
  /** Max Sharpe via projected gradient ascent on the Sharpe ratio (several restarts). */
  function maxSharpe(mu, C, rf = 0, cap = 1, iters = 4000) {
    const n = mu.length;
    const sharpe = w => (dot(w, mu) - rf) / Math.sqrt(Math.max(quad(w, C), 1e-12));
    let best = null, bestS = -Infinity;
    const starts = [Array(n).fill(1 / n), ...mu.map((_, i) => projectCappedSimplex(mu.map((__, j) => (i === j ? 1 : 0)), cap))];
    for (const s0 of starts) {
      let w = s0.slice(), step = 0.05;
      for (let k = 0; k < iters; k++) {
        const Cw = matVec(C, w), pv = Math.max(dot(w, Cw), 1e-12), sd = Math.sqrt(pv), ex = dot(w, mu) - rf;
        const g = mu.map((m, i) => m / sd - (ex * Cw[i]) / (pv * sd));
        const gn = Math.sqrt(dot(g, g)) || 1;
        w = projectCappedSimplex(w.map((x, i) => x + (step * g[i]) / gn), cap);
        step *= 0.999;
      }
      const s = sharpe(w);
      if (s > bestS) { bestS = s; best = w; }
    }
    return best;
  }
  function riskParity(C, iters = 500) {
    const n = C.length;
    let w = C.map((row, i) => 1 / Math.sqrt(row[i] || 1e-12));
    let s = sum(w); w = w.map(x => x / s);
    for (let k = 0; k < iters; k++) {
      const Cw = matVec(C, w), pv = dot(w, Cw), target = pv / n;
      w = w.map((wi, i) => wi * Math.sqrt(target / Math.max(wi * Cw[i], 1e-16)));
      s = sum(w); w = w.map(x => x / s);
    }
    return w;
  }
  function inverseVol(C) {
    const iv = C.map((row, i) => 1 / Math.sqrt(row[i] || 1e-12)), s = sum(iv);
    return iv.map(x => x / s);
  }
  /** Efficient frontier: for each target return, minimise variance with a quadratic penalty on the return shortfall. */
  function frontier(mu, C, cap = 1, points = 20) {
    const wMin = minVariance(C, cap);
    const rMin = dot(wMin, mu);
    const order = mu.map((m, i) => [m, i]).sort((a, b) => b[0] - a[0]);
    let left = 1, rMax = 0;
    for (const [m] of order) { const take = Math.min(cap, left); rMax += take * m; left -= take; if (left <= 1e-9) break; }
    const normC = Math.max(...C.map(row => sum(row.map(Math.abs)))) || 1;
    const lam = 50 * normC / Math.max(1e-8, dot(mu, mu));
    const Lip = 2 * normC + 2 * lam * dot(mu, mu);
    const out = [];
    let w = wMin.slice();
    for (let p = 0; p < points; p++) {
      const target = rMin + ((rMax - rMin) * p) / (points - 1);
      for (let k = 0; k < 2500; k++) {
        const Cw = matVec(C, w), gap = target - dot(w, mu);
        const g = Cw.map((x, i) => 2 * x - (gap > 0 ? 2 * lam * gap * mu[i] : 0));
        w = projectCappedSimplex(w.map((x, i) => x - g[i] / Lip), cap);
      }
      out.push({ ret: dot(w, mu), vol: Math.sqrt(quad(w, C)), w: w.slice() });
    }
    return out;
  }

  // ---------- random ----------
  function rng(seed = 42) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---------- Monte Carlo ----------
  /**
   * Simulate portfolio value paths.
   * method: 'bootstrap' (resample historical daily portfolio returns in blocks) or 'gbm' (normal with mu/sigma)
   */
  function monteCarlo({ hist, days, paths = 2000, start = 1, method = 'bootstrap', mu, sigma, block = 10, contrib = 0, seed = 7, driftOverride = null }) {
    const rand = rng(seed);
    const mD = mu != null ? mu / TD : mean(hist), sD = sigma != null ? sigma / Math.sqrt(TD) : std(hist);
    const adj = driftOverride != null ? driftOverride / TD - mean(hist) : 0;
    const step = Math.max(1, Math.floor(days / 120));
    const sampleIdx = [];
    for (let t = 0; t <= days; t += step) sampleIdx.push(t);
    if (sampleIdx[sampleIdx.length - 1] !== days) sampleIdx.push(days);
    const snap = sampleIdx.map(() => new Float64Array(paths));
    const finals = new Float64Array(paths), mdds = new Float64Array(paths);
    const contribD = contrib / TD;
    for (let p = 0; p < paths; p++) {
      let v = start, peak = start, mdd = 0, si = 0, t = 0;
      snap[si++][p] = v;
      while (t < days) {
        if (method === 'bootstrap' && hist.length > block) {
          const s = Math.floor(rand() * (hist.length - block));
          for (let b = 0; b < block && t < days; b++, t++) {
            v = v * (1 + hist[s + b] + adj) + contribD;
            if (v > peak) peak = v; mdd = Math.min(mdd, v / peak - 1);
            if (sampleIdx[si] === t + 1) snap[si++][p] = v;
          }
        } else {
          const r = Math.exp(mD - 0.5 * sD * sD + sD * gaussian(rand)) - 1;
          v = v * (1 + r) + contribD; t++;
          if (v > peak) peak = v; mdd = Math.min(mdd, v / peak - 1);
          if (sampleIdx[si] === t) snap[si++][p] = v;
        }
      }
      finals[p] = v; mdds[p] = mdd;
    }
    const qs = [0.05, 0.25, 0.5, 0.75, 0.95];
    const bands = qs.map(q => snap.map(arr => quantile(Array.from(arr), q)));
    return { t: sampleIdx, bands, qs, finals: Array.from(finals), mdds: Array.from(mdds) };
  }

  // ---------- options (Black-Scholes-Merton) ----------
  function erf(x) { // Abramowitz-Stegun 7.1.26
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const ncdf = x => 0.5 * (1 + erf(x / Math.SQRT2));
  const npdf = x => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  function bs(type, S, K, T, r, sigma, q = 0) {
    if (T <= 0 || sigma <= 0) {
      const intrinsic = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
      return { price: intrinsic, delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, vega: 0, theta: 0 };
    }
    const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T)), d2 = d1 - sigma * Math.sqrt(T);
    const dq = Math.exp(-q * T), dr = Math.exp(-r * T);
    let price, delta, theta;
    if (type === 'call') {
      price = S * dq * ncdf(d1) - K * dr * ncdf(d2);
      delta = dq * ncdf(d1);
      theta = (-S * dq * npdf(d1) * sigma / (2 * Math.sqrt(T)) - r * K * dr * ncdf(d2) + q * S * dq * ncdf(d1)) / 365;
    } else {
      price = K * dr * ncdf(-d2) - S * dq * ncdf(-d1);
      delta = -dq * ncdf(-d1);
      theta = (-S * dq * npdf(d1) * sigma / (2 * Math.sqrt(T)) + r * K * dr * ncdf(-d2) - q * S * dq * ncdf(-d1)) / 365;
    }
    return { price, delta, gamma: (dq * npdf(d1)) / (S * sigma * Math.sqrt(T)), vega: (S * dq * npdf(d1) * Math.sqrt(T)) / 100, theta };
  }

  // ---------- hedging ----------
  /** Minimum-variance hedge ratio h* = rho * sigma_s / sigma_f (= OLS slope of spot on hedge returns). */
  function hedgeRatio(spot, hedge) {
    const v = variance(hedge);
    const h = v ? cov(spot, hedge) / v : 0;
    const rho = corr(spot, hedge);
    const hedged = spot.map((x, i) => x - h * hedge[i]);
    return { h, rho, effectiveness: rho * rho, volSpot: std(spot) * Math.sqrt(TD), volHedged: std(hedged) * Math.sqrt(TD) };
  }

  // ---------- sizing ----------
  /** Kelly fraction maximizing E[ln(1 + f*r)] over discrete scenarios [{p, r}]. Searches f in [0, fmax]. */
  function kellyDiscrete(scen, fmax = 3) {
    const tot = sum(scen.map(s => s.p)) || 1;
    const sc = scen.map(s => ({ p: s.p / tot, r: s.r }));
    let best = 0, bestG = 0;
    for (let f = 0; f <= fmax + 1e-9; f += 0.005) {
      let g = 0, ok = true;
      for (const s of sc) { const x = 1 + f * s.r; if (x <= 0) { ok = false; break; } g += s.p * Math.log(x); }
      if (ok && g > bestG) { bestG = g; best = f; }
    }
    return { f: best, growth: bestG };
  }

  // ---------- technical / behavior ----------
  function sma(a, n) { return a.map((_, i) => (i + 1 < n ? null : mean(a.slice(i + 1 - n, i + 1)))); }
  function rsi(close, n = 14) {
    if (close.length <= n) return null;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = close[i] - close[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (let i = n + 1; i < close.length; i++) {
      const d = close[i] - close[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  /** Summarise what price behaviour says, independent of any narrative. */
  function behavior(close, benchClose = null) {
    const n = close.length, last = close[n - 1];
    const ret = k => (n > k ? last / close[n - 1 - k] - 1 : null);
    const s50 = sma(close, 50)[n - 1], s200 = sma(close, 200)[n - 1];
    const r = returns(close);
    const volNow = std(r.slice(-21)) * Math.sqrt(TD), volLong = std(r.slice(-252)) * Math.sqrt(TD);
    const hi = Math.max(...close.slice(-252));
    const out = {
      r1m: ret(21), r3m: ret(63), r6m: ret(126), r12m: ret(252),
      mom12_1: n > 252 ? close[n - 22] / close[n - 253] - 1 : null,
      above50: s50 != null ? last > s50 : null, above200: s200 != null ? last > s200 : null,
      golden: s50 != null && s200 != null ? s50 > s200 : null,
      rsi14: rsi(close, 14), volNow, volLong, volRegime: volLong ? volNow / volLong : null,
      fromHigh: last / hi - 1,
    };
    if (benchClose && benchClose.length === n) {
      const b = k => (n > k ? benchClose[n - 1] / benchClose[n - 1 - k] - 1 : null);
      out.rs3m = out.r3m != null ? out.r3m - b(63) : null;
      out.rs12m = out.r12m != null ? out.r12m - b(252) : null;
    }
    // trend score -3..+3
    let score = 0;
    if (out.above50 != null) score += out.above50 ? 1 : -1;
    if (out.above200 != null) score += out.above200 ? 1 : -1;
    if (out.mom12_1 != null) score += out.mom12_1 > 0 ? 1 : -1;
    out.trendScore = score;
    return out;
  }

  global.Q = {
    TD, sum, mean, variance, std, cov, corr, quantile, skew, kurtosisExcess, returns, align, maxDrawdown, drawdownSeries,
    cumulative, rollingStd, covMatrix, corrMatrix, matVec, dot, quad, cholesky, portfolioReturns, metrics, riskContributions,
    diversificationRatio, projectCappedSimplex, minVariance, maxSharpe, riskParity, inverseVol, frontier, rng, gaussian,
    monteCarlo, bs, ncdf, hedgeRatio, kellyDiscrete, sma, rsi, behavior,
  };
})(typeof window !== 'undefined' ? window : globalThis);
