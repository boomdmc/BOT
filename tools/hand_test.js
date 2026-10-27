'use strict';
// Cards activated from hand: node tools/hand_test.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['core', 'dsl', 'ops', 'flow', 'ai', 'decks']) require(path.join(root, 'js', f + '.js'));
const TAL = globalThis.TAL;
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const db = TAL.buildDB(rd('card_definitions.json'), rd('abilities.json'), rd('ability_patches.json'));
const sd = rd('starter_decks.json');
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
function fresh(a, b) {
  const mk = (n, d, dec) => ({ name: n, main: d.main, life: d.life, decide: dec });
  const g = new TAL.Game(db, [mk('A', sd.red, a), mk('B', sd.blue, b)], { seed: 9 });
  g.ownTurns = [0, 0]; g.firstPlayer = 0;
  for (const pl of g.players) {
    for (const [id, n] of Object.entries(pl.setup.main)) for (let i = 0; i < n; i++) pl.deck.push(g.newCard(id, pl.i));
    for (const id of pl.setup.life) { const c = g.newCard(id, pl.i); c.zone = 'life'; pl.life.push(c); }
  }
  g.turn = 3; g.active = 0; g.phase = 'main';
  return g;
}
const put = (g, id, zone, pi) => { const c = g.newCard(id, pi); g.placeIn(c, zone, pi); return c; };
const avatarWhere = (pred) => Object.values(db.cards).find(c => c.type === 'Avatar' && TAL.cardSupported(db, c.id) && pred(c) && c.power != null);
const gemCard = (n) => Object.values(db.cards).find(c => c.type === 'Magic' && c.gem && c.gem.count === n && !c.gem.color && TAL.cardSupported(db, c.id)).id;
const word = (name, w) => name.includes(w);
const yes = async (req) => req.kind === 'respond' ? [0] : req.kind === 'confirm' ? true : req.kind === 'pick' ? req.cards.slice(0, req.min) : req.kind === 'pay' ? req.options[0] : [];
const no = async (req) => req.kind === 'confirm' ? false : [];

