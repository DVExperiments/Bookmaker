/*
 * The Bookmaker: the betting shop of the Pixel Universe.
 *
 * A reader. It reads Glacial (ratings, form, the race itself), the Weather Bureau (residents' superstitions)
 * and Pixel City (where its regulars live). Nothing reads it, and nothing here can touch a race.
 *
 * Load order (all hard dependencies, because the shop's history depends on them):
 *   Glacial js/pixels.js, js/sim.js, js/league.js, then Weather, Senate, City universe.js, then this file.
 *
 * Conventions: UTC, seeded randomness only (seeds start "bookmaker:"), and simulation maths uses only
 * + - * / Math.floor Math.imul. Registers window.PixelUniverse.bookmaker.
 */
(function (root) {
  'use strict';

  const VERSION = '0.1.0';
  const MIN = 60000, H = 3600000, DAY = 86400000;
  const OPENS = Date.UTC(2026, 9, 1);   // the shop opens for the October Grand Prix
  const CLOSE_BEFORE = 30 * MIN;        // betting closes 30 minutes before the off
  const MARGIN = 1.08;                  // the house's cut
  const BOOK = 1200;                    // the house's own money spread across a market, in watts
  const START_BALANCE = 1000, STIPEND = 500, MIN_STAKE = 10;
  const REGULARS = 48;

  // ---------------------------------------------------------------- shared RNG (identical to Glacial's)
  function rng(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const seeded = (s) => rng(hash('bookmaker:' + s));

  // ---------------------------------------------------------------- small maths
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const rd2 = (x) => Math.floor(x * 100 + 0.5) / 100;
  const rnd = (x) => Math.floor(x + 0.5);
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const ymd = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const watts = (w) => rnd(w).toLocaleString('en') + ' W';

  /** Decimal odds for a probability, with the house's cut, snapped to a ladder. */
  function priceFor(p) {
    let d = 1 / (p * MARGIN);
    if (d < 1.01) d = 1.01;
    const step = d < 2 ? 0.02 : d < 4 ? 0.05 : d < 10 ? 0.1 : d < 20 ? 0.5 : 1;
    d = Math.floor(d / step + 0.5) * step;
    return rd2(d < 1.01 ? 1.01 : d);
  }

  // ---------------------------------------------------------------- upstream
  const U = () => root.PixelUniverse || {};
  const G = () => root.G;
  const ready = () => {
    const g = G(), u = U();
    return !!(g && g.buildLeague && g.simulate && g.PIXELS && g.EPOCH &&
      u.climate && u.senate && (!u.senate.ready || u.senate.ready()) && u.city && (!u.city.ready || u.city.ready()));
  };

  // ---------------------------------------------------------------- the race calendar, from Glacial
  // races[i] are simulated races (completed, then the one running); next is described but not yet run.
  let L = null, races = [], next = null, preRating = [], formLog = {};

  function ensureLeague(t) {
    if (L && (t < L.current.startMs + L.current.windowMs)) return;
    const g = G();
    L = g.buildLeague(t);
    races = L.races.concat([L.current]);
    next = L.next;
    // ratings before each race, replayed from Glacial's own deltas
    const r = {};
    g.PIXELS.forEach((p) => (r[p.id] = 1500));
    preRating = [];
    formLog = {};
    g.PIXELS.forEach((p) => (formLog[p.id] = []));
    races.forEach((race, i) => {
      preRating.push(Object.assign({}, r));
      if (!race.ratingDelta) return; // still running
      for (const id in race.ratingDelta) r[id] += race.ratingDelta[id];
      race.results.forEach((res) => formLog[res.id].push({ i, place: res.place, n: race.results.length, kind: race.kind, naps: res.naps, napMs: res.longestNapMs }));
    });
  }
  const raceAt = (k) => (k < races.length ? races[k] : k === races.length ? next : null);
  const completed = (k, t) => k < races.length && !!races[k].ratingDelta && races[k].startMs + races[k].windowMs <= t;
  const raceName = (r) => (r.kind === 'gp' ? r.name : 'Daily Crawl #' + r.number);

  /** Last five results before race index k, newest first, as "1", "2" ... */
  function form(id, k) {
    const out = [];
    const log = formLog[id];
    for (let j = log.length - 1; j >= 0 && out.length < 5; j--) if (log[j].i < k) out.push(log[j]);
    return out;
  }
  function formScore(f) {
    let s = 0;
    for (const x of f) {
      if (x.kind === 'crawl') s += x.place === 0 ? 1 : -1;
      else s += x.place < 3 ? 1 : x.place >= x.n / 2 ? -1 : 0;
    }
    return s;
  }

  // ---------------------------------------------------------------- the regulars
  const FIRST = ['Pip', 'Dot', 'Lux', 'Bit', 'Hex', 'Kel', 'Vin', 'Oro', 'Tess', 'Mag', 'Cyan', 'Ruby', 'Nib', 'Wren', 'Ada', 'Moss',
    'Quin', 'Ivo', 'Lumi', 'Sol', 'Tam', 'Juno', 'Rho', 'Ines', 'Pax', 'Ola', 'Fen', 'Bo', 'Etta', 'Cal', 'Mira', 'Ned'];
  const LAST = ['Halftone', 'Quill', 'Raster', 'Gamut', 'Pica', 'Kern', 'Scanline', 'Lumen', 'Ochre', 'Bitmap', 'Fresnel', 'Sepia',
    'Strobe', 'Vector', 'Glyph', 'Mosaic', 'Ledger', 'Tally', 'Cobalt', 'Umber', 'Serif', 'Pixley', 'Brightwater', 'Dimm'];
  const STYLES = {
    loyal: 'Backs a favourite pixel whenever it runs',
    chalk: 'Backs the market favourite',
    value: 'Backs whatever has drifted furthest from its opening price',
    longshot: 'Backs the longest price on the board',
    hunch: 'Backs a feeling'
  };
  const SUPERSTITIONS = {
    none: 'No superstitions, or none admitted to',
    rain: 'Will not place a bet while it is raining',
    gp: 'Doubles the stake on Grand Prix days',
    nap: 'Will not back a pixel that napped for over an hour last time out',
    wind: 'Halves the stake when the wind is over 30 km/h',
    seven: 'Every stake must end in a seven'
  };

  let regulars = null;
  function ensureRegulars() {
    if (regulars) return regulars;
    const g = G(), map = U().city.map();
    const districts = map.districts.filter((d) => d.residents > 0);
    let total = 0;
    for (const d of districts) total += d.residents;
    const r = seeded('regulars');
    const used = {};
    const styles = Object.keys(STYLES), sups = Object.keys(SUPERSTITIONS);
    regulars = [];
    for (let i = 0; i < REGULARS; i++) {
      let name;
      do { name = FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)]; } while (used[name]);
      used[name] = true;
      let pick = r() * total, home = districts[0];
      for (const d of districts) { pick -= d.residents; if (pick < 0) { home = d; break; } }
      // half the regulars back the pixel their district is named after
      const homePixel = g.PIXELS.filter((p) => p.name === home.name)[0];
      const fav = homePixel && r() < 0.5 ? homePixel.id : g.PIXELS[Math.floor(r() * g.PIXELS.length)].id;
      const style = styles[Math.floor(r() * styles.length)];
      const sup = r() < 0.35 ? 'none' : sups[1 + Math.floor(r() * (sups.length - 1))];
      regulars.push({
        id: 'r' + pad(i), name, district: home.name + ' district', favourite: fav, style, superstition: sup,
        styleText: STYLES[style], superstitionText: SUPERSTITIONS[sup],
        activity: 0.35 + r() * 0.55, frac: 0.03 + r() * 0.12
      });
    }
    return regulars;
  }

  // ---------------------------------------------------------------- money
  // Each regular has a list of transactions; their balance is a fold over those plus the calendar.
  // Stipends land at 00:00 UTC on the 1st; on 1 January every wallet first returns to 1,000 W.
  let tx = {};
  const KIND_ORDER = { payout: 0, refund: 0, reset: 1, stipend: 2, bet: 3 };
  function calendarBetween(from, to) {
    const out = [];
    let d = new Date(from), y = d.getUTCFullYear(), m = d.getUTCMonth();
    let t = Date.UTC(y, m, 1);
    if (t <= from) { m++; t = Date.UTC(y, m, 1); }
    while (t <= to) {
      const dd = new Date(t);
      if (dd.getUTCMonth() === 0) out.push({ t, kind: 'reset' });
      out.push({ t, kind: 'stipend', amount: STIPEND });
      t = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth() + 1, 1);
    }
    return out;
  }
  function balanceAt(id, t, extra) {
    const list = (tx[id] || []).concat(extra ? extra.filter((x) => x.res === id) : []).filter((x) => x.t <= t)
      .concat(calendarBetween(OPENS, t));
    list.sort((a, b) => a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    let bal = START_BALANCE;
    for (const x of list) bal = x.kind === 'reset' ? START_BALANCE : bal + x.amount;
    return bal;
  }

  // ---------------------------------------------------------------- markets
  const settled = [];   // memoised markets, in order, whose races have finished
  let firstMarket = -1;
  const events = [];    // memoised events from settled markets
  const records = { bigWin: 0, longWinner: 0 };

  function firstMarketIndex() {
    if (firstMarket >= 0) return firstMarket;
    for (let k = 1; k <= races.length; k++) if (raceAt(k).startMs - CLOSE_BEFORE > OPENS) { firstMarket = k; break; }
    return firstMarket;
  }

  /** Builds market k (opening prices, the regulars' bets) and settles it if its race is over by time t. */
  function buildMarket(k, t, memo) {
    const g = G(), race = raceAt(k), prev = raceAt(k - 1);
    const opens = prev.startMs > OPENS ? prev.startMs : OPENS;
    const closes = race.startMs - CLOSE_BEFORE;
    const rating = preRating[k - 1];
    const runners = race.kind === 'gp' ? g.topByRating({ rating }, 8) : race.lineup.slice();
    const forms = runners.map((id) => form(id, k - 1));
    // opening probabilities
    let p;
    if (runners.length === 2) {
      let e = 0.5 + (rating[runners[0]] - rating[runners[1]]) / 800 + (formScore(forms[0]) - formScore(forms[1])) * 0.01;
      e = clamp(e, 0.06, 0.94);
      p = [e, 1 - e];
    } else {
      const s = runners.map((id, i) => { const d = clamp(rating[id] - 1150, 40, 2000); return d * d * (1 + 0.03 * formScore(forms[i])); });
      let sum = 0;
      for (const x of s) sum += x;
      p = s.map((x) => x / sum);
    }
    const money = p.map((x) => BOOK * x);
    const prices = () => {
      let sum = 0;
      for (const m of money) sum += m;
      return p.map((x, i) => priceFor(0.55 * x + 0.45 * money[i] / sum));
    };
    const opening = prices();

    // the regulars decide at the open, using what is in their wallets then
    const regs = ensureRegulars();
    const extra = memo ? null : [];
    const intents = [];
    const span = closes - opens;
    for (const reg of regs) {
      const r = seeded('bet:' + race.id + ':' + reg.id);
      const go = r(), when = r(), pickR = r(), stakeR = r();
      if (race.kind !== 'gp' && go > reg.activity) continue;
      const at = opens + Math.floor(when * span * 0.97 / 1000) * 1000;
      intents.push({ reg, at, pickR, stakeR });
    }
    intents.sort((a, b) => a.at - b.at || (a.reg.id < b.reg.id ? -1 : 1));

    const bets = [], history = [{ t: opens, prices: opening.slice() }];
    for (const it of intents) {
      const reg = it.reg;
      const now = prices();
      const w = U().climate.sample(it.at);
      if (reg.superstition === 'rain' && w.rain > 0) continue;
      // choose a runner
      let pick = -1;
      if (reg.style === 'loyal') pick = runners.indexOf(reg.favourite);
      if (reg.style === 'chalk' || (reg.style === 'loyal' && pick < 0 && it.pickR < 0.5)) {
        pick = 0; for (let i = 1; i < now.length; i++) if (now[i] < now[pick]) pick = i;
      } else if (reg.style === 'longshot') {
        pick = 0; for (let i = 1; i < now.length; i++) if (now[i] > now[pick]) pick = i;
      } else if (reg.style === 'value') {
        pick = 0; for (let i = 1; i < now.length; i++) if (now[i] / opening[i] > now[pick] / opening[pick]) pick = i;
      } else if (reg.style === 'hunch') pick = Math.floor(it.pickR * runners.length);
      if (pick < 0) continue;
      if (reg.superstition === 'nap') {
        const last = forms[pick][0];
        if (last && last.napMs >= H) continue;
      }
      // how much
      const bal = balanceAt(reg.id, opens, extra);
      let stake = Math.floor(bal * reg.frac * (0.6 + it.stakeR * 0.8) / 10) * 10;
      if (reg.superstition === 'gp' && race.kind === 'gp') stake *= 2;
      if (reg.superstition === 'wind' && w.wind > 30) stake = Math.floor(stake / 20) * 10;
      if (reg.superstition === 'seven') stake = Math.floor(stake / 10) * 10 + 7;
      if (stake < MIN_STAKE) stake = MIN_STAKE + (reg.superstition === 'seven' ? 7 : 0);
      if (stake > bal - (bets.filter((b) => b.res === reg.id).reduce((a, b) => a + b.stake, 0))) continue;
      const bet = { res: reg.id, name: reg.name, district: reg.district, runner: runners[pick], stake, odds: now[pick], t: it.at };
      bets.push(bet);
      money[pick] += stake;
      history.push({ t: it.at, prices: prices() });
      const t1 = { t: it.at, kind: 'bet', amount: -stake, res: reg.id };
      if (memo) (tx[reg.id] = tx[reg.id] || []).push(t1); else extra.push(t1);
    }

    const m = {
      k, raceId: race.id, name: raceName(race), kind: race.kind, startMs: race.startMs, windowMs: race.windowMs,
      opens, closes, runners: runners.map((id, i) => ({
        id, name: g.PX[id].name, color: g.PX[id].color, rating: rnd(rating[id]),
        form: forms[i].map((f) => f.place + 1), chance: p[i], opening: opening[i]
      })),
      closing: prices(), history, bets, status: 'open'
    };

    // settlement
    if (completed(k, t)) {
      const res = races[k];
      const finalField = res.lineup;
      const winner = res.results[0].id;
      const end = res.startMs + res.windowMs;
      m.status = 'settled';
      m.winner = winner;
      m.void = runners.filter((id) => finalField.indexOf(id) < 0);
      m.sp = {};
      runners.forEach((id, i) => (m.sp[id] = m.closing[i]));
      let taken = 0, paid = 0;
      for (const b of bets) {
        taken += b.stake;
        if (m.void.indexOf(b.runner) >= 0) { b.result = 'void'; b.payout = b.stake; }
        else if (b.runner === winner) { b.result = 'won'; b.payout = rnd(b.stake * b.odds); }
        else { b.result = 'lost'; b.payout = 0; }
        paid += b.payout;
        if (b.payout > 0) {
          const t2 = { t: b.result === 'void' ? res.startMs : end, kind: b.result === 'void' ? 'refund' : 'payout', amount: b.payout, res: b.res };
          if (memo) (tx[b.res] = tx[b.res] || []).push(t2); else extra.push(t2);
        }
      }
      m.taken = taken; m.paid = paid;
    } else if (t >= race.startMs) m.status = 'running';
    else if (t >= closes) m.status = 'closed';
    return m;
  }

  // ---------------------------------------------------------------- events
  function emit(out, t, type, importance, idPart, data, headline) {
    out.push({ id: 'bookmaker:' + idPart, time: iso(t), source: 'bookmaker', type, importance, data, headline, ms: t });
  }
  function marketEvents(m, out, t) {
    const g = G();
    const fav = m.runners.slice().sort((a, b) => a.opening - b.opening);
    emit(out, m.opens, 'market.open', m.kind === 'gp' ? 2 : 1, m.raceId + ':open', { race: m.raceId, prices: fav.map((r) => [r.id, r.opening]) },
      'Betting opens on the ' + m.name + ' with ' + fav[0].name + ' favourite at ' + fav[0].opening.toFixed(2));
    for (const b of m.bets) {
      if (b.t > t) continue;
      if (b.stake >= 150) emit(out, b.t, 'bet.large', b.stake >= 400 ? 3 : 2, m.raceId + ':bet:' + b.res, { race: m.raceId, resident: b.name, pixel: b.runner, stake: b.stake, odds: b.odds },
        b.name + ' of ' + b.district + ' puts ' + watts(b.stake) + ' on ' + g.PX[b.runner].name + ' at ' + b.odds.toFixed(2));
    }
    if (m.status !== 'settled') return;
    const end = m.startMs + m.windowMs;
    if (m.void.length) {
      const n = m.bets.filter((b) => b.result === 'void').length;
      emit(out, m.startMs, 'market.void', 2, m.raceId + ':void', { race: m.raceId, pixels: m.void, bets: n },
        m.void.map((id) => g.PX[id].name).join(' and ') + (m.void.length === 1 ? ' misses' : ' miss') + ' the cut for the ' + m.name + '; ' + n + ' bet' + (n === 1 ? '' : 's') + ' returned in full');
    }
    const sp = m.sp[m.winner];
    const net = m.taken - m.paid;
    emit(out, end, 'market.settled', net < -300 ? 2 : 1, m.raceId + ':settled', { race: m.raceId, winner: m.winner, sp, taken: m.taken, paid: m.paid },
      net >= 0 ? 'The house takes ' + watts(net) + ' on the ' + m.name + ' as ' + g.PX[m.winner].name + ' wins at ' + sp.toFixed(2)
        : 'The house pays out ' + watts(-net) + ' more than it took as ' + g.PX[m.winner].name + ' wins the ' + m.name + ' at ' + sp.toFixed(2));
    if (sp >= 4 && sp > records.longWinner) {
      records.longWinner = sp;
      emit(out, end, 'record.longshot', 3, m.raceId + ':longshot', { race: m.raceId, pixel: m.winner, sp },
        g.PX[m.winner].name + ' wins at ' + sp.toFixed(2) + ', the longest-priced winner since the shop opened');
    }
    let top = null;
    for (const b of m.bets) if (b.result === 'won' && (!top || b.payout > top.payout)) top = b;
    for (const b of m.bets) {
      if (b.result !== 'won') continue;
      if (b === top && b.payout > records.bigWin) {
        records.bigWin = b.payout;
        if (b.payout >= 300) emit(out, end, 'record.payout', 4, m.raceId + ':record:' + b.res, { race: m.raceId, resident: b.name, payout: b.payout },
          b.name + ' collects ' + watts(b.payout) + ', the largest single payout in the shop’s history');
      } else if (b.payout >= 400) emit(out, end, 'payout.large', 3, m.raceId + ':win:' + b.res, { race: m.raceId, resident: b.name, payout: b.payout },
        b.name + ' of ' + b.district + ' collects ' + watts(b.payout) + ' on ' + G().PX[b.runner].name);
    }
    // anyone cleaned out by this result
    const losers = {};
    for (const b of m.bets) if (b.result === 'lost') losers[b.res] = b;
    for (const id in losers) {
      if (balanceAt(id, end) < MIN_STAKE && balanceAt(id, end - 1) >= 0) {
        const b = losers[id];
        emit(out, end, 'resident.ruined', 2, m.raceId + ':ruined:' + id, { race: m.raceId, resident: b.name, pixel: b.runner },
          b.name + ' of ' + b.district + ' is cleaned out after backing ' + G().PX[b.runner].name + ' and will sit out until the stipend');
      }
    }
  }

  /** Settles every market whose race has finished by t, in order, once. */
  function ensureSettled(t) {
    ensureLeague(t);
    ensureRegulars();
    const first = firstMarketIndex();
    if (first < 0) return;
    if (!settled.length) emit(events, OPENS, 'shop.open', 4, 'shop:open', {}, 'The Bookmaker opens its doors, and ' + REGULARS + ' regulars are waiting');
    let k = first + settled.length;
    while (completed(k, t)) {
      const m = buildMarket(k, t, true);
      settled.push(m);
      marketEvents(m, events, Infinity);
      k++;
    }
  }

  // ---------------------------------------------------------------- in-running prices
  function liveFor(race, t) {
    const g = G();
    const ms = t - race.startMs;
    const xs = race.lineup.map((id, i) => g.posAt(race, i, ms));
    const modes = race.lineup.map((id, i) => g.modeAt(race, i, ms));
    const done = race.lineup.map((id, i) => modes[i] === 'f');
    let max = 0;
    for (const x of xs) if (x > max) max = x;
    const remaining = 1 - max;
    const span = 0.08 + remaining * 0.6;
    const w = xs.map((x, i) => {
      if (done[i]) return race.results.find((r) => r.i === i).place === 0 ? 1e6 : 0.0001;
      let v = x - (max - span);
      if (v < 0.002) v = 0.002;
      v = v * v;
      if (modes[i] === 'n') v *= 0.5;
      if (modes[i] === 's') v *= 1.3;
      return v;
    });
    let sum = 0;
    for (const v of w) sum += v;
    return race.lineup.map((id, i) => ({ id, name: g.PX[id].name, color: g.PX[id].color, x: xs[i], mode: modes[i], price: priceFor(clamp(w[i] / sum, 0.01, 0.99)) }));
  }

  // ---------------------------------------------------------------- public API
  function indexAt(t) {
    for (let k = races.length - 1; k >= 0; k--) if (races[k].startMs <= t) return k;
    return -1;
  }
  function marketAt(k, t) {
    if (k < firstMarketIndex()) return null;
    const s = settled[k - firstMarketIndex()];
    if (s && completed(k, t)) return s;
    if (!raceAt(k)) return null;
    return buildMarket(k, t, false);
  }
  function snapshot(m, t) {
    if (!m) return null;
    const bets = m.bets.filter((b) => b.t <= t);
    let h = m.history[0];
    for (const x of m.history) if (x.t <= t) h = x;
    return Object.assign({}, m, { bets, prices: h.prices, history: m.history.filter((x) => x.t <= t) });
  }

  function stateAt(t) {
    if (!ready()) return { time: t, started: false, unavailable: 'Glacial, the Weather Bureau, the Senate or Pixel City could not be reached' };
    if (t < OPENS) return { time: t, started: false };
    ensureSettled(t);
    const k = indexAt(t);
    const running = k >= 0 ? races[k] : null;
    const open = snapshot(marketAt(k + 1, t), t);
    const live = running && !completed(k, t) ? { raceId: running.id, name: raceName(running), runners: liveFor(running, t), market: snapshot(marketAt(k, t), t) } : null;
    const regs = ensureRegulars().map((r) => {
      const mine = [];
      for (const m of settled) if (m.startMs + m.windowMs <= t) for (const b of m.bets) if (b.res === r.id) mine.push(b);
      let won = 0, staked = 0, returned = 0, best = 0;
      for (const b of mine) { staked += b.stake; returned += b.payout; if (b.result === 'won') { won++; if (b.payout > best) best = b.payout; } }
      return Object.assign({}, r, { balance: balanceAt(r.id, t), bets: mine.length, wins: won, staked, returned, best });
    });
    const recent = settled.filter((m) => m.startMs + m.windowMs <= t).slice(-12).reverse();
    return { time: t, started: true, version: VERSION, open, live, regulars: regs, recent };
  }

  function eventsBetween(from, to) {
    if (!ready() || to < OPENS) return [];
    ensureSettled(to);
    const out = events.filter((e) => e.ms >= from && e.ms < to);
    // the markets still open or running at `to` contribute their opening and their large bets so far
    const k = indexAt(to);
    const extra = [];
    for (const j of [k, k + 1]) {
      if (j < firstMarketIndex() || completed(j, to) || !raceAt(j)) continue;
      const m = buildMarket(j, to, false);
      if (m.opens < to) marketEvents(m, extra, to);
    }
    for (const e of extra) if (e.ms >= from && e.ms < to) out.push(e);
    out.sort((a, b) => a.ms - b.ms);
    return out.map((e) => { const c = Object.assign({}, e); delete c.ms; return c; });
  }

  /** Settles a visitor's slip: pending, won, lost or void (a non-runner). */
  function settle(slip, t) {
    if (!ready()) return { status: 'pending' };
    ensureLeague(t);
    let k = -1;
    for (let j = 0; j < races.length; j++) if (races[j].id === slip.raceId) { k = j; break; }
    if (k < 0 || !completed(k, t)) {
      if (k >= 0 && t >= races[k].startMs && races[k].lineup.indexOf(slip.pixel) < 0) return { status: 'void', payout: slip.stake, at: races[k].startMs };
      return { status: 'pending' };
    }
    const race = races[k];
    if (race.lineup.indexOf(slip.pixel) < 0) return { status: 'void', payout: slip.stake, at: race.startMs };
    if (race.results[0].id === slip.pixel) return { status: 'won', payout: rnd(slip.stake * slip.odds), at: race.startMs + race.windowMs };
    return { status: 'lost', payout: 0, at: race.startMs + race.windowMs };
  }

  root.PixelUniverse = root.PixelUniverse || {};
  root.PixelUniverse.bookmaker = {
    version: VERSION, source: 'bookmaker', startDate: ymd(OPENS), opens: OPENS, ready,
    rules: { margin: MARGIN, closeBefore: CLOSE_BEFORE, minStake: MIN_STAKE, startBalance: START_BALANCE, stipend: STIPEND },
    stateAt, eventsBetween, settle,
    regulars: () => (ready() ? ensureRegulars() : []),
    STYLES, SUPERSTITIONS
  };
})(typeof window !== 'undefined' ? window : globalThis);
