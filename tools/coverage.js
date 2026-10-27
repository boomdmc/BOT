'use strict';
// which features block cards from being playable: node tools/coverage.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['core', 'dsl', 'ops', 'flow', 'ai']) require(path.join(root, 'js', f + '.js'));
const TAL = globalThis.TAL;
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const db = TAL.buildDB(rd('card_definitions.json'), rd('abilities.json'), rd('ability_patches.json'));
const cnt = {}; let ok = 0, total = 0;
for (const id of Object.keys(db.cards)) {
  total++;
  const why = TAL.cardWhy(db, id);
  if (!why.length) ok++;
  for (const w of why) cnt[w] = (cnt[w] || 0) + 1;
}
console.log('supported', ok, '/', total);
console.log(Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => v + ' ' + k).join('\n'));
