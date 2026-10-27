'use strict';
/* Simple heuristic AI opponent. Returns a decide(req, game) function. */
(function (root) {
  const TAL = root.TAL;

  TAL.makeAI = function (pi, opts) {
    opts = opts || {};
    const st = { turn: -1, count: 0, used: {}, plan: null };

    const val = (g, c) => {
      const d = c.def;
      if (d.type === 'Avatar') return g.getPower(c) + (d.cost || 0) * 0.6;
      if (d.type === 'Construct') return 4 + (d.cost || 0) * 0.3;
      return 3 + (d.cost || 0) * 0.2;
    };
    const find = (g, uid) => g.uidMap[uid] || null;
    const shuffleArr = (g, a) => { const t = a.slice(); g.shuffle(t); return t; };

    function pickSubset(g, req, ordered) {
      const min = req.min == null ? 0 : req.min, max = req.max == null ? ordered.length : req.max;
      let sel = ordered.slice(0, Math.max(min, Math.min(max, req.hint === 'mulligan' ? 0 : max)));
      if (sel.length < min) sel = ordered.slice(0, min);
      if (!req.validate || req.validate(sel)) return sel;
      for (let t = 0; t < 300; t++) {
        const k = min + Math.floor(g.rand() * (Math.min(max, ordered.length) - min + 1));
        const s = shuffleArr(g, ordered).slice(0, k);
        if (req.validate(s)) return s;
      }
      return sel;
    }

    return async function decide(req, g) {
      switch (req.kind) {
        case 'confirm': return true;
        case 'options': return [req.options[Math.floor(g.rand() * req.options.length)].id];
        case 'pay': {
          const best = req.options.slice().sort((a, b) => (a.reduce((s, u) => s + (req.gems[u] || 0), 0) - b.reduce((s, u) => s + (req.gems[u] || 0), 0)) || (a.length - b.length))[0];
          // prefer discarding low-value cards
          const hand = g.players[pi].hand;
          const cheap = req.options.slice().sort((a, b) => {
            const va = a.reduce((s, u) => s + val(g, find(g, u)), 0), vb = b.reduce((s, u) => s + val(g, find(g, u)), 0);
            return va - vb;
          })[0];
          return cheap || best;
        }
        case 'pick': {
          let cards = req.cards.map(u => find(g, u)).filter(Boolean);
          if (req.hint === 'mulligan') {
            const exp = cards.filter(c => (c.def.cost || 0) >= 6 || (c.def.type !== 'Magic' && !g.gemOf(c) && (c.def.cost || 0) > 3)).slice(0, 2);
            return exp.map(c => c.uid);
          }
          if (req.helper) return [];
          if (req.optional) {
            // human shield: use only if shield survives
            const b = g.battle;
            if (b && cards.length) {
              const s = cards.slice().sort((x, y) => g.getPower(y) - g.getPower(x))[0];
              if (g.getPower(s) > g.getPower(b.attacker)) return [s.uid];
            }
            return [];
          }
          let ordered;
          if (req.hint === 'harm') ordered = cards.slice().sort((a, b) => (b.ctrl !== pi ? 1 : 0) - (a.ctrl !== pi ? 1 : 0) || val(g, b) - val(g, a));
          else if (req.hint === 'cost') ordered = cards.slice().sort((a, b) => val(g, a) - val(g, b));
          else ordered = cards.slice().sort((a, b) => val(g, b) - val(g, a));
          return pickSubset(g, req, ordered.map(c => c.uid));
        }
        case 'respond': {
          const o = req.options;
          const must = o.find(x => /ไม่ถูกทำลาย|ยกเลิก|ส่งลงนรก|ไม่ถูก/.test(x.text || ''));
          if (must) return [must.id];
          return g.rand() < 0.45 ? [o[Math.floor(g.rand() * o.length)].id] : [];
        }
        case 'action': {
          if (st.turn !== g.turn) { st.turn = g.turn; st.count = 0; st.used = {}; }
          st.count++;
          const acts = req.actions;
          const end = acts.find(a => a.type === 'endPhase');
          if (st.count > 30) return [end.id];
          const rank = { land: 100, partner: 90, summon: 60, modify: 55, build: 50, spell: 40, activate: 30 };
          let best = null, bs = -1;
          for (const a of acts) {
            if (a.type === 'endPhase') continue;
            const c = a.card != null ? find(g, a.card) : null;
            const key = a.type + ':' + (a.card || '') + ':' + a.label;
            if ((a.type === 'activate' || a.type === 'spell') && st.used[key] >= 1) continue;
            let s = rank[a.type] || 0;
            if (a.type === 'summon' && c) s += val(g, c);
            if (a.type === 'spell') s += g.rand() * 25;
            if (a.type === 'activate') s += g.rand() * 15;
            if (s > bs) { bs = s; best = a; }
          }
          if (!best) return [end.id];
          const key = best.type + ':' + (best.card || '') + ':' + best.label;
          st.used[key] = (st.used[key] || 0) + 1;
          return [best.id];
        }
        case 'attack': {
          const me = g.players[pi], opp = g.players[1 - pi];
          let best = null, bs = 2.5;
          for (const a of req.attackers) {
            const att = find(g, a.card);
            const pA = g.getPower(att);
            for (const t of a.targets) {
              let s = -1;
              if (t.kind === 'life') s = pA > 0 ? 8 + (opp.life.filter(x => !x.faceUp).length <= 2 ? 4 : 0) : -5;
              else if (t.kind === 'construct') { const c = find(g, t.card); s = pA > g.getPower(c) ? 4 : -1; }
              else {
                const c = find(g, t.card), pT = g.getPower(c);
                if (pA > pT) s = 5 + val(g, c) * 0.3; else if (pA === pT && pA > 0) s = val(g, c) > val(g, att) ? 3 : 0.5; else s = -2;
              }
              if (s > bs) { bs = s; best = { a, t }; }
            }
          }
          if (!best) return [];
          st.plan = { att: best.a.card, tgt: best.t };
          return [best.a.id];
        }
        case 'target': {
          const p = st.plan;
          if (p) { const t = req.targets.find(x => x.kind === p.tgt.kind && x.card === p.tgt.card); if (t) return [t.id]; }
          return [req.targets[0].id];
        }
        default: return [];
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
