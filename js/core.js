'use strict';
/* Battle of Talingchan - core game engine (rules per Rule Book v3.2, see RULES_SPEC.md) */
(function (root) {
  const TAL = root.TAL || (root.TAL = {});

  const FIELD = ['avatarZone', 'magicZone', 'constructZone', 'landZone'];
  const GAME_OVER = { gameOver: true };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------- database ---------- */
  function applyPatches(abilities, patches) {
    if (!patches) return;
    for (const [id, p] of Object.entries(patches)) {
      const ab = abilities[id];
      if (!ab) continue;
      if (p.replace) {
        const holders = [];
        const collect = (arr) => {
          if (!Array.isArray(arr)) return;
          for (let i = 0; i < arr.length; i++) {
            const e = arr[i];
            if (e && e.op === 'unsupported') holders.push([arr, e]);
            else if (e && typeof e === 'object') {
              for (const k of ['effects', 'then', 'else']) collect(e[k]);
              if (e.options) e.options.forEach(o => collect(o.effects));
              if (e.outcomes) e.outcomes.forEach(o => collect(o.effects));
              if (e.modes) e.modes.forEach(o => collect(o.effects));
            }
          }
        };
        collect(ab.effects); collect(ab.cost);
        if (ab.modes) ab.modes.forEach(m => collect(m.effects));
        p.replace.forEach((r, i) => {
          const h = holders[i]; if (!h) return;
          const arr = h[0], idx = arr.indexOf(h[1]);
          if (idx < 0) return;
          if (r === null) arr.splice(idx, 1);
          else if (Array.isArray(r)) arr.splice(idx, 1, ...r);
          else arr[idx] = r;
        });
      }
      if (p.set) Object.assign(ab, p.set);
      ab.status = 'ready';
    }
  }

  TAL.buildDB = function (cardDefs, abil, patches) {
    const cards = {}, abilities = {}, byCard = {}, byEvent = {};
    for (const c of cardDefs.cards) cards[c.id] = c;
    for (const a of abil.abilities) { abilities[a.id] = JSON.parse(JSON.stringify(a)); }
    applyPatches(abilities, patches && patches.patches);
    for (const a of Object.values(abilities)) {
      (byCard[a.card] = byCard[a.card] || []).push(a);
    }
    for (const k of Object.keys(byCard)) byCard[k].sort((x, y) => x.index - y.index);
    for (const a of Object.values(abilities)) {
      if (a.trigger && a.trigger.event) (byEvent[a.trigger.event] = byEvent[a.trigger.event] || []).push(a);
    }
    return { cards, abilities, byCard, byEvent };
  };

  /* ---------- Game ---------- */
  class Game {
    constructor(db, setups, opts) {
      opts = opts || {};
      this.db = db;
      this.rand = mulberry32(opts.seed == null ? (Math.random() * 1e9) | 0 : opts.seed);
      this.logs = [];
      this.onLog = opts.onLog || null;
      this.onChange = opts.onChange || null;
      this.uidN = 1;
      this.ver = 0;
      this.turn = 0;
      this.active = 0;
      this.phase = null;
      this.land = [];
      this.stack = [];
      this.battle = null;
      this.pendingDestroy = null;
      this.over = null;
      this.magicUsed = {};
      this.extraQuota = {};
      this.players = setups.map((s, i) => ({
        i, name: s.name, decide: s.decide, isHuman: !!s.isHuman,
        deck: [], hand: [], hell: [], dark: [], life: [], avatarZone: [], magicZone: [], constructZone: [],
        flags: {}, pendingLife: [], partnerDone: false, setup: s,
      }));
      this.cardsById = {};
      this.uidMap = {};
      this.depth = 0;
    }

    /* --- infra --- */
    log(msg) { this.logs.push(msg); if (this.onLog) this.onLog(msg); }
    bump() { this.ver++; }
    opp(i) { return 1 - i; }
    P(i) { return this.players[i]; }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    }
    async ask(pi, req) {
      this.changed();
      const p = this.players[pi];
      const r = await p.decide(req, this);
      return r;
    }
    changed() { if (this.onChange) this.onChange(this); }

    newCard(id, owner) {
      const def = this.db.cards[id];
      if (!def) throw new Error('unknown card ' + id);
      const c = {
        uid: this.uidN++, id, def, owner, ctrl: owner, zone: 'deck', state: 'awake', faceUp: false,
        mods: [], grants: [], equipped: [], host: null, used: {}, summonedTurn: -1, inPartner: false,
        flags: {}, isToken: !!def.flags.isToken,
      };
      (this.cardsById[id] = this.cardsById[id] || []).push(c);
      this.uidMap[c.uid] = c;
      return c;
    }
    newToken(spec, owner) {
      const def = {
        id: 'TOKEN', name: spec.name, names: { main: [spec.name], alias: [] }, type: 'Avatar', magicType: null,
        color: spec.color || null, colorKey: null, cost: spec.cost || 0,
        gem: { count: spec.gem || 0, color: null }, symbol: spec.symbol || null, power: spec.power || 0,
        text: '', flags: { onlyOne: false, isToken: true }, abilityIds: [], tokenAbilities: spec.abilities || [],
      };
      const c = {
        uid: this.uidN++, id: 'TOKEN', def, owner, ctrl: owner, zone: 'limbo', state: 'awake', faceUp: false,
        mods: [], grants: [], equipped: [], host: null, used: {}, summonedTurn: -1, inPartner: false,
        flags: {}, isToken: true,
      };
      this.uidMap[c.uid] = c;
      return c;
    }

    /* --- zones --- */
    arr(p, zone) {
      const pl = this.players[p];
      switch (zone) {
        case 'deck': case 'hand': case 'hell': case 'dark': case 'life':
        case 'avatarZone': case 'magicZone': case 'constructZone': return pl[zone];
        case 'landZone': return this.land.filter(c => c.ctrl === p);
        case 'lifeFaceUp': return pl.life.filter(c => c.faceUp);
        case 'lifeFaceDown': return pl.life.filter(c => !c.faceUp);
        case 'field': return pl.avatarZone.concat(pl.magicZone, pl.constructZone, this.land.filter(c => c.ctrl === p));
        default: throw new Error('zone ' + zone);
      }
    }
    zoneCards(p, zone) { return this.arr(p, zone); }
    allInPlay() {
      const out = [];
      for (const pl of this.players) out.push(...pl.avatarZone, ...pl.magicZone, ...pl.constructZone);
      out.push(...this.land);
      return out;
    }
    isOnField(c) { return FIELD.includes(c.zone); }
    removeFromZone(c) {
      const z = c.zone;
      if (z === 'landZone') { const i = this.land.indexOf(c); if (i >= 0) this.land.splice(i, 1); return; }
      if (['deck', 'hand', 'hell', 'dark', 'life', 'avatarZone', 'magicZone', 'constructZone'].includes(z)) {
        for (const p of this.players) {
          const l = p[z]; const i = l.indexOf(c);
          if (i >= 0) { l.splice(i, 1); return; }
        }
      }
    }

    /* ---- put a card into a zone (no events) ---- */
    placeIn(c, zone, who, pos) {
      c.zone = zone;
      const p = who == null ? c.owner : who;
      switch (zone) {
        case 'hand': c.ctrl = c.owner; this.players[c.owner].hand.push(c); break;
        case 'deck':
          c.ctrl = c.owner;
          if (pos === 'bottom') this.players[c.owner].deck.push(c); else this.players[c.owner].deck.unshift(c);
          break;
        case 'hell': c.ctrl = c.owner; this.players[c.owner].hell.push(c); break;
        case 'dark': c.ctrl = c.owner; this.players[c.owner].dark.push(c); break;
        case 'avatarZone': case 'magicZone': case 'constructZone':
          c.ctrl = p; this.players[p][zone].push(c); break;
        case 'landZone': c.ctrl = p; this.land.push(c); break;
        case 'life': c.ctrl = c.owner; this.players[c.owner].life.unshift(c); c.faceUp = false; break;
        default: c.zone = zone;
      }
      this.bump();
    }

    /* Remove a card from the field and clean up (equipped, mods, tokens) */
    async leaveField(c) {
      const eq = c.equipped.slice();
      this.removeFromZone(c);
      if (c.host) { const h = c.host; h.equipped = h.equipped.filter(x => x !== c); c.host = null; }
      c.mods = []; c.grants = []; c.state = 'awake';
      this.unpartner(c);
      c.used = {};
      c.faceUp = false;
      c.zone = 'limbo';
      c.equipped = [];
      this.bump();
      for (const e of eq) {
        e.host = null;
        this.removeFromZone(e);
        e.zone = 'limbo';
        await this.sendTo(e, 'hell', { cause: 'destroy', quiet: true });
      }
    }

    unpartner(c) {
      if (c.partnerWith) {
        const o = c.partnerWith; c.partnerWith = null; c.inPartner = false;
        if (o) { o.partnerWith = null; o.inPartner = false; }
      }
      c.inPartner = false;
    }

    /* Generic "send card to destination" with events. dest strings per DSL. */
    async sendTo(c, dest, opts) {
      opts = opts || {};
      const fromZone = c.zone;
      const wasField = this.isOnField(c);
      let z = dest, pos = 'top', who = null;
      switch (dest) {
        case 'ownerHand': z = 'hand'; break;
        case 'ownerHell': z = 'hell'; break;
        case 'deckTop': z = 'deck'; pos = 'top'; break;
        case 'deckBottom': z = 'deck'; pos = 'bottom'; break;
        case 'deckShuffle': z = 'deck'; break;
        case 'lifeTop': z = 'life'; break;
        case 'removedFromGame': z = 'removed'; break;
        default: break;
      }
      if (opts.who != null) who = opts.who;
      const prevCtrl = c.ctrl;
      if (wasField) await this.leaveField(c); else this.removeFromZone(c);
      if (c.isToken) {
        c.zone = 'removed';
        this.bump();
        if (wasField) await this.afterLeave(c, fromZone, prevCtrl);
        return true;
      }
      if (z === 'removed') { c.zone = 'removed'; this.bump(); return true; }
      if (z === 'avatarZone' || z === 'magicZone' || z === 'constructZone' || z === 'landZone') {
        this.placeIn(c, z, who != null ? who : prevCtrl);
      } else {
        this.placeIn(c, z, null, pos);
        if (dest === 'deckShuffle') this.shuffle(this.players[c.owner].deck);
      }
      if (z === 'hell') {
        await this.fire('self.toHell', { self: c, cause: opts.cause || 'any', bySide: opts.bySide, fromZone });
      }
      if (z === 'hand') {
        await this.fire('self.addedToHand', { self: c, fromZone, cause: opts.cause === 'draw' ? 'draw' : 'ability' });
      }
      if (wasField) await this.afterLeave(c, fromZone, prevCtrl);
      this.checkEnd();
      return true;
    }
    async afterLeave(c, fromZone, prevCtrl) {
      c.leftFrom = fromZone;
      await this.fire('self.leavesField', { self: c, fromZone });
      await this.fire('any.leavesField', { self: c, fromZone, triggerCard: c, side: prevCtrl });
    }

    /* ---------- deck operations ---------- */
    async draw(pi, n) {
      const pl = this.players[pi];
      let drawn = 0;
      for (let i = 0; i < n; i++) {
        if (this.restricted(pi, 'draw')) break;
        const c = pl.deck.shift();
        if (!c) { this.checkEnd(); break; }
        c.zone = 'hand'; pl.hand.push(c); drawn++; this.bump();
        await this.fire('self.addedToHand', { self: c, fromZone: 'deck', cause: 'draw', duringPhase: this.phase });
        await this.fire('any.cardDrawn', { side: pi, outsideDrawPhase: this.phase !== 'draw', triggerCard: c });
      }
      this.checkEnd();
      return drawn;
    }
    async mill(pi, n) {
      const pl = this.players[pi];
      let k = 0;
      for (let i = 0; i < n; i++) {
        const c = pl.deck.shift();
        if (!c) break;
        k++;
        c.zone = 'limbo';
        this.placeIn(c, 'hell');
        await this.fire('self.toHell', { self: c, cause: 'mill', fromZone: 'deck' });
      }
      if (k) { pl.milledTurn = this.turn; await this.fire('any.cardsMilled', { side: pi }); }
      this.checkEnd();
      return k;
    }

    checkEnd() {
      if (this.over) throw GAME_OVER;
      if (this.turn > 0) {
        for (const p of this.players) {
          if (p.deck.length === 0) {
            this.over = { winner: 1 - p.i, reason: 'deck-out' };
            this.log(`${p.name} Deck หมด -> แพ้`);
            throw GAME_OVER;
          }
        }
      }
    }
    isCritical(pi) { return this.players[pi].life.every(c => c.faceUp); }
    win(pi, reason) { this.over = { winner: pi, reason }; throw GAME_OVER; }

    /* ---------- costs ---------- */
    gemOf(c) { return (c.def.gem && c.def.gem.count) || 0; }
    gemColor(c) { return (c.def.gem && c.def.gem.color) || null; }
    gemCompat(payer, target) {
      const gc = this.gemColor(payer);
      if (!gc) return true;
      const tc = this.colorsOf(target);
      return tc.includes(gc) || tc.includes('all');
    }
    validPayment(cards, cost, target) {
      if (cost <= 0) return cards.length === 0;
      if (!cards.length) return false;
      let sum = 0, min = Infinity;
      for (const c of cards) {
        const g = this.gemOf(c);
        if (g <= 0) return false;
        if (!this.gemCompat(c, target)) return false;
        sum += g; min = Math.min(min, g);
      }
      return sum >= cost && (sum - min) < cost;
    }
    /* all minimal valid payments from hand */
    paymentOptions(pi, target, limit) {
      const cost = this.effectiveCost(target);
      if (cost <= 0) return [[]];
      const hand = this.players[pi].hand.filter(c => c !== target && this.gemOf(c) > 0 && this.gemCompat(c, target));
      const out = [];
      const n = hand.length;
      for (let m = 1; m < (1 << n); m++) {
        const sel = [];
        for (let i = 0; i < n; i++) if (m & (1 << i)) sel.push(hand[i]);
        if (this.validPayment(sel, cost, target)) { out.push(sel); if (limit && out.length >= limit) break; }
      }
      return out;
    }
    canPay(pi, target) { return this.paymentOptions(pi, target, 1).length > 0; }
  }

  TAL.Game = Game;
  TAL.GAME_OVER = GAME_OVER;
  TAL.FIELD = FIELD;
  TAL.mulberry32 = mulberry32;
})(typeof window !== 'undefined' ? window : globalThis);
