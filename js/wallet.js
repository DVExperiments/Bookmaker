/*
 * The visitor's wallet, kept in this browser only. Shared by every Pixel Universe site on the
 * dvexperiments.github.io origin under one key, so Glacial can show "your bet" and the city can pay
 * for stray sparks. Copy this file as-is into any site that needs it.
 *
 * Rules (Shared Conventions, Visitor bankroll): 1,000 W on first visit; 500 W on the first visit on or
 * after the 1st of each month, no back pay; on the first visit of a new year the wallet returns to
 * 1,000 W before that month's stipend; minimum stake 10 W; no cap on the balance.
 */
(function () {
  'use strict';
  const KEY = 'pixeluniverse.wallet.v1';
  const START = 1000, STIPEND = 500, MIN_STAKE = 10, KEEP_LEDGER = 200;
  const monthKey = (ms) => { const d = new Date(ms); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };

  function read() {
    try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function write(w) {
    try { localStorage.setItem(KEY, JSON.stringify(w)); return true; } catch (e) { return false; }
  }
  function note(w, t, kind, amount, text) {
    w.ledger.unshift({ t, kind, amount, text });
    if (w.ledger.length > KEEP_LEDGER) w.ledger.length = KEEP_LEDGER;
  }

  /** Loads the wallet, creating it and paying any stipend or reset due at time `now`. */
  function load(now) {
    let w = read();
    if (!w || typeof w.balance !== 'number') {
      w = { version: 1, created: now, balance: START, lastMonth: monthKey(now), slips: [], sparks: {}, ledger: [] };
      note(w, now, 'start', START, 'Opening balance');
      write(w);
      return w;
    }
    const m = monthKey(now);
    if (m > w.lastMonth) {
      if (Math.floor(m / 12) > Math.floor(w.lastMonth / 12)) {
        note(w, now, 'reset', START - w.balance, 'The energy year closes: balance returns to 1,000 W');
        w.balance = START;
      }
      w.balance += STIPEND;
      note(w, now, 'stipend', STIPEND, 'Monthly stipend for the energy your screen generated');
      w.lastMonth = m;
      write(w);
    }
    return w;
  }

  /** Places a slip. Returns the slip, or an error message for the person. */
  function place(w, slip) {
    if (!(slip.stake >= MIN_STAKE)) return { error: 'The minimum stake is ' + MIN_STAKE + ' W.' };
    if (slip.stake > w.balance) return { error: 'That is more than your balance of ' + Math.floor(w.balance) + ' W.' };
    const s = Object.assign({ id: slip.raceId + ':' + slip.placed, status: 'pending', payout: 0 }, slip);
    w.balance -= s.stake;
    w.slips.unshift(s);
    note(w, s.placed, 'bet', -s.stake, 'Bet on ' + s.pixelName + ' at ' + s.odds.toFixed(2) + ', ' + s.raceName);
    if (!write(w)) return { error: 'This browser would not save the slip. Check that site storage is allowed, then try again.' };
    return { slip: s };
  }

  /** Settles pending slips with a function (slip, now) → { status, payout }. Returns the slips just settled. */
  function settleAll(w, settle, now) {
    const done = [];
    for (const s of w.slips) {
      if (s.status !== 'pending') continue;
      const r = settle(s, now);
      if (!r || r.status === 'pending') continue;
      s.status = r.status;
      s.payout = r.payout;
      s.settled = r.at || now;
      w.balance += r.payout;
      if (r.payout) note(w, now, r.status === 'void' ? 'refund' : 'win', r.payout,
        (r.status === 'void' ? 'Stake returned: ' + s.pixelName + ' did not run in the ' : s.pixelName + ' won the ') + s.raceName);
      done.push(s);
    }
    if (done.length) write(w);
    return done;
  }

  /** For Pixel City: pays for a caught spark, once per spark id. */
  function catchSpark(w, id, amount, now) {
    if (w.sparks[id]) return false;
    w.sparks[id] = now;
    w.balance += amount;
    note(w, now, 'spark', amount, 'Stray spark returned to the grid');
    return write(w);
  }

  window.PixelWallet = { KEY, START, STIPEND, MIN_STAKE, load, place, settleAll, catchSpark, read };
})();
