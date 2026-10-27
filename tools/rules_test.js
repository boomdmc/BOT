'use strict';
// Rule checks against RULES_SPEC.md: node tools/rules_test.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['core', 'dsl', 'ops', 'flow', 'ai', 'decks']) require(path.join(root, 'js', f + '.js'));
const TAL = globalThis.TAL;
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const db = TAL.buildDB(rd('card_definitions.json'), rd('abilities.json'), rd('ability_patches.json'));
const sd = rd('starter_decks.json');
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('FAIL:', name); } };

const plain = (type, pred) => Object.values(db.cards).filter(c => c.type === type && !(db.byCard[c.id] || []).length && pred(c));
const avatarsNoText = plain('Avatar', c => c.cost > 0 && !c.flags.isToken && c.power != null);
const byPower = (p) => avatarsNoText.find(c => c.power === p);

function fresh(seed) {
  const a = sd.red, b = sd.blue;
  const mk = (n, d) => ({ name: n, main: d.main, life: d.life, decide: async (req) => req.kind === 'confirm' ? false : [] });
  const g = new TAL.Game(db, [mk('A', a), mk('B', b)], { seed: seed || 1 });
  g.ownTurns = [0, 0]; g.firstPlayer = 0;
  // build decks
  for (const pl of g.players) {
    for (const [id, n] of Object.entries(pl.setup.main)) for (let i = 0; i < n; i++) { const c = g.newCard(id, pl.i); pl.deck.push(c); }
    for (const id of pl.setup.life) { const c = g.newCard(id, pl.i); c.zone = 'life'; pl.life.push(c); }
  }
  g.turn = 1; g.active = 0; g.phase = 'main';
  return g;
}
const put = (g, id, zone, pi) => { const c = g.newCard(id, pi); g.placeIn(c, zone, pi); return c; };
const clearHand = (g, pi) => { for (const c of g.players[pi].hand.splice(0)) { c.zone = 'limbo'; } };