(async () => {
  for (const id of ['BT09-001', 'BT08-037', 'BT07-041', 'BT05-023', 'SD09-001', 'BT10-006', 'BT05-018', 'KD02-001']) ok(TAL.cardSupported(db, id), id + ' supported');

  // 1) BT09-001: when Avatar "พระอิศวร" is destroyed, summon from hand
  {
    const g = fresh(yes, no);
    const victim = put(g, avatarWhere(c => word(c.name, 'พระอิศวร') && c.id !== 'BT09-001').id, 'avatarZone', 0);
    const hand = put(g, 'BT09-001', 'hand', 0);
    await g.destroy(victim, { cause: 'ability' });
    ok(hand.zone === 'avatarZone', 'BT09-001 summoned from hand after พระอิศวร destroyed');
  }
  // 2) not offered for a non-matching Avatar
  {
    let offered = false;
    const g = fresh(async (req) => { if (req.kind === 'respond') offered = true; return []; }, no);
    const other = put(g, avatarWhere(c => !word(c.name, 'พระอิศวร') && !word(c.name, 'จ๊กก๊ก')).id, 'avatarZone', 0);
    put(g, 'BT09-001', 'hand', 0);
    await g.destroy(other, { cause: 'ability' });
    ok(!offered, 'BT09-001 not offered when a different Avatar is destroyed');
  }
  // 3) BT08-037: when "จ๊กก๊ก" Avatar destroyed -> summon from hand by paying Cost
  {
    const g = fresh(yes, no);
    const victim = put(g, avatarWhere(c => word(c.name, 'จ๊กก๊ก') && c.id !== 'BT08-037').id, 'avatarZone', 0);
    const hand = put(g, 'BT08-037', 'hand', 0);
    const cost = g.effectiveCost(hand);
    let offered0 = false; g.players[0].decide = async (req) => { if (req.kind === 'respond') offered0 = true; return []; };
    await g.destroy(victim, { cause: 'ability' });
    ok(cost === 0 || !offered0, 'BT08-037 not offered if Cost cannot be paid');
    if (cost > 0) {
      const g2 = fresh(yes, no);
      const v2 = put(g2, avatarWhere(c => word(c.name, 'จ๊กก๊ก') && c.id !== 'BT08-037').id, 'avatarZone', 0);
      const h2 = put(g2, 'BT08-037', 'hand', 0);
      const gems = []; for (let i = 0; i < 6; i++) gems.push(put(g2, gemCard(2), 'hand', 0));
      await g2.destroy(v2, { cause: 'ability' });
      ok(h2.zone === 'avatarZone', 'BT08-037 summoned after paying Cost');
      ok(gems.filter(x => x.zone === 'hell').length >= 1, 'paid Cost cards went to Hell');
    }
  }
  // 4) BT07-041: discard 1 -> summon + prevent destruction of an animal Avatar
  {
    const g = fresh(yes, no);
    const animal = put(g, avatarWhere(c => c.symbol === 'สัตว์' && c.id !== 'BT07-041').id, 'avatarZone', 0);
    const kabu = put(g, 'BT07-041', 'hand', 0); const fodder = put(g, gemCard(1), 'hand', 0);
    await g.destroy(animal, { cause: 'ability' });
    ok(animal.zone === 'avatarZone' && kabu.zone === 'avatarZone' && fodder.zone === 'hell', 'BT07-041 discards 1, summons itself, saves the animal Avatar');
    const g2 = fresh(yes, no); const a2 = put(g2, avatarWhere(c => c.symbol === 'สัตว์' && c.id !== 'BT07-041').id, 'avatarZone', 0);
    const k2 = put(g2, 'BT07-041', 'hand', 0);
    await g2.destroy(a2, { cause: 'ability' });
    ok(k2.zone === 'hand' && a2.zone === 'hell', 'BT07-041 not usable without another card to discard');
  }
  // 5) Main-phase hand activation SD09-001: destroy 2 วานร as Cost
  {
    const g = fresh(yes, no);
    const card = put(g, 'SD09-001', 'hand', 0);
    ok(!g.listActions(0).some(a => a.card === card && a.type === 'activate'), 'SD09-001 not listed without two วานร');
    const pool = Object.values(db.cards).filter(c => c.type === 'Avatar' && word(c.name, 'วานร') && c.id !== 'SD09-001' && c.id !== 'SD09-002' && TAL.cardSupported(db, c.id) && c.power != null);
    const monkeys = [put(g, pool[0].id, 'avatarZone', 0), put(g, pool[1].id, 'avatarZone', 0)];
    const act = g.listActions(0).find(a => a.card === card && a.type === 'activate');
    ok(!!act, 'SD09-001 listed with two วานร');
    if (act) { await g.doAction(0, act); ok(card.zone === 'avatarZone' && monkeys.every(m => m.zone === 'hell'), 'SD09-001 destroys 2 วานร then summons from hand'); }
  }
  // 6) BT05-018 needs "เจค นักฆ่ามือเก๋า" on the field
  {
    const g = fresh(yes, no); const c = put(g, 'BT05-018', 'hand', 0);
    ok(!g.listActions(0).some(a => a.card === c && a.type === 'activate'), 'BT05-018 hidden without เจค');
    put(g, avatarWhere(c2 => c2.name.includes('เจค นักฆ่ามือเก๋า')).id, 'avatarZone', 0);
    ok(g.listActions(0).some(a => a.card === c && a.type === 'activate'), 'BT05-018 listed with เจค on the field');
  }
  // 7) BT05-023: when enemy declares attack -> summon by paying Cost (its own text then redirects the attack to it)
  {
    const g = fresh(yes, yes); g.active = 1; g.phase = 'battle';
    const hall = put(g, 'BT05-023', 'hand', 0);
    const gems = []; for (let i = 0; i < 4; i++) gems.push(put(g, gemCard(2), 'hand', 0));
    const att = put(g, avatarWhere(c => c.power === 3 && !c.name.includes('ฮอล')).id, 'avatarZone', 1);
    put(g, avatarWhere(c => c.power === 2).id, 'avatarZone', 0);
    await g.attack(att, [], g.players[0].avatarZone[0], 'avatar');
    ok(g.logs.some(l => l.includes('อัญเชิญ นักรบ ฮอล')), 'BT05-023 summoned from hand in response to attack');
    ok(gems.filter(x => x.zone === 'hell').length >= 2, 'BT05-023 paid its Cost with hand cards');
  }
  // 8) turn:any Main-phase activation (BT10-006) is offered to the other player at the end of Main
  {
    let offeredTo = null;
    const g = fresh(async () => [], async (req) => { if (req.kind === 'respond') offeredTo = 1; return []; });
    const nin = avatarWhere(c => word(c.name, 'นินจา') && !c.name.includes('ชิโยเมะ'));
    put(g, nin.id, 'avatarZone', 1); put(g, 'BT10-006', 'hand', 1);
    await g.event('phase.end', { phase: 'main', actor: 0 });
    ok(offeredTo === 1, 'BT10-006 (Main Phase, any player) offered to opponent of turn owner');
  }
  console.log(`hand-activation checks: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
