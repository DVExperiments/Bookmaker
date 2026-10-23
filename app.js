/*
 * The shop floor. Rendering only: everything here reads PixelUniverse.bookmaker and the visitor's wallet.
 * Only this file calls Date.now().
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const B = window.PixelUniverse && window.PixelUniverse.bookmaker;
  const W = window.PixelWallet;
  const G = window.G || {};
  const MODES = { c: 'Cruising', n: 'Napping', s: 'Sprinting', t: 'Stumbling', f: 'Finished' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const w = (n) => Math.round(n).toLocaleString('en') + ' W';
  const odds = (x) => x.toFixed(2);
  const local = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const pixelName = (id) => (G.PX && G.PX[id] ? G.PX[id].name : id);
  const pixelColor = (id) => (G.PX && G.PX[id] ? G.PX[id].color : '#888');
  function until(ms) {
    if (ms <= 0) return 'now';
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 1) return d + 'd ' + (h % 24) + 'h';
    if (h >= 1) return h + 'h ' + (m % 60) + 'm';
    return m + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
  }

  let wallet = W.load(Date.now());
  let state = null, market = null, pick = null, lastPrices = {};

  // ---------------------------------------------------------------- the Senate's laws, cosmetically
  const FONT_AXES = {
    'Space Grotesk': 'wght@500;700', 'Fraunces': 'opsz,wght@9..144,500;9..144,700;9..144,800', 'DM Serif Display': '',
    'Syne': 'wght@500;700;800', 'Archivo Narrow': 'wght@500;600;700', 'Source Serif 4': 'opsz,wght@8..60,400;8..60,600',
    'Work Sans': 'wght@400;500;600', 'Atkinson Hyperlegible': 'wght@400;700', 'IBM Plex Mono': 'wght@400;500;600', 'Literata': 'opsz,wght@7..72,400;7..72,600'
  };
  const loaded = {};
  function loadFont(name) {
    if (!name || loaded[name] || !(name in FONT_AXES)) return;
    loaded[name] = true;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + name.replace(/ /g, '+') + (FONT_AXES[name] ? ':' + FONT_AXES[name] : '') + '&display=swap';
    document.head.appendChild(l);
  }
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let lawKey = '';
  function applyLaws() {
    const senate = window.PixelUniverse && window.PixelUniverse.senate;
    if (!senate || !senate.styleVars || (senate.ready && !senate.ready())) return;
    try {
      const now = Date.now(), vars = senate.styleVars(now, dark.matches ? 'dark' : 'light');
      const laws = senate.lawsAt(now);
      const key = JSON.stringify(vars) + dark.matches;
      if (key === lawKey) return;
      lawKey = key;
      for (const k in vars) document.documentElement.style.setProperty(k, vars[k]);
      loadFont(laws['style.display']);
      loadFont(laws['style.body']);
    } catch (e) { /* keep the default look */ }
  }
  dark.addEventListener('change', () => { lawKey = ''; applyLaws(); });

  // ---------------------------------------------------------------- the board
  function driftSvg(m, i) {
    const pts = m.history.map((h) => [h.t, h.prices[i]]);
    if (pts.length < 2) pts.push([Date.now(), m.prices[i]]);
    const t0 = m.opens, t1 = Math.max(Date.now(), pts[pts.length - 1][0]);
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
    if (hi - lo < 0.1) { hi += 0.05; lo -= 0.05; }
    const X = (t) => ((t - t0) / (t1 - t0 || 1)) * 118 + 1, Y = (v) => 30 - ((v - lo) / (hi - lo)) * 28;
    let d = 'M' + X(pts[0][0]).toFixed(1) + ' ' + Y(pts[0][1]).toFixed(1);
    for (let k = 1; k < pts.length; k++) d += 'H' + X(pts[k][0]).toFixed(1) + 'V' + Y(pts[k][1]).toFixed(1);
    d += 'H' + X(t1).toFixed(1);
    return '<svg class="drift" viewBox="0 0 120 32" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + m.runners[i].color + '" stroke-width="1.5" shape-rendering="crispEdges"/></svg>';
  }

  function renderBoard() {
    const now = Date.now();
    if (!market) {
      $('board-title').textContent = 'No market open';
      $('runners').innerHTML = '';
      $('board-foot').textContent = state && !state.started ? 'The shop opens on ' + new Date(B.opens).toUTCString().slice(0, 16) + '.' : '';
      return;
    }
    const open = market.status === 'open' && now < market.closes;
    $('board-title').textContent = market.name;
    const rows = market.runners.map((r, i) => {
      const p = market.prices[i];
      const was = lastPrices[market.raceId + r.id];
      const flash = was && was !== p ? (p > was ? ' flash-up' : ' flash-down') : '';
      lastPrices[market.raceId + r.id] = p;
      const form = r.form.length ? 'Form ' + r.form.join(' ') : 'No form';
      return '<li><button type="button" class="runner' + (open ? '' : ' closed') + '" data-id="' + r.id + '" aria-pressed="' + (pick === r.id) + '"' + (open ? '' : ' disabled') + '>' +
        '<span class="lamp" style="color:' + r.color + '"></span>' +
        '<span class="who"><b>' + esc(r.name) + '</b><span>Rating ' + r.rating + '. ' + form + '</span></span>' +
        driftSvg(market, i) +
        '<span class="price' + flash + '" aria-label="' + odds(p) + ', opened at ' + odds(r.opening) + '">' + odds(p) + '<small>opened ' + odds(r.opening) + '</small></span>' +
        '</button></li>';
    });
    $('runners').innerHTML = rows.join('');
    setTimeout(() => document.querySelectorAll('.flash-up,.flash-down').forEach((el) => el.classList.remove('flash-up', 'flash-down')), 60);
    const n = market.bets.length;
    let foot = n + ' bet' + (n === 1 ? '' : 's') + ' from the regulars so far, ' + w(market.bets.reduce((a, b) => a + b.stake, 0)) + ' in all.';
    if (market.kind === 'gp') foot += ' The field is provisional: the top eight by rating when the previous race finishes will run, and bets on any pixel that drops out are returned.';
    $('board-foot').textContent = foot;
    renderStatus();
  }
  function renderStatus() {
    if (!market) { $('board-status').textContent = ''; return; }
    const now = Date.now();
    $('board-status').textContent = now < market.closes
      ? 'Betting closes in ' + until(market.closes - now)
      : 'Betting closed. Off ' + local(market.startMs);
  }

  // ---------------------------------------------------------------- the slip
  function priceOf(id) {
    if (!market) return null;
    const i = market.runners.findIndex((r) => r.id === id);
    return i < 0 ? null : market.prices[i];
  }
  function renderSlip() {
    const now = Date.now();
    const open = market && market.status === 'open' && now < market.closes;
    const p = pick && priceOf(pick);
    const stake = Math.floor(Number($('stake').value) || 0);
    if (!open) {
      $('slip-pick').textContent = market ? 'Betting on the ' + market.name + ' has closed.' : 'Nothing to bet on yet.';
      $('slip-return').textContent = '';
      $('place').disabled = true;
      return;
    }
    if (!p) { $('slip-pick').textContent = 'Choose a pixel on the board.'; $('slip-return').textContent = ''; $('place').disabled = true; return; }
    $('slip-pick').textContent = pixelName(pick) + ' at ' + odds(p);
    $('slip-return').textContent = stake >= W.MIN_STAKE ? 'Returns ' + w(stake * p) + ' if ' + pixelName(pick) + ' wins.' : 'The minimum stake is ' + W.MIN_STAKE + ' W.';
    $('place').disabled = stake < W.MIN_STAKE || stake > wallet.balance;
  }

  $('runners').addEventListener('click', (e) => {
    const b = e.target.closest('.runner');
    if (!b || b.disabled) return;
    pick = b.dataset.id;
    document.querySelectorAll('.runner').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.id === pick)));
    $('slip-msg').textContent = '';
    renderSlip();
    if (matchMedia('(max-width: 860px)').matches) $('slip').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { $('stake').value = c.dataset.stake; renderSlip(); }));
  $('stake').addEventListener('input', renderSlip);
  $('slip').addEventListener('submit', (e) => {
    e.preventDefault();
    const now = Date.now();
    refresh(); // take the price as it stands this second
    if (!market || now >= market.closes) { $('slip-msg').textContent = 'Betting has closed on this race.'; renderSlip(); return; }
    const p = priceOf(pick);
    if (!p) return;
    const stake = Math.floor(Number($('stake').value) || 0);
    const r = W.place(wallet, { raceId: market.raceId, raceName: market.name, pixel: pick, pixelName: pixelName(pick), stake, odds: p, placed: now, source: 'bookmaker' });
    if (r.error) { $('slip-msg').textContent = r.error; return; }
    $('slip-msg').textContent = 'Bet placed: ' + w(stake) + ' on ' + pixelName(pick) + ' at ' + odds(p) + '.';
    renderWallet();
    renderSlip();
  });

  // ---------------------------------------------------------------- everything else
  function renderWallet() {
    $('balance').textContent = w(wallet.balance);
    const slips = wallet.slips.slice(0, 20);
    $('slips').innerHTML = slips.length ? slips.map((s) => {
      const res = s.status === 'won' ? 'Won ' + w(s.payout) : s.status === 'lost' ? 'Lost' : s.status === 'void' ? 'Returned: ' + esc(s.pixelName) + ' did not run' : 'Pending';
      return '<li' + (s.status === 'won' ? ' class="won"' : '') + '><span class="sw" style="background:' + pixelColor(s.pixel) + '"></span>' +
        w(s.stake) + ' on ' + esc(s.pixelName) + ' at ' + odds(s.odds) + '. ' + res + '<span class="meta">' + esc(s.raceName) + ', placed ' + local(s.placed) + '</span></li>';
    }).join('') : '<li class="empty">No bets yet. Choose a pixel on the board to place your first.</li>';
  }

  function renderLive() {
    const L = state && state.live;
    $('live-section').hidden = !L;
    if (!L) return;
    $('live-title').textContent = 'In running: ' + L.name;
    $('live-sub').textContent = 'Prices for show only. Betting on this race has closed.';
    $('live').innerHTML = L.runners.slice().sort((a, b) => b.x - a.x).map((r) =>
      '<li><span>' + esc(r.name) + '<span class="mode">' + MODES[r.mode] + '</span></span>' +
      '<span class="lane" role="img" aria-label="' + Math.round(r.x * 100) + '% of the track"><span class="dot" style="left:' + (r.x * 100).toFixed(2) + '%;background:' + r.color + '"></span></span>' +
      '<span class="p">' + (r.mode === 'f' ? '' : odds(r.price)) + '</span></li>').join('');
  }

  function renderFeed() {
    const now = Date.now();
    const ev = B.eventsBetween(now - 3 * 86400000, now).reverse().slice(0, 25);
    $('feed').innerHTML = ev.length ? ev.map((e) => '<li' + (e.importance >= 3 ? ' class="big"' : '') + '>' + esc(e.headline) + '<time datetime="' + e.time + '">' + local(Date.parse(e.time)) + '</time></li>').join('')
      : '<li class="empty">The counter is quiet.</li>';
  }

  function renderResults() {
    const rows = state.recent.map((m) => {
      const net = m.taken - m.paid;
      return '<tr><td>' + esc(m.name) + '<span class="sub">' + new Date(m.startMs).toUTCString().slice(0, 16) + '</span></td>' +
        '<td><span class="sw" style="background:' + pixelColor(m.winner) + '"></span>' + esc(pixelName(m.winner)) + '</td>' +
        '<td class="r">' + odds(m.sp[m.winner]) + '</td><td class="r">' + m.bets.length + '</td><td class="r">' + w(m.taken) + '</td><td class="r">' + w(m.paid) + '</td>' +
        '<td class="r">' + (net >= 0 ? '+' : '−') + w(Math.abs(net)) + '</td></tr>';
    });
    $('results').innerHTML = '<thead><tr><th>Race</th><th>Winner</th><th class="r">Starting price</th><th class="r">Bets</th><th class="r">Taken</th><th class="r">Paid</th><th class="r">House</th></tr></thead><tbody>' +
      (rows.join('') || '<tr><td colspan="7" class="empty">No races settled yet.</td></tr>') + '</tbody>';
  }

  function renderRegulars() {
    const rows = state.regulars.slice().sort((a, b) => b.balance - a.balance).map((r) =>
      '<tr><td>' + esc(r.name) + '<span class="sub">' + esc(r.district) + '</span></td>' +
      '<td class="r">' + w(r.balance) + '</td><td class="r">' + r.wins + ' of ' + r.bets + '</td><td class="r">' + (r.best ? w(r.best) : '') + '</td>' +
      '<td><span class="sw" style="background:' + pixelColor(r.favourite) + '"></span>' + esc(pixelName(r.favourite)) + '</td>' +
      '<td>' + esc(r.styleText) + '<span class="sub">' + esc(r.superstitionText) + '</span></td></tr>');
    $('regulars').innerHTML = '<thead><tr><th>Regular</th><th class="r">Balance</th><th class="r">Winners</th><th class="r">Best win</th><th>Favourite</th><th>Habits</th></tr></thead><tbody>' + rows.join('') + '</tbody>';
  }

  function refresh() {
    const now = Date.now();
    state = B.stateAt(now);
    if (!state.started) { market = null; renderBoard(); renderSlip(); return; }
    market = state.open;
    // a link from Glacial can name the race: #C-2026-10-25
    const want = location.hash.slice(1);
    if (want && market && want !== market.raceId && /^(C|GP)-/.test(want)) { $('notice').hidden = false; $('notice').textContent = 'Betting on that race is not open. The board shows the next race you can bet on.'; }
    const settled = W.settleAll(wallet, B.settle, now);
    if (settled.length) {
      const won = settled.filter((s) => s.status === 'won');
      $('slip-msg').textContent = won.length ? 'Your bet on ' + won[0].pixelName + ' won ' + w(won[0].payout) + '.' : settled.length + ' bet' + (settled.length === 1 ? '' : 's') + ' settled.';
    }
    if (pick && !priceOf(pick)) pick = null;
    renderBoard(); renderSlip(); renderLive(); renderWallet(); renderFeed(); renderResults(); renderRegulars();
  }

  // ---------------------------------------------------------------- start
  renderWallet();
  if (!B || !B.ready()) {
    $('notice').hidden = false;
    $('notice').textContent = 'The shop is shut: Glacial, the Weather Bureau, the Senate or Pixel City could not be reached, and the odds cannot be set without them. Your balance and slips are safe in this browser. Reload the page to try again.';
    $('board-title').textContent = 'The shop is shut';
    renderSlip();
    return;
  }
  applyLaws();
  refresh();
  setInterval(() => { renderStatus(); if (market && Date.now() >= market.closes && market.status === 'open') refresh(); }, 1000);
  setInterval(refresh, 20000);
  setInterval(applyLaws, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { wallet = W.load(Date.now()); refresh(); } });
})();
