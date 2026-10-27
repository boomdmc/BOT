'use strict';
// print the full log of one simulated game: node tools/play1.js <index>
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['core', 'dsl', 'ops', 'flow', 'ai']) require(path.join(root, 'js', f + '.js'));
const TAL = globalThis.TAL;
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const db = TAL.buildDB(rd('card_definitions.json'), rd('abilities.json'), rd('ability_patches.json'));
const sd = rd('starter_decks.json'); const names = Object.keys(sd);
const i = parseInt(process.argv[2] || '0', 10);
const a = sd[names[i % 4]], b = sd[names[(i + 1) % 4]];
const g = new TAL.Game(db, [{ name: 'A', main: a.main, life: a.life, decide: TAL.makeAI(0) }, { name: 'B', main: b.main, life: b.life, decide: TAL.makeAI(1) }], { seed: 1000 + i });
g.run().then(r => { console.log(g.logs.join('\n')); console.log(JSON.stringify(r), 'turns', g.turn); });
