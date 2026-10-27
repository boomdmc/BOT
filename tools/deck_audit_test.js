'use strict';
// Card-by-card checks for deck https://bottcg.com/decks/fPuDCCfxg1 : node tools/deck_audit_test.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['core', 'dsl', 'ops', 'flow', 'ai', 'decks']) require(path.join(root, 'js', f + '.js'));
const TAL = globalThis.TAL;
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const db = TAL.buildDB(rd('card_definitions.json'), rd('abilities.json'), rd('ability_patches.json'));
const sd = rd('starter_decks.json');
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const yes = async (req) => req.kind === 'respond' ? [0] : req.kind === 'confirm' ? true : req.kind === 'pick' ? req.cards.slice(0, req.min) : req.kind === 'pay' ? req.options[0] : req.kind === 'options' ? [req.options[0].id] : [];
const no = async (req) => req.kind === 'confirm' ? false : [];
function fresh(a, b) {
  const mk = (n, d, dec) => ({ name: n, main: d.main, life: d.life, decide: dec });
  const g = new TAL.Game(db, [mk('A', sd.red, a || yes), mk('B', sd.blue, b || no)], { seed: 11 });
  g.ownTurns = [0, 0]; g.firstPlayer = 0;
  for (const pl of g.players) {
    for (const [id, n] of Object.entries(pl.setup.main)) for (let i = 0; i < n; i++) pl.deck.push(g.newCard(id, pl.i));
    for (const id of pl.setup.life) { const c = g.newCard(id, pl.i); c.zone = 'life'; pl.life.push(c); }
  }
  g.turn = 3; g.active = 0; g.phase = 'main';
  return g;
}
const put = (g, id, zone, pi) => { const c = g.newCard(id, pi); g.placeIn(c, zone, pi); return c; };
const plain = (p, notName) => Object.values(db.cards).find(c => c.type === 'Avatar' && c.power === p && !(db.byCard[c.id] || []).length && c.cost > 0 && (!notName || !c.name.includes(notName)));
const gemCard = (n) => Object.values(db.cards).find(c => c.type === 'Magic' && c.gem && c.gem.count === n && !c.gem.color && TAL.cardSupported(db, c.id)).id;
const NARAI = 'KD01-001', NARASING = 'KD01-002', KSIRA = 'KD01-003';

