'use strict';
// React Magic checks: node tools/react_test.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['core', 'dsl', 'ops', 'flow', 'ai', 'decks']) require(path.join(root, 'js', f + '.js'));
const TAL = globalThis.TAL;
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const db = TAL.buildDB(rd('card_definitions.json'), rd('abilities.json'), rd('ability_patches.json'));
const sd = rd('starter_decks.json');
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
function fresh(deciders) {
  const mk = (n, d, dec) => ({ name: n, main: d.main, life: d.life, decide: dec });
  const g = new TAL.Game(db, [mk('A', sd.red, deciders[0]), mk('B', sd.blue, deciders[1])], { seed: 3 });
  g.ownTurns = [0, 0]; g.firstPlayer = 0;
  for (const pl of g.players) {
    for (const [id, n] of Object.entries(pl.setup.main)) for (let i = 0; i < n; i++) pl.deck.push(g.newCard(id, pl.i));
    for (const id of pl.setup.life) { const c = g.newCard(id, pl.i); c.zone = 'life'; pl.life.push(c); }
  }
  g.turn = 3; g.active = 0; g.phase = 'battle';
  return g;
}
const put = (g, id, zone, pi) => { const c = g.newCard(id, pi); g.placeIn(c, zone, pi); return c; };
const avatar = (p) => Object.values(db.cards).find(c => c.type === 'Avatar' && c.power === p && !(db.byCard[c.id] || []).length && c.cost > 0).id;

