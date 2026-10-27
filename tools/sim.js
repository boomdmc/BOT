'use strict';
// AI vs AI simulation harness: node tools/sim.js [games] [--verbose] [--log] [--decks]
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['core', 'dsl', 'ops', 'flow', 'ai', 'decks']) require(path.join(root, 'js', f + '.js'));
const TAL = globalThis.TAL;
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const db = TAL.buildDB(rd('card_definitions.json'), rd('abilities.json'), rd('ability_patches.json'));

function deckOk(d) {
  const ids = Object.keys(d.main).concat(d.life || []);
  return ids.every(id => db.cards[id] && TAL.cardSupported(db, id));
}
const decks = [];
const sd = rd('starter_decks.json');
for (const [k, v] of Object.entries(sd)) decks.push({ name: 'SD-' + k, main: v.main, life: v.life });
for (const b of rd('bot_decks.json')) decks.push({ name: (b.name || '').slice(0, 24), main: b.main, life: b.life });
const rng = TAL.mulberry32(7);
const usable = decks.map(d => { const a = TAL.adaptDeck(db, d, rng); return { name: d.name, main: a.main, life: a.life, replaced: a.replaced.length }; });
for (const d of usable) { const e = TAL.validateDeck(db, d); if (e.length) console.log('deck problem', d.name, e.join('; ')); }
console.log('decks usable', usable.length, '/', decks.length, '| supported cards', Object.keys(db.cards).filter(id => TAL.cardSupported(db, id)).length, '/', Object.keys(db.cards).length);
if (process.argv.includes('--decks')) {
  for (const d of decks) {
    const ids = Object.keys(d.main).concat(d.life || []);
    const bad = ids.filter(id => !TAL.cardSupported(db, id));
    console.log(d.name, 'main', Object.values(d.main).reduce((a, b) => a + b, 0), 'life', (d.life || []).length, 'bad', bad.length);
  }
}

function randomDeck(r) {
  const sup = Object.values(db.cards).filter(c => TAL.cardSupported(db, c.id) && !c.flags.lamiang && !c.flags.isToken);
  const norm = sup.filter(c => c.type !== 'LIFE' && !c.flags.onlyOne), ones = sup.filter(c => c.flags.onlyOne && c.type !== 'LIFE'), lifes = sup.filter(c => c.type === 'LIFE');
  const main = {}; let n = 0; const names = {};
  const one = ones[Math.floor(r() * ones.length)]; main[one.id] = 1; n = 1; names[one.name] = 1;
  while (n < 50) { const c = norm[Math.floor(r() * norm.length)]; if ((names[c.name] || 0) >= 4) continue; main[c.id] = (main[c.id] || 0) + 1; names[c.name] = (names[c.name] || 0) + 1; n++; }
  const life = []; const ln = new Set();
  while (life.length < 5) { const c = lifes[Math.floor(r() * lifes.length)]; if (ln.has(c.name)) continue; ln.add(c.name); life.push(c.id); }
  return { name: 'random', main, life };
}
const fired = new Set();
for (const fn of ['runTriggered', 'useAbility']) { const o = TAL.Game.prototype[fn]; TAL.Game.prototype[fn] = function (...a) { const ab = fn === 'runTriggered' ? a[1] : a[2]; if (ab && ab.id) fired.add(ab.id); return o.apply(this, a); }; }
const N = parseInt(process.argv[2] || '20', 10);
const errs = {};
let done = 0, turns = 0;
const reasons = {};
const wins = [0, 0];
(async () => {
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const rr = TAL.mulberry32(5000 + i);
    const a = process.argv.includes('--random') ? randomDeck(rr) : usable[i % usable.length], b = process.argv.includes('--random') ? randomDeck(rr) : usable[(i * 7 + 3) % usable.length];
    const setups = [
      { name: 'A', main: a.main, life: a.life, decide: null },
      { name: 'B', main: b.main, life: b.life, decide: null },
    ];
    setups[0].decide = TAL.makeAI(0); setups[1].decide = TAL.makeAI(1);
    const g = new TAL.Game(db, setups, { seed: 1000 + i });
    let guard = 0;
    const origAsk = g.ask.bind(g);
    g.ask = async (pi, req) => { if (++guard > 20000) { throw new Error('ask-loop'); } return origAsk(pi, req); };
    try {
      const res = await g.run();
      done++; turns += g.turn;
      if (res) { reasons[res.reason] = (reasons[res.reason] || 0) + 1; wins[res.winner]++; }
      if (process.argv.includes('--verbose')) console.log(i, a.name, 'vs', b.name, JSON.stringify(res), 'turns', g.turn);
    } catch (e) {
      const key = (e.stack || String(e)).split('\n').slice(0, 4).join(' | ');
      errs[key] = (errs[key] || 0) + 1;
      if (process.argv.includes('--verbose')) { console.log('ERR game', i, a.name, b.name, key); if (process.argv.includes('--log')) console.log(g.logs.slice(-25).join('\n')); }
    }
  }
  console.log(`games ${N} ok ${done} avg turns ${(turns / Math.max(1, done)).toFixed(1)} time ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('endings', reasons, 'wins', wins);
  const keys = Object.entries(errs).sort((x, y) => y[1] - x[1]);
  console.log('abilities fired', fired.size, 'of', Object.values(db.abilities).filter(a => a.kind !== 'continuous' && a.kind !== 'rule' && !TAL.abilityGate(a).size).length, 'runnable non-passive');
  console.log('errors:', keys.length);
  for (const [k, v] of keys.slice(0, 12)) console.log(v, k);
})();
