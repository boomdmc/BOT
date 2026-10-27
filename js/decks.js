'use strict';
/* Deck helpers: validation and substitution of cards the engine can't run yet. */
(function (root) {
  const TAL = root.TAL;

  TAL.deckCount = (main) => Object.values(main).reduce((a, b) => a + b, 0);

  TAL.validateDeck = function (db, deck) {
    const errs = [];
    const n = TAL.deckCount(deck.main);
    const ids = Object.keys(deck.main);
    const onlyOne = ids.filter(id => db.cards[id] && db.cards[id].flags.onlyOne);
    const fifty = ids.some(id => (db.byCard[id] || []).some(a => (a.effects || []).some(e => e.op === 'rule.deckLimit' && e.n === 50)));
    if (n !== 50) errs.push('Deck ต้องมี 50 ใบ (มี ' + n + ')');
    const nm = {};
    for (const id of ids) {
      const c = db.cards[id]; if (!c) { errs.push('ไม่รู้จักการ์ด ' + id); continue; }
      if (c.flags.lamiang) errs.push(c.name + ' (ลำเอียง) ห้ามใช้');
      const key = (c.names && c.names.main && c.names.main[0]) || c.name;
      nm[key] = (nm[key] || 0) + deck.main[id];
      const lim = c.flags.onlyOne ? 1 : (c.deckLimit || 4);
      if (nm[key] > Math.max(lim, 4) && !fifty) errs.push(key + ' เกินจำนวนที่ใส่ได้');
    }
    const oneCount = onlyOne.reduce((s, id) => s + deck.main[id], 0);
    if (!fifty && oneCount !== 1) errs.push('ต้องมีการ์ด Only #1 พอดี 1 ใบ (มี ' + oneCount + ')');
    if ((deck.life || []).length !== 5) errs.push('LIFE ต้อง 5 ใบ');
    else if (new Set(deck.life.map(id => db.cards[id] && db.cards[id].name)).size !== 5) errs.push('LIFE ต้องชื่อไม่ซ้ำกัน');
    return errs;
  };

  TAL.adaptDeck = function (db, deck, rand) {
    rand = rand || Math.random;
    const supported = (id) => TAL.cardSupported(db, id);
    const all = Object.keys(db.cards).filter(id => supported(id) && !db.cards[id].flags.lamiang && !db.cards[id].flags.isToken);
    const main = Object.assign({}, deck.main);
    const life = (deck.life || []).slice();
    const replaced = [];
    const pickLike = (id, taken) => {
      const c = db.cards[id];
      const cand = all.filter(x => {
        const d = db.cards[x];
        if (d.type !== c.type || d.flags.onlyOne) return false;
        if (c.type !== 'LIFE' && (d.color || null) !== (c.color || null)) return false;
        if (c.type === 'Magic' && d.magicType !== c.magicType) return false;
        return !taken.has(d.name);
      });
      cand.sort((a, b) => Math.abs((db.cards[a].cost || 0) - (c.cost || 0)) - Math.abs((db.cards[b].cost || 0) - (c.cost || 0)) + (rand() - 0.5));
      return cand[0];
    };
    for (const id of Object.keys(main)) {
      if (supported(id)) continue;
      const n = main[id]; delete main[id];
      const c = db.cards[id];
      if (c.flags.onlyOne) {
        const pool = all.filter(x => db.cards[x].flags.onlyOne && db.cards[x].type === c.type && (db.cards[x].color || null) === (c.color || null));
        const pick = pool.length ? pool[Math.floor(rand() * pool.length)] : null;
        if (pick) { main[pick] = 1; replaced.push([id, pick]); } else { main[id] = n; }
        continue;
      }
      const taken = new Set(Object.keys(main).map(x => db.cards[x].name));
      let left = n;
      while (left > 0) {
        const pick = pickLike(id, taken);
        if (!pick) break;
        const k = Math.min(left, 4);
        main[pick] = (main[pick] || 0) + k; left -= k; taken.add(db.cards[pick].name);
        replaced.push([id, pick]);
      }
    }
    const lifeNames = new Set(life.filter(supported).map(x => db.cards[x].name));
    for (let i = 0; i < life.length; i++) {
      if (supported(life[i])) continue;
      const pick = pickLike(life[i], lifeNames);
      if (pick) { replaced.push([life[i], pick]); life[i] = pick; lifeNames.add(db.cards[pick].name); }
    }
    return { main, life, replaced };
  };
})(typeof window !== 'undefined' ? window : globalThis);
