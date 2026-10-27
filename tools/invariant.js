'use strict';
// Looks for "lost" cards: every card must be in exactly one zone container at every decision point.
// node tools/invariant.js [games]
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['core', 'dsl', 'ops', 'flow', 'ai', 'decks']) require(path.join(root, 'js', f + '.js'));
const TAL = globalThis.TAL;
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const db = TAL.buildDB(rd('card_definitions.json'), rd('abilities.json'), rd('ability_patches.json'));
const Z = ['deck', 'hand', 'hell', 'dark', 'life', 'avatarZone', 'magicZone', 'constructZone'];
function where(g, c) {
  const out = [];
  for (const p of g.players) for (const z of Z) if (p[z].includes(c)) out.push(z);
  if (g.land.includes(c)) out.push('landZone');
  return out;
}
function check(g) {
  const bad = [];
  for (const c of Object.values(g.uidMap)) {
    const w = where(g, c);
    if (c.isToken) { if (w.length > 1) bad.push([c, w]); continue; }
    if (w.length !== 1 || w[0] !== c.zone) bad.push([c, w]);
  }
  return bad;
}
const N = parseInt(process.argv[2] || '1000', 10);
const sd = rd('starter_decks.json'); const bd = rd('bot_decks.json');
const decks = Object.values(sd).concat(bd).map(d => TAL.adaptDeck(db, d, TAL.mulberry32(3)));
const found = {};
(async () => {
  for (let i = 0; i < N; i++) {
    const a = decks[i % decks.length], b = decks[(i * 5 + 1) % decks.length];
    const g = new TAL.Game(db, [{ name: 'A', main: a.main, life: a.life, decide: TAL.makeAI(0) }, { name: 'B', main: b.main, life: b.life, decide: TAL.makeAI(1) }], { seed: 777 + i });
    const ask = g.ask.bind(g); let last = '';
    g.ask = async (pi, req) => {
      const bad = (req.kind === 'action' || req.kind === 'attack') ? check(g) : [];
      if (bad.length) {
        const [c, w] = bad[0]; const key = c.def.name + ' zone=' + c.zone + ' in=' + w.join('|');
        if (!found[key]) { found[key] = { game: i, turn: g.turn, phase: g.phase, log: g.logs.slice(-6) }; }
      }
      return ask(pi, req);
    };
    try { await g.run(); } catch (e) { /* ignore */ }
  }
  const keys = Object.keys(found);
  console.log('games', N, 'distinct anomalies', keys.length);
  for (const k of keys.slice(0, 8)) { console.log('-', k, '| game', found[k].game, 'turn', found[k].turn, found[k].phase); console.log('   ' + found[k].log.join('\n   ')); }
})();