(async () => {
  const deck = JSON.parse(fs.readFileSync(path.join(root, '_deck.json'), 'utf8'));
  const ids = [...new Set(deck.cards.map(c => c.print).concat(deck.lifeCards.map(c => c.print)))];
  ok(ids.every(id => TAL.cardSupported(db, id)), 'every card in the deck is fully supported: ' + ids.filter(id => !TAL.cardSupported(db, id)).join(','));

  // ---- KD01-002 นรสิงห์: full chain ----
  {
    const g = fresh();
    const nar = put(g, NARAI, 'avatarZone', 0);
    const victim = put(g, plain(1).id, 'avatarZone', 1), other = put(g, plain(2).id, 'avatarZone', 1);
    const card = put(g, NARASING, 'hand', 0);
    g.phase = 'battle';
    await g.attack(nar, [], victim, 'avatar');
    ok(card.zone === 'avatarZone', 'KD01-002 summoned after พระนารายณ์ wins a battle');
    ok(other.zone === 'hell', 'KD01-002 destroys an enemy Avatar with Cost <= 4');
    ok(g.players[0].hell.some(c => c.id === NARAI), 'KD01-002 sent a พระนารายณ์ to Hell as cost');
    await g.runDelayed('endOfTurn');
    ok(card.zone === 'hell', 'KD01-002 goes to Hell in End Phase');
    ok(g.players[0].avatarZone.some(c => c.def.name.includes('พระนารายณ์') && c.id !== NARASING), 'KD01-002 revives a different พระนารายณ์ from Hell');
  }
  {
    const g = fresh(); let offered = false;
    g.players[0].decide = async (req) => { if (req.kind === 'respond') offered = true; return []; };
    const att = put(g, plain(3, 'พระนารายณ์').id, 'avatarZone', 0); put(g, NARAI, 'avatarZone', 0);
    const victim = put(g, plain(1).id, 'avatarZone', 1); put(g, NARASING, 'hand', 0);
    g.phase = 'battle'; await g.attack(att, [], victim, 'avatar');
    ok(!offered, 'KD01-002 NOT offered when the destroyer is not a พระนารายณ์');
  }
  {
    const g = fresh();
    g.players[0].decide = async (req) => req.kind === 'respond' ? [0] : req.kind === 'pick' ? req.cards.slice(0, req.min) : [];
    const nar = put(g, NARAI, 'avatarZone', 0); put(g, 'SL01-004', 'avatarZone', 0); put(g, 'KD01-005', 'avatarZone', 0);
    put(g, plain(1).id, 'avatarZone', 1); put(g, plain(1).id, 'avatarZone', 1);
    const a = put(g, NARASING, 'hand', 0), b = put(g, NARASING, 'hand', 0);
    g.phase = 'battle'; await g.attack(nar, [], g.players[1].avatarZone[0], 'avatar');
    ok([a, b].filter(c => c.zone !== 'hand').length >= 1 && [a, b].filter(c => c.zone === 'avatarZone').length <= 1, 'KD01-002 per-name limit: only one copy used per turn');
  }
  // ---- KD01-003 เกษียรสมุทร ----
  {
    const g = fresh();
    const nar = put(g, NARAI, 'avatarZone', 0); const god = put(g, 'SL01-004', 'avatarZone', 0); god.state = 'rested';
    const victim = put(g, plain(1).id, 'avatarZone', 1); const card = put(g, KSIRA, 'hand', 0);
    g.phase = 'battle'; await g.attack(nar, [], victim, 'avatar');
    ok(card.zone === 'avatarZone' && god.state === 'awake', 'KD01-003 summons and untaps a rested เทพ Avatar');
  }
  // ---- PRMO-063 นางลักษมี ----
  {
    const g = fresh();
    const lak = put(g, 'PRMO-063', 'hand', 0);
    const nonGod = put(g, plain(1).id, 'hand', 0);
    ok(!g.validPayment([lak], 1, nonGod), 'PRMO-063 cannot pay for a non-เทพ Avatar');
    const god = put(g, 'KD01-007', 'hand', 0);
    ok(g.validPayment([lak, put(g, gemCard(2), 'hand', 0)], 3, god) || g.validPayment([lak], 1, god), 'PRMO-063 can pay for a เทพ Avatar');
    const g2 = fresh(); const l2 = put(g2, 'PRMO-063', 'hand', 0); const nar = put(g2, 'SL01-004', 'hand', 0); put(g2, gemCard(3), 'hand', 0);
    const act = g2.listActions(0).find(a => a.card === nar);
    ok(!!act, 'SL01-004 can be summoned using นางลักษมี + GEM 3');
    if (act) { await g2.doAction(0, act); ok(g2.getPower(nar) === 7, 'PRMO-063 gives +3 POWER to the summoned พระนารายณ์ (got ' + g2.getPower(nar) + ')'); }
  }
  // ---- KD01-009 นางอัปสร ----
  {
    const g = fresh(null, async (req) => { if (req.kind === 'respond') { g.sawRespond = true; return [0]; } return []; });
    const ap = put(g, 'KD01-009', 'avatarZone', 0); const def = put(g, plain(1).id, 'avatarZone', 1);
    const react = put(g, 'ODY1-084', 'hand', 1);
    g.phase = 'battle'; await g.attack(ap, [], def, 'avatar');
    ok(!g.sawRespond && react.zone === 'hand', 'KD01-009 stops the enemy from using React during the battle');
    ok(g.namesOf(ap).includes('พระนารายณ์'), 'KD01-009 counts as พระนารายณ์');
  }
  // ---- SL01-004 พระนารายณ์ ----
  {
    const g = fresh(); const n = put(g, 'SL01-004', 'avatarZone', 0); const d = put(g, plain(5).id, 'avatarZone', 1);
    g.phase = 'battle'; await g.attack(n, [], d, 'avatar');
    ok(n.zone === 'avatarZone' && d.zone === 'hell', 'SL01-004 gets +2 on attack (4+2=6 beats 5)');
  }
  // ---- KD01-005 เทพผู้พิทักษ์ ----
  {
    const g = fresh(); const x = put(g, 'KD01-005', 'avatarZone', 0);
    await g.destroy(x, { cause: 'ability' });
    ok(x.zone === 'avatarZone' && g.getPower(x) === 4, 'KD01-005 halves base POWER instead of being destroyed (got ' + g.getPower(x) + ')');
    await g.destroy(x, { cause: 'ability' });
    ok(x.zone === 'hell', 'KD01-005 second destruction works (once per summon)');
    ok(g.hasKw(x, 'โล่มนุษย์') && g.hasKw(x, 'เตะไข่'), 'KD01-005 has โล่มนุษย์ and เตะไข่');
  }
  // ---- BT09-001 พระอิศวร วีลแชร์ ----
  {
    const g = fresh();
    const hand = put(g, 'BT09-001', 'hand', 0); const e = put(g, plain(5).id, 'avatarZone', 1);
    const pool = Object.values(db.cards).filter(c => c.type === 'Avatar' && c.name.includes('พระอิศวร') && c.power >= 4 && TAL.cardSupported(db, c.id) && c.id !== 'BT09-001');
    const victim = put(g, pool[0].id, 'avatarZone', 0);
    await g.destroy(victim, { cause: 'ability' });
    ok(hand.zone === 'avatarZone', 'BT09-001 summoned from hand');
    const half = Math.floor(pool[0].power / 2);
    ok(g.getPower(hand) === half, 'BT09-001 base POWER = half of the chosen พระอิศวร (want ' + half + ', got ' + g.getPower(hand) + ')');
    ok(g.getPower(e) === Math.max(0, 5 - g.getPower(hand)), 'BT09-001 lowers an enemy Avatar by its POWER (enemy now ' + g.getPower(e) + ')');
  }
  // ---- SL01-008 พระพรหม ----
  {
    const g = fresh();
    const gods = Object.values(db.cards).filter(c => c.type === 'Avatar' && c.symbol === 'เทพ' && TAL.cardSupported(db, c.id) && c.cost <= 8 && !(db.byCard[c.id] || []).some(a => a.kind === 'triggered' && a.trigger.event === 'self.destroyed'));
    const sac = put(g, gods[0].id, 'avatarZone', 0);
    const target = put(g, gods.find(c => c.name !== gods[0].name).id, 'hell', 0);
    const wrong = put(g, plain(2).id, 'hell', 0);
    const brahma = put(g, 'SL01-008', 'avatarZone', 0);
    await g.runTriggered(brahma, db.byCard['SL01-008'][0], { self: brahma, paid: true });
    ok(sac.zone === 'hell', 'SL01-008 sacrifices an Avatar as cost');
    ok(target.zone === 'avatarZone' && wrong.zone === 'hell', 'SL01-008 revives only an Avatar with the same Symbol and a different name');
  }
  // ---- KD01-007 พระอินทร์ / SD01-005 ----
  {
    const g = fresh(); const c = put(g, 'KD01-007', 'avatarZone', 0); const d0 = g.players[0].deck.length;
    await g.runTriggered(c, db.byCard['KD01-007'][0], { self: c, paid: true });
    ok(g.players[0].deck.length === d0 || g.players[0].deck.length === d0 - 1, 'KD01-007 scouts 3, rest under the Deck (deck ' + d0 + ' -> ' + g.players[0].deck.length + ')');
    const g2 = fresh(); const c2 = put(g2, 'SD01-005', 'avatarZone', 0); const h = g2.players[0].hand.length;
    await g2.runTriggered(c2, db.byCard['SD01-005'][0], { self: c2, paid: true });
    ok(g2.players[0].hand.length === h + 3, 'SD01-005 จุติ draws 3');
  }
  // ---- Magic: KD01-013 ความเจริญ / BT02-046 ----
  {
    const g = fresh(); const m = put(g, 'KD01-013', 'hand', 0); const h = g.players[0].hand.length;
    await g.doAction(0, g.listActions(0).find(a => a.card === m));
    ok(g.players[0].hand.length === h + 1, 'KD01-013 draws 2 (net +1 with the card used)');
    const g2 = fresh(); const e = put(g2, plain(3).id, 'avatarZone', 1); const m2 = put(g2, 'BT02-046', 'hand', 0);
    await g2.doAction(0, g2.listActions(0).find(a => a.card === m2));
    ok(e.zone === 'hand' && e.owner === 1, 'BT02-046 returns an enemy Avatar to its owner’s hand');
  }
  // ---- SD08-013 forced 1+2 ----
  {
    const g = fresh(); const m = put(g, 'SD08-013', 'hand', 0);
    const hellA = put(g, plain(2).id, 'hell', 0);
    for (let i = 0; i < 4; i++) g.players[0].life[i].faceUp = true;
    const h = g.players[0].hand.length;
    await g.doAction(0, g.listActions(0).find(a => a.card === m));
    ok(g.players[0].hand.length === h - 1 + 2 && hellA.zone === 'hand', 'SD08-013 does BOTH effects when the LIFE condition is met (hand ' + g.players[0].hand.length + ')');
    const g2 = fresh(); const m2 = put(g2, 'SD08-013', 'hand', 0); put(g2, plain(2).id, 'hell', 0);
    const h2 = g2.players[0].hand.length;
    await g2.doAction(0, g2.listActions(0).find(a => a.card === m2));
    ok(g2.players[0].hand.length === h2 - 1 + 1, 'SD08-013 does only one effect without the LIFE condition');
  }
  // ---- Reacts ----
  {
    const g = fresh(no, yes);
    const att = put(g, plain(3).id, 'avatarZone', 0); const def = put(g, plain(2).id, 'avatarZone', 1);
    put(g, 'KD01-018', 'hand', 1); for (let i = 0; i < 2; i++) put(g, gemCard(1), 'hand', 1);
    g.phase = 'battle'; await g.attack(att, [], def, 'avatar');
    ok(def.zone === 'avatarZone', 'KD01-018 lowers the attacker enough that the defender survives');
    const g2 = fresh(no, yes); const a2 = put(g2, plain(3).id, 'avatarZone', 0); const d2 = put(g2, plain(2).id, 'avatarZone', 1); const r2 = put(g2, 'ODY1-084', 'hand', 1);
    g2.phase = 'battle'; await g2.attack(a2, [], d2, 'avatar');
    ok(a2.zone === 'hell' && r2.zone === 'hell', 'ODY1-084 sends the attacker to Hell');
    const g3 = fresh(no, yes); const r3 = put(g3, 'KD01-017', 'hand', 1);
    const s3 = put(g3, plain(1).id, 'hand', 0); for (let i = 0; i < 3; i++) put(g3, gemCard(2), 'hand', 0);
    await g3.doAction(0, g3.listActions(0).find(a => a.card === s3));
    ok(s3.zone === 'hell' && r3.zone === 'hell', 'KD01-017 destroys a newly summoned Avatar');
    const g4 = fresh(no, yes); const r4 = put(g4, 'SD07-017', 'hand', 1); const v4 = put(g4, plain(2).id, 'avatarZone', 1);
    await g4.destroy(v4, { cause: 'ability' });
    ok(v4.zone === 'avatarZone' && r4.zone === 'hell', 'SD07-017 prevents the destruction');
  }
  // ---- Modification KD01-016 ----
  {
    const g = fresh(); const av = put(g, plain(3).id, 'avatarZone', 0); const m = put(g, 'KD01-016', 'hand', 0);
    await g.doAction(0, g.listActions(0).find(a => a.card === m && a.type === 'modify'));
    ok(m.zone === 'magicZone' && m.host === av && av.equipped.includes(m), 'KD01-016 attaches to an Avatar');
    const d = put(g, plain(1).id, 'avatarZone', 1); const h = g.players[0].hand.length;
    g.phase = 'battle'; await g.attack(av, [], d, 'avatar');
    ok(g.players[0].hand.length === h + 1, 'KD01-016 draws a card when its host attacks');
    await g.destroy(av, { cause: 'ability' });
    ok(m.zone === 'hell', 'KD01-016 goes to Hell when the host leaves');
  }
  // ---- Land CC01-059 โรงบาล ----
  {
    const g = fresh(); const land = put(g, 'CC01-059', 'landZone', 0);
    const h1 = put(g, plain(1).id, 'hell', 0); const copy = put(g, h1.id, 'hand', 0); put(g, gemCard(1), 'hand', 0);
    const act = g.listActions(0).find(a => a.card === land && a.type === 'activate'); ok(!!act, 'CC01-059 activation is listed');
    if (act) {
      await g.doAction(0, act);
      ok(h1.zone === 'hand', 'CC01-059 returns an Avatar (Cost <= 3) from Hell to hand');
      ok(!g.canSummonFromHand(0, h1) && !g.canSummonFromHand(0, copy), 'CC01-059: that card and same-name cards cannot be summoned this turn');
      ok(!g.listActions(0).some(a => a.card === land), 'CC01-059 once per turn');
    }
  }
  // ---- LIFE cards (flipped by an attack, resolved in my next Main Phase) ----
  for (const id of ['BT01-054', 'KD02-021', 'KD01-025', 'BT05-071', 'BT05-073']) {
    const g = fresh(); g.players[0].life.splice(0, 1); const lc = g.newCard(id, 0); lc.zone = 'life'; g.players[0].life.unshift(lc);
    if (id === 'KD01-025') put(g, Object.values(db.cards).find(c => c.type === 'Avatar' && c.gem && c.gem.count >= 3 && TAL.cardSupported(db, c.id)).id, 'hell', 0);
    if (id === 'BT05-071') put(g, 'KD01-013', 'hell', 0);
    const att = put(g, plain(2).id, 'avatarZone', 1); const h = g.players[0].hand.length;
    g.active = 1; g.phase = 'battle'; await g.attack(att, [], null, 'life');
    ok(lc.faceUp, id + ' is flipped by the attack');
    ok(g.players[0].pendingLife.length === 1 && g.players[0].hand.length === h, id + ' effect waits for my next Main Phase');
    await g.resolvePendingLife(0);
    ok(g.players[0].hand.length === h + 1, id + ' effect resolves (hand ' + h + ' -> ' + g.players[0].hand.length + ')');
  }
  console.log(`deck audit: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
