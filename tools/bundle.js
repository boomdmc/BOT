'use strict';
// Packs the data JSON into data/bundle.js so index.html also works when opened by double-click (file://).
// Run after changing anything in data/: node tools/bundle.js
const fs = require('fs'), path = require('path');
const d = path.join(__dirname, '..', 'data');
const files = ['card_definitions.json', 'abilities.json', 'ability_patches.json', 'starter_decks.json', 'bot_decks.json'];
const out = {};
for (const f of files) out[f] = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
fs.writeFileSync(path.join(d, 'bundle.js'), 'window.TAL_DATA=' + JSON.stringify(out) + ';\n');
console.log('wrote data/bundle.js', (fs.statSync(path.join(d, 'bundle.js')).size / 1e6).toFixed(1), 'MB');
