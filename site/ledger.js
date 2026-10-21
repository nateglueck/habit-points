"use strict";

const DAY_MS = 86_400_000;

// Replays the whole history oldest-first. Each completion becomes a lot of points
// that expires `validityDays` after it was earned; each spend consumes the oldest
// live lots first, so the points closest to expiring are always used up first.
//
// Spending unlocks once the balance reaches `gatePoints` and stays unlocked until
// the balance can no longer cover one euro, whether by spending or by expiry.
function computeLedger(completions, spends, rules, now = Date.now()) {
  const validMs = rules.validityDays * DAY_MS;
  const events = [
    ...completions.map((c) => ({ t: Date.parse(c.earned_at), earn: c.points })),
    ...spends.map((s) => ({ t: Date.parse(s.spent_at), spend: s.points })),
  ].sort((a, b) => a.t - b.t);

  const lots = []; // { earned, left }, oldest first
  // A spend larger than the live balance (possible after undoing a completion
  // that was already spent) becomes debt that the next points pay off.
  let debt = 0;
  let unlocked = false;

  const balance = () => lots.reduce((sum, l) => sum + l.left, 0) - debt;
  const expireUntil = (t) => {
    while (lots.length && lots[0].earned + validMs <= t) lots.shift();
    // Between events the balance only shrinks, so checking here catches every dip.
    if (balance() < rules.pointsPerEuro) unlocked = false;
  };

  for (const e of events) {
    expireUntil(e.t);
    if (e.earn) {
      const paid = Math.min(debt, e.earn);
      debt -= paid;
      if (e.earn > paid) lots.push({ earned: e.t, left: e.earn - paid });
      if (balance() >= rules.gatePoints) unlocked = true;
    } else {
      let need = e.spend;
      while (need > 0 && lots.length) {
        const take = Math.min(need, lots[0].left);
        lots[0].left -= take;
        need -= take;
        if (lots[0].left === 0) lots.shift();
      }
      debt += need;
      if (balance() < rules.pointsPerEuro) unlocked = false;
    }
  }
  expireUntil(now);

  const soonCutoff = now + 7 * DAY_MS;
  const expiringSoon = lots
    .filter((l) => l.earned + validMs <= soonCutoff)
    .reduce((sum, l) => sum + l.left, 0);

  const points = balance();
  return {
    points,
    unlocked,
    spendableEuros: unlocked ? Math.floor(Math.max(points, 0) / rules.pointsPerEuro) : 0,
    expiringSoon,
    nextExpiry: lots.length ? lots[0].earned + validMs : null,
  };
}

if (typeof module !== "undefined") module.exports = { computeLedger, DAY_MS };