(async () => {
  // ---- payment ----
  {
    const g = fresh(); const av = put(g, avatarsNoText.find(c => c.cost === 4).id, 'hand', 0);
    const gem = (n) => Object.values(db.cards).find(c => c.gem && c.gem.count === n && !c.gem.color && c.type === 'Magic').id;
    const c4 = put(g, gem(4) || gem(3), 'hand', 0), c1 = put(g, gem(1), 'hand', 0), c3 = put(g, gem(3), 'hand', 0), c2 = put(g, gem(2), 'hand', 0);
    ok(g.validPayment([c3, c2], 4, av), 'GEM 3+2 pays cost 4');
    if (g.gemOf(c4) === 4) ok(!g.validPayment([c4, c1], 4, av), 'GEM 4+1 cannot pay cost 4 (excess)');
    ok(!g.validPayment([c1], 4, av), 'GEM 1 cannot pay cost 4');
    ok(g.validPayment([], 0, av), 'cost 0 needs no cards');
    ok(!g.validPayment([c3, c2, c1], 4, av), '3+2+1 has removable excess');
  }
  // ---- avatar zone limits ----
  {
    const g = fresh();
    const A = avatarsNoText;
    for (let i = 0; i < 4; i++) put(g, A[i].id, 'avatarZone', 0);
    ok(!g.avatarRoom(0, g.newCard(A[5].id, 0)), 'max 4 Avatars');
    ok(g.avatarRoom(0, g.newToken({ name: 't', power: 1 }, 0)), 'token fits 5th slot');
    g.placeIn(g.newToken({ name: 't', power: 1 }, 0), 'avatarZone', 0); g.placeIn(g.newToken({ name: 't', power: 1 }, 0), 'avatarZone', 0);
    ok(!g.avatarRoom(0, g.newToken({ name: 't', power: 1 }, 0)), 'max 6 Avatar+Token');
  }
  // ---- battle results ----
  async function duel(pa, pb, setup) {
    const g = fresh();
    const A = put(g, avatarsNoText.find(c => c.power === pa).id, 'avatarZone', 0);
    const B = put(g, avatarsNoText.find(c => c.power === pb).id, 'avatarZone', 1);
    if (setup) setup(g, A, B);
    g.phase = 'battle';
    await g.attack(A, [], B, 'avatar');
    return { g, A, B };
  }
  {
    let r = await duel(3, 2); ok(r.A.zone === 'avatarZone' && r.B.zone === 'hell', 'higher power wins');
    r = await duel(2, 3); ok(r.A.zone === 'hell' && r.B.zone === 'avatarZone', 'lower power attacker loses');
    r = await duel(3, 3); ok(r.A.zone === 'hell' && r.B.zone === 'hell', 'equal power: both destroyed');
    if (avatarsNoText.some(c => c.power === 0)) { r = await duel(0, 0); ok(r.A.zone === 'avatarZone' && r.B.zone === 'avatarZone', 'power 0 vs 0: nothing happens'); }
    r = await duel(3, 2); ok(r.A.state === 'rested', 'attacker becomes rested');
  }
  // ---- life attack ----
  {
    const g = fresh();
    const A = put(g, byPower(3).id, 'avatarZone', 0);
    let t = g.attackTargets(A);
    ok(t.length === 1 && t[0].kind === 'life', 'empty Avatar Zone allows LIFE attack');
    const B = put(g, byPower(2).id, 'avatarZone', 1);
    t = g.attackTargets(A);
    ok(!t.some(x => x.kind === 'life'), 'LIFE not attackable while enemy has Avatar');
    g.players[1].avatarZone.splice(0); B.zone = 'limbo';
    await g.attack(A, [], null, 'life');
    ok(g.players[1].life.filter(c => c.faceUp).length === 1, 'LIFE attack damages exactly 1');
    ok(g.players[1].life[0].faceUp, 'top LIFE card first');
    // critical -> loss
    for (const c of g.players[1].life) c.faceUp = true;
    A.state = 'awake';
    let lost = false; try { await g.attack(A, [], null, 'life'); } catch (e) { lost = e === TAL.GAME_OVER; }
    ok(lost && g.over && g.over.winner === 0, 'successful LIFE hit while critical = loss');
  }
  // ---- magic quota ----
  {
    const g = fresh();
    const m = Object.values(db.cards).find(c => c.type === 'Magic' && c.magicType === 'Normal' && TAL.cardSupported(db, c.id));
    const c1 = put(g, m.id, 'hand', 0);
    ok(g.quotaAvailable(0, c1), 'Normal quota available');
    g.consumeQuota(0, c1);
    ok(!g.quotaAvailable(1, put(g, m.id, 'hand', 1)), 'Normal quota shared with opponent after use');
    g.magicUsed = {};
    ok(g.quotaAvailable(0, c1), 'quota resets next turn');
  }
  // ---- construct limits ----
  {
    const g = fresh();
    const cons = Object.values(db.cards).filter(c => c.type === 'Construct' && TAL.cardSupported(db, c.id));
    for (let i = 0; i < 3; i++) put(g, cons[i].id, 'constructZone', 0);
    const extra = put(g, cons[3].id, 'hand', 0);
    ok(!(await g.buildCard(0, extra, { free: true })), 'max 3 Constructs');
    const g2 = fresh(); put(g2, cons[0].id, 'constructZone', 0);
    ok(!(await g2.buildCard(0, put(g2, cons[0].id, 'hand', 0), { free: true })), 'Construct names must be unique');
  }
  // ---- turn structure ----
  {
    const g = fresh();
    const phases = [];
    const orig = g.event.bind(g); g.event = async (n, e) => { if (n === 'phase.start') phases.push(e.phase); return orig(n, e); };
    g.players[0].setup.main = g.players[0].setup.main;
    for (const pl of g.players) { while (pl.hand.length < 5) { const c = pl.deck.shift(); c.zone = 'hand'; pl.hand.push(c); } }
    g.turn = 0; await g.playTurn();
    ok(phases.join() === 'draw,main,end', 'first turn skips Battle Phase: ' + phases.join());
    ok(g.players[0].hand.length >= 5, 'first-turn draw happened');
    phases.length = 0; await g.playTurn();
    ok(phases.join() === 'draw,main,battle,end', 'later turns have all 4 phases');
  }
  {
    const g = fresh();
    g.turn = 1; g.active = 1;
    clearHand(g, 0); g.turn = 2;
    const before = g.players[0].hand.length;
    await g.draw(0, 3 - before);
    ok(g.players[0].hand.length === 3, 'hand<3 draws up to 3');
  }
  // ---- end phase hand limit ----
  {
    const g = fresh();
    for (const pl of g.players) for (let i = 0; i < 5; i++) { const c = pl.deck.shift(); c.zone = 'hand'; pl.hand.push(c); }
    for (let i = 0; i < 6; i++) { const c = g.players[0].deck.shift(); c.zone = 'hand'; g.players[0].hand.push(c); }
    g.players[0].decide = async (req) => req.kind === 'pick' ? req.cards.slice(0, req.min) : req.kind === 'action' ? [req.actions.find(a => a.type === 'endPhase').id] : [];
    g.players[1].decide = g.players[0].decide;
    g.turn = 2; g.firstPlayer = 0; // turn 3 -> player 0
    g.turn = 2;
    await g.playTurn();
    ok(g.players[0].hand.length <= 7, 'hand limited to 7 at End Phase, got ' + g.players[0].hand.length);
  }
  // ---- deck out ----
  {
    const g = fresh();
    g.players[1].deck.splice(1);
    let over = false; try { await g.draw(1, 2); } catch (e) { over = e === TAL.GAME_OVER; }
    ok(over && g.over.winner === 0, 'empty Deck = loss');
  }
  // ---- deck validation ----
  {
    for (const [k, v] of Object.entries(sd)) ok(TAL.validateDeck(db, { main: v.main, life: v.life }).length === 0, 'starter deck valid: ' + k + ' ' + TAL.validateDeck(db, { main: v.main, life: v.life }).join(';'));
  }
  console.log(`rule checks: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