(async () => {
  // BT01-039: when enemy declares attack -> send attacker to Hell
  for (const id of ['BT01-039', 'BT01-040']) ok(TAL.cardSupported(db, id), id + ' supported');
  {
    let offered = null, order = [];
    const dec = (pi) => async (req) => {
      if (req.kind === 'respond') { order.push(pi); offered = req.options.map(o => o.label); return [0]; }
      return [];
    };
    const g = fresh([dec(0), dec(1)]);
    const att = put(g, avatar(3), 'avatarZone', 0); put(g, avatar(2), 'avatarZone', 1);
    const react = put(g, 'BT01-039', 'hand', 1);
    await g.attack(att, [], g.players[1].avatarZone[0], 'avatar');
    ok(offered && offered.length === 1, 'React offered to defender on attack declaration');
    ok(order[0] === 1, 'opponent of turn owner gets priority first');
    ok(att.zone === 'hell', 'React sent attacker to Hell');
    ok(react.zone === 'hell', 'React card goes to Hell after resolving');
    ok(g.magicUsed.React === true, 'React quota consumed');
    ok(g.players[1].avatarZone.length === 1 && g.players[1].avatarZone[0].zone === 'avatarZone', 'defender avatar untouched');
  }
  // declining the react
  {
    const g = fresh([async () => [], async (req) => req.kind === 'respond' ? [] : []]);
    const att = put(g, avatar(3), 'avatarZone', 0); const d = put(g, avatar(2), 'avatarZone', 1);
    const react = put(g, 'BT01-039', 'hand', 1);
    await g.attack(att, [], d, 'avatar');
    ok(react.zone === 'hand' && d.zone === 'hell' && att.zone === 'avatarZone', 'declined React stays in hand, battle proceeds');
  }
  // quota: React already used this turn -> not offered
  {
    let called = false;
    const g = fresh([async () => [], async (req) => { if (req.kind === 'respond') called = true; return []; }]);
    g.magicUsed.React = true;
    const att = put(g, avatar(3), 'avatarZone', 0); const d = put(g, avatar(2), 'avatarZone', 1);
    put(g, 'BT01-039', 'hand', 1);
    await g.attack(att, [], d, 'avatar');
    ok(!called, 'React not offered when React quota already used this turn');
  }
  // BT01-040: prevent destruction of an Avatar that would be destroyed (in battle)
  {
    const g = fresh([async () => [], async (req) => req.kind === 'respond' ? [0] : []]);
    const att = put(g, avatar(3), 'avatarZone', 0); const d = put(g, avatar(2), 'avatarZone', 1);
    const react = put(g, 'BT01-040', 'hand', 1);
    await g.attack(att, [], d, 'avatar');
    ok(d.zone === 'avatarZone', 'prevent-destroy React keeps Avatar alive');
    ok(react.zone === 'hell', 'prevent-destroy React card used up');
  }
  // React usable on the opponent's turn only for React type (Normal magic never offered)
  {
    let normalOffered = false;
    const g = fresh([async () => [], async (req) => { if (req.kind === 'respond' && req.options.some(o => db.cards[g.uidMap[o.card].id].magicType === 'Normal')) normalOffered = true; return []; }]);
    const att = put(g, avatar(3), 'avatarZone', 0); const d = put(g, avatar(2), 'avatarZone', 1);
    for (const c of Object.values(db.cards)) if (c.type === 'Magic' && c.magicType === 'Normal' && TAL.cardSupported(db, c.id)) { put(g, c.id, 'hand', 1); break; }
    await g.attack(att, [], d, 'avatar');
    ok(!normalOffered, 'Normal Magic is not offered as a response');
  }
  // ---- counter-React: อย่าให้มีครั้งที่ 2 ----
  {
    const COUNTER = 'BT05-058';
    ok(TAL.cardSupported(db, COUNTER), 'counter card supported');
    // 1) negates opponent's React; negated React still goes to Hell and counts toward quota
    {
      const g = fresh([async (req) => req.kind === 'respond' ? [0] : [], async (req) => req.kind === 'respond' ? [0] : []]);
      g.active = 1; g.phase = 'main';                      // B's turn: B uses React 039-style effect? use BT01-039 needs attack; use prevent card via direct use
      const att = put(g, avatar(3), 'avatarZone', 1); const def = put(g, avatar(2), 'avatarZone', 0);
      const r1 = put(g, 'BT01-039', 'hand', 0);             // A (defender) reacts to B's attack
      const counter = put(g, COUNTER, 'hand', 1);           // B counters A's React
      await g.attack(att, [], def, 'avatar');
      ok(counter.zone === 'hell', 'counter card used');
      ok(r1.zone === 'hell', 'negated React goes to Hell');
      ok(att.zone === 'avatarZone' || att.zone === 'hell' && false, 'negated React had no effect on attacker (attacker survives the React)');
      ok(g.magicUsed.React === true, 'negated React still counts toward the React quota (CAN-02)');
    }
    // 2) counter usable even after React quota already used this turn
    {
      let offered = false;
      const g = fresh([async (req) => req.kind === 'respond' ? [0] : [], async (req) => { if (req.kind === 'respond') { offered = true; return [0]; } return []; }]);
      g.active = 1; g.phase = 'main';
      const att = put(g, avatar(3), 'avatarZone', 1); const def = put(g, avatar(2), 'avatarZone', 0);
      put(g, 'BT01-039', 'hand', 0); const counter = put(g, COUNTER, 'hand', 1);
      g.magicUsed.React = true;                              // a React was already used this turn
      ok(g.quotaAvailable(1, counter), 'counter ignores spent React quota');
      ok(!g.quotaAvailable(0, g.players[0].hand[0]), 'ordinary React blocked by spent quota');
    }
    // 3) counter is NOT offered against a non-React magic
    {
      let offered = false;
      const g = fresh([async (req) => req.kind === 'respond' ? [0] : [], async (req) => { if (req.kind === 'respond') offered = true; return []; }]);
      g.active = 0; g.phase = 'main';
      const m = Object.values(db.cards).find(c => c.type === 'Magic' && c.magicType === 'Normal' && TAL.cardSupported(db, c.id) && (db.byCard[c.id] || []).some(a => a.kind === 'spell' && g.feasible(a.effects, { src: { ctrl: 0 }, controller: 0, chosen: {}, vars: {}, trigger: {} })) );
      put(g, avatar(3), 'avatarZone', 0); put(g, avatar(2), 'avatarZone', 1);
      put(g, COUNTER, 'hand', 1);
      const normal = put(g, 'BT01-035', 'hand', 0);          // ธรณีสูบ both players: always feasible Normal Magic
      const ab = db.byCard['BT01-035'][0];
      await g.useAbility(0, normal, ab, {});
      ok(!offered, 'counter-React not offered against Normal Magic');
    }
    // 4) counter works on own turn too (opponent reacts, we counter)
    {
      const g = fresh([async (req) => req.kind === 'respond' ? [0] : [], async (req) => req.kind === 'respond' ? [0] : []]);
      g.active = 0;
      const att = put(g, avatar(3), 'avatarZone', 0); const def = put(g, avatar(2), 'avatarZone', 1);
      const r1 = put(g, 'BT01-039', 'hand', 1); const counter = put(g, COUNTER, 'hand', 0);
      await g.attack(att, [], def, 'avatar');
      ok(r1.zone === 'hell' && counter.zone === 'hell' && att.zone === 'avatarZone', 'turn owner can counter defender React: attacker survives');
      ok(def.zone === 'hell', 'after counter, battle resolves normally (defender loses)');
    }
  }
  // ---- ชายจากอนาคต (BT01-041): cancels any Magic when used ----
  {
    const FUTURE = 'BT01-041', MILL = 'BT01-035', COUNTER = 'BT05-058';
    ok(TAL.cardSupported(db, FUTURE), 'ชายจากอนาคต supported');
    const run = async (opts) => {
      const g = fresh([async (req) => req.kind === 'respond' ? opts.a(req) : [], async (req) => req.kind === 'respond' ? opts.b(req) : []]);
      g.active = 0; g.phase = 'main';
      const m = put(g, MILL, 'hand', 0);
      const f = opts.future ? put(g, FUTURE, 'hand', 1) : null;
      const c = opts.counter ? put(g, COUNTER, 'hand', 0) : null;
      const d0 = g.players[0].deck.length, d1 = g.players[1].deck.length;
      await g.useAbility(0, m, db.byCard[MILL][0], {});
      return { g, m, f, c, milled: (d0 - g.players[0].deck.length) + (d1 - g.players[1].deck.length) };
    };
    // 1) opponent cancels my Normal Magic: no effect, card in Hell, quota still spent
    let r = await run({ future: true, a: () => [], b: (req) => [0] });
    ok(r.milled === 0, 'cancelled Normal Magic has no effect');
    ok(r.m.zone === 'hell' && r.f.zone === 'hell', 'both Magic cards end in Hell');
    ok(r.g.magicUsed.Normal === true && r.g.magicUsed.React === true, 'cancelled Magic still counts toward quota');
    // 2) not used -> Magic resolves
    r = await run({ future: true, a: () => [], b: () => [] });
    ok(r.milled === 6 && r.f.zone === 'hand', 'declined: Magic resolves, future stays in hand');
    // 3) chain: B cancels with ชายจากอนาคต, A counters with อย่าให้มีครั้งที่ 2 -> original Magic resolves (LIFO)
    r = await run({ future: true, counter: true, a: () => [0], b: () => [0] });
    ok(r.f.zone === 'hell' && r.c.zone === 'hell', 'chain: both React cards used');
    ok(r.milled === 6, 'chain: counter cancels ชายจากอนาคต so original Magic resolves');
    // 4) Land magic can be cancelled too
    {
      const g = fresh([async () => [], async (req) => req.kind === 'respond' ? [0] : []]);
      g.active = 0; g.phase = 'main';
      const land = Object.values(db.cards).find(c => c.type === 'Magic' && c.magicType === 'Land' && TAL.cardSupported(db, c.id));
      const lc = put(g, land.id, 'hand', 0); const f = put(g, FUTURE, 'hand', 1);
      await g.playLandCard(0, lc);
      ok(lc.zone === 'hell' && g.land.length === 0 && f.zone === 'hell', 'cancelled Land Magic goes to Hell, Land Zone stays empty');
    }
    // 5) second ชายจากอนาคต same turn blocked by React quota
    {
      const g = fresh([async () => [], async () => []]);
      const f1 = put(g, FUTURE, 'hand', 1), f2 = put(g, FUTURE, 'hand', 1);
      ok(g.quotaAvailable(1, f1), 'first React available');
      g.consumeQuota(1, f1);
      ok(!g.quotaAvailable(1, f2), 'second React blocked after quota spent');
    }
  }
  console.log(`react checks: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
