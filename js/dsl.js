'use strict';
/* Ability DSL interpreter: queries, selectors, conditions, ops, triggers. Extends TAL.Game. */
(function (root) {
  const TAL = root.TAL;
  const G = TAL.Game.prototype;
  const FIELD = TAL.FIELD;

  /* ======================================================================
   * Supported vocabulary (cards using anything else are excluded from play)
   * ==================================================================== */
  const IMPL_OPS = new Set(['draw', 'mill', 'discard', 'scout', 'search', 'move', 'destroy', 'exile', 'sacrifice',
    'shuffleDeck', 'summon', 'summonThis', 'summonToken', 'modifyPower', 'setPower', 'grantKeyword', 'untap', 'tap',
    'preventDestroy', 'protect', 'damageLife', 'revealLife', 'unrevealLife', 'if', 'choose', 'optional', 'random',
    'forEach', 'delayed', 'cancelAttack', 'redirectAttack', 'revealHand', 'restrict', 'equip', 'unequip', 'takeControl',
    'negate', 'changeName', 'changeSymbol', 'changeColor', 'modifyCost', 'build', 'playLand', 'addMagicQuota',
    'removeAbilities', 'grantAbility', 'consumeMagicQuota', 'revealFromHand']);
  const IMPL_RULES = new Set(['rule.deckLimit', 'rule.nameAlso', 'rule.symbolAlso', 'rule.colorAlso',
    'rule.costPaymentOnlyFor', 'rule.controlLimit', 'rule.abilityUseLimit', 'rule.deckRequires', 'rule.deckForbids',
    'rule.costIs', 'rule.ignoresMagicQuota', 'rule.cannotPlayFromHand', 'rule.summonOnlyBy', 'rule.cannotEquip',
    'rule.countsAsNForCost']);
  const IMPL_COND = new Set(['count', 'compare', 'landIs', 'thisState', 'thisInZone', 'thisHasEquip', 'thisIsEquipped',
    'thisInPartner', 'thisSummonedBy', 'turn', 'phase', 'critical', 'lifeFaceUp', 'magicUsedThisTurn', 'milledThisTurn',
    'hostMatches', 'triggerMatches', 'resultOf', 'not', 'all', 'any', 'firstOwnTurn', 'turnNumber', 'triggerSourceMatches',
    'onFieldSince', 'inBattle']);
  const IMPL_EVENTS = new Set(['self.summoned', 'self.declaresAttack', 'self.attackTargeted', 'self.battles',
    'self.battleEnds', 'self.destroysInBattle', 'self.wouldBeDestroyed', 'self.destroyed', 'self.toHell',
    'self.usedAsCost', 'self.scouted', 'self.revealedByAttack', 'self.revealedByDamage', 'self.equipped',
    'self.leavesField', 'self.abilityUsed', 'self.partnerFormed', 'host.declaresAttack', 'host.battles',
    'host.destroysInBattle', 'host.destroyed', 'any.avatarSummoned', 'any.attackDeclared', 'any.avatarWouldBeDestroyed',
    'any.avatarDestroyed', 'any.magicUsed', 'any.abilityUsed', 'any.cardsMilled', 'any.lifeRevealed', 'any.cardDrawn',
    'any.leavesField', 'phase.start', 'phase.end', 'turn.end', 'window.default', 'any.battles',
    'any.wouldBeDestroyed', 'host.wouldBeDestroyed', 'host.leavesField', 'host.attackTargeted', 'any.destroysInBattle',
    'self.addedToHand', 'any.cardsDiscarded', 'self.equipReceived', 'any.targeted']);
  const FILTER_KEYS = new Set(['type', 'magicType', 'symbol', 'color', 'nameIs', 'nameHas', 'nameNot', 'textHas', 'cost',
    'gem', 'power', 'state', 'onlyOne', 'isToken', 'equipped', 'notThis', 'distinctNames', 'symbolNot', 'colorNot',
    'typeNot', 'hasKeyword', 'equippedTo', 'equippedWith', 'printedOwner', 'ownedBy', 'inPartner', 'donjai', 'noText',
    'battling', 'summonedThisTurn', 'distinctSymbols', 'anyOf', 'nameHasNot', 'summonedFrom']);

  function gateWalk(o, why, key) {
    if (Array.isArray(o)) { for (const x of o) gateWalk(x, why, key); return; }
    if (!o || typeof o !== 'object') return;
    if (typeof o.cond === 'string') {
      if (!IMPL_COND.has(o.cond)) why.add('cond:' + o.cond);
      for (const [k, v] of Object.entries(o)) if (k !== 'cond' && k !== 'op') gateWalk(v, why, k);
      if (o.op && typeof o.op === 'object') gateWalk(o.op, why, 'op');
      return;
    }
    if (typeof o.op === 'string') {
      if (o.op.startsWith('rule.')) { if (!IMPL_RULES.has(o.op)) why.add(o.op); }
      else if (!IMPL_OPS.has(o.op)) why.add('op:' + o.op);
    }
    if (key && /filter$/i.test(key) || key === 'equippedTo' || key === 'exceptFilter' || key === 'hostFilter') {
      for (const k of Object.keys(o)) if (!FILTER_KEYS.has(k) && k !== 'filter' && k !== 'min') why.add('filterkey:' + k);
    }
    for (const [k, v] of Object.entries(o)) gateWalk(v, why, k);
  }
  TAL.abilityGate = function (ab) {
    const why = new Set();
    if (ab.status !== 'ready') why.add('status');
    if (ab.trigger && ab.trigger.event && !IMPL_EVENTS.has(ab.trigger.event)) why.add('event:' + ab.trigger.event);
    gateWalk(ab.effects, why); gateWalk(ab.cost, why); gateWalk(ab.modes, why); gateWalk(ab.conditions, why);
    if (ab.trigger) gateWalk(ab.trigger.params, why, 'params');
    if (ab.hostFilter) gateWalk(ab.hostFilter, why, 'hostFilter');
    return why;
  };
  TAL.cardSupported = function (db, id) {
    const def = db.cards[id];
    if (!def) return false;
    const abs = db.byCard[id] || [];
    for (const a of abs) { if (TAL.abilityGate(a).size) return false; }
    return true;
  };
  TAL.cardWhy = function (db, id) {
    const out = new Set();
    for (const a of db.byCard[id] || []) for (const w of TAL.abilityGate(a)) out.add(w);
    return [...out];
  };

  /* ======================================================================
   * Card queries
   * ==================================================================== */
  const sideList = (g, ctrl, side) => {
    if (side === 'self' || side === undefined || side === 'owner' || side === 'controller') return [ctrl];
    if (side === 'enemy') return [1 - ctrl];
    return [0, 1];
  };
  G.sides = function (ctrl, side) { return sideList(this, ctrl, side); };

  function playersOf(g, ctx, who) {
    switch (who) {
      case 'self': case undefined: case 'controller': case 'chooser': return [ctx.controller];
      case 'enemy': return [1 - ctx.controller];
      case 'both': case 'any': return [ctx.controller, 1 - ctx.controller];
      case 'owner': return [ctx.src ? ctx.src.owner : ctx.controller];
      default: return [ctx.controller];
    }
  }

  G.abilitiesOf = function (c, includeAll) {
    let list = this.db.byCard[c.id] || [];
    if (c.def.tokenAbilities && c.def.tokenAbilities.length) list = c.def.tokenAbilities;
    if (c.grants.length) list = list.concat(c.grants.map(x => x.ability));
    if (!includeAll && this.cardNoAbilities(c)) list = list.filter(a => a.kind === 'rule' || a.kind === 'equipRestriction');
    return list;
  };
  G.cardNoAbilities = function (c) {
    return c.mods.some(m => m.kind === 'noabil' && this.modAlive(m));
  };
  const ZONE_OK = {
    avatarZone: (c) => c.zone === 'avatarZone', magicZone: (c) => c.zone === 'magicZone',
    constructZone: (c) => c.zone === 'constructZone', landZone: (c) => c.zone === 'landZone',
    field: (c) => FIELD.includes(c.zone), hand: (c) => c.zone === 'hand', hell: (c) => c.zone === 'hell',
    life: (c) => c.zone === 'life', deck: (c) => c.zone === 'deck', dark: (c) => c.zone === 'dark',
  };
  G.abilityZoneOk = function (c, ab) {
    if (!ab.zone) return c.zone === 'hand' || FIELD.includes(c.zone);
    const f = ZONE_OK[ab.zone];
    return f ? f(c) : false;
  };

  G.modAlive = function (m) {
    if (m.srcCard && m.until === 'whileSourceOnField' && !FIELD.includes(m.srcCard.zone)) return false;
    return true;
  };
  G.activeMods = function (c, kind) { return c.mods.filter(m => (!kind || m.kind === kind) && this.modAlive(m)); };

  G.expireMods = function (ev, arg) {
    const keep = (m) => {
      const u = m.until;
      if (u === 'endOfAttack' && (ev === 'endOfAttack' || ev === 'endOfBattle' || ev === 'endOfTurn')) return false;
      if (u === 'endOfBattle' && (ev === 'endOfBattle' || ev === 'endOfTurn')) return false;
      if (u === 'endOfTurn' && ev === 'endOfTurn') return false;
      if (u === 'endOfNextTurn' && ev === 'endOfTurn' && m.setTurn < this.turn) return false;
      if (u === 'endOfOwnNextTurn' && ev === 'endOfTurn' && this.active === m.owner && m.setTurn < this.turn) return false;
      if (u === 'endOfEnemyNextTurn' && ev === 'endOfTurn' && this.active !== m.owner && m.setTurn < this.turn) return false;
      if (u === 'untilOwnNextDrawPhase' && ev === 'drawPhase' && arg === m.owner && m.setTurn < this.turn) return false;
      return true;
    };
    for (const c of this.allCards()) { if (c.mods.length) { const n = c.mods.length; c.mods = c.mods.filter(keep); if (c.mods.length !== n) this.bump(); } }
    for (const p of this.players) {
      if (p.restrictions && p.restrictions.length) p.restrictions = p.restrictions.filter(keep);
      if (p.quotaMods && ev === 'endOfTurn') p.quotaMods = [];
    }
  };
  G.allCards = function () {
    const out = [];
    for (const p of this.players) out.push(...p.deck, ...p.hand, ...p.hell, ...p.dark, ...p.life, ...p.avatarZone, ...p.magicZone, ...p.constructZone);
    out.push(...this.land);
    return out;
  };
  G.addMod = function (c, mod) {
    mod.setTurn = this.turn;
    c.mods.push(mod); this.bump();
  };

  /* ---------- continuous effects ---------- */
  G.contInfo = function () {
    if (this._ci && this._ciVer === this.ver) return this._ci;
    if (this._ciBusy) return this._ciLast || { entries: [], rules: [] };
    this._ciBusy = true;
    const info = { entries: [], rules: [], costSets: [], costMods: [] };
    this._ciLast = info;
    try {
      const cards = this.allInPlay().concat(this.players[0].hand, this.players[1].hand);
      for (const c of cards) {
        for (const ab of this.abilitiesOf(c)) {
          if (ab.kind !== 'continuous' && ab.kind !== 'rule') continue;
          if (ab.kind === 'continuous' && !this.abilityZoneOk(c, ab)) continue;
          if (ab.kind === 'rule' && !(c.zone === 'hand' || FIELD.includes(c.zone))) continue;
          const ctx = { src: c, ab, controller: c.ctrl, chosen: {}, vars: {}, trigger: {} };
          if (ab.conditions && ab.conditions.length && !this.condAll(ab.conditions, ctx)) continue;
          const flat = [];
          this.flattenStatic(ab.effects || [], ctx, flat);
          for (const eff of flat) {
            if (eff.op.startsWith('rule.')) info.rules.push({ src: c, ab, eff, ctx });
            else info.entries.push({ src: c, ab, eff, ctx });
          }
        }
      }
    } catch (err) { this._ciBusy = false; throw err; }
    for (const e of info.entries) {
      if (e.eff.op === 'modifyCost') {
        const m = (card) => this.matchTargetStatic(e.eff.target, e.ctx, card);
        if (e.eff.set != null) info.costSets.push({ matches: m, value: this.amt(e.eff.set, e.ctx) });
        else info.costMods.push({ matches: m, amount: this.amt(e.eff.amount, e.ctx) });
      }
    }
    this._ciBusy = false;
    this._ci = info; this._ciVer = this.ver; this._ciLast = info;
    return info;
  };
  G.flattenStatic = function (ops, ctx, out) {
    for (const o of ops) {
      if (!o) continue;
      if (o.op === 'if') {
        if (this.cond(o.cond, ctx)) this.flattenStatic(o.then || [], ctx, out); else this.flattenStatic(o.else || [], ctx, out);
      } else out.push(o);
    }
  };
  G.matchTargetStatic = function (sel, ctx, card) {
    if (!sel) return false;
    if (sel.ref) {
      const refs = this.refCards(sel.ref, ctx);
      if (!refs.includes(card)) return false;
      return sel.filter ? this.matchFilter(card, sel.filter, ctx) : true;
    }
    const zones = sel.zones || [sel.zone || 'avatarZone'];
    const sides = this.sides(ctx.controller, sel.side);
    let zok = false;
    for (const z of zones) {
      if (z === 'field') { if (FIELD.includes(card.zone)) zok = true; }
      else if (card.zone === z) zok = true;
    }
    if (!zok) return false;
    if (!sides.includes(card.ctrl)) return false;
    return this.matchFilter(card, sel.filter, ctx);
  };

  G.getPower = function (c) {
    if (c.def.type === 'Magic') return 0;
    if (this._depthP > 8) return c.def.power || 0;
    this._depthP = (this._depthP || 0) + 1;
    try {
      let base = c.def.power || 0;
      let l1 = 0, l2 = 0, l4 = 0;
      let setBase = null;
      for (const m of this.activeMods(c)) {
        if (m.kind === 'setBase') setBase = m.value;
        if (m.kind === 'power') { if (m.layer === 4) l4 += m.amount; else l1 += m.amount; }
      }
      if (setBase != null) base = setBase;
      const info = this.contInfo();
      let setPow = null;
      for (const e of info.entries) {
        if (e.eff.op === 'modifyPower' && this.matchTargetStatic(e.eff.target, e.ctx, c)) {
          const a = this.amt(e.eff.amount, e.ctx) * (e.eff.sign || 1);
          if (e.src === c) l1 += a; else l2 += a;
        } else if (e.eff.op === 'setPower' && this.matchTargetStatic(e.eff.target, e.ctx, c)) {
          setPow = this.amt(e.eff.value, e.ctx);
        }
      }
      if (c.noAbilityL1) l1 = 0;
      let total = (setPow != null ? setPow : base) + l1 + l2 + l4;
      return Math.max(0, total);
    } finally { this._depthP--; }
  };
  G.keywordsOf = function (c) {
    const kws = new Set();
    for (const ab of this.abilitiesOf(c)) for (const k of ab.keywords || []) kws.add(k);
    for (const m of this.activeMods(c, 'keyword')) kws.add(m.keyword);
    for (const e of this.contInfo().entries) {
      if (e.eff.op === 'grantKeyword' && this.matchTargetStatic(e.eff.target, e.ctx, c)) kws.add(e.eff.keyword);
    }
    return kws;
  };
  G.hasKw = function (c, k) { return this.keywordsOf(c).has(k); };

  G.namesOf = function (c) {
    let names = [...(c.def.names.main || []), ...(c.def.names.alias || [])];
    for (const m of this.activeMods(c, 'name')) { if (m.mode === 'replace') names = [m.name]; else names.push(m.name); }
    for (const e of this.contInfo().rules) if (e.eff.op === 'rule.nameAlso' && e.src === c) names.push(e.eff.name);
    for (const ab of this.abilitiesOf(c)) for (const eff of ab.effects || []) if (eff.op === 'rule.nameAlso' && !names.includes(eff.name)) names.push(eff.name);
    return names;
  };
  G.symbolsOf = function (c) {
    let s = c.def.symbol ? [c.def.symbol] : [];
    for (const m of this.activeMods(c, 'symbol')) { if (m.mode === 'replace') s = [m.symbol]; else s.push(m.symbol); }
    for (const e of this.contInfo().entries) {
      if (e.eff.op === 'changeSymbol' && this.matchTargetStatic(e.eff.target, e.ctx, c)) { if (e.eff.mode === 'replace') s = [e.eff.symbol]; else s.push(e.eff.symbol); }
    }
    for (const ab of this.abilitiesOf(c)) for (const eff of ab.effects || []) if (eff.op === 'rule.symbolAlso') s.push(eff.symbol);
    return s;
  };
  G.colorsOf = function (c) {
    let col = c.def.color ? [c.def.color] : [];
    for (const m of this.activeMods(c, 'color')) { if (m.mode === 'replace') col = [m.color]; else col.push(m.color); }
    for (const e of this.contInfo().entries) {
      if (e.eff.op === 'changeColor' && this.matchTargetStatic(e.eff.target, e.ctx, c)) { if (e.eff.mode === 'replace') col = [e.eff.color]; else col.push(e.eff.color); }
    }
    for (const ab of this.abilitiesOf(c)) for (const eff of ab.effects || []) if (eff.op === 'rule.colorAlso') col.push(eff.color);
    return col;
  };

  /* restrictions & protections */
  G.restricted = function (pi, action) {
    const p = this.players[pi];
    if (p.restrictions && p.restrictions.some(r => r.action === action && !r.card)) return true;
    for (const e of this.contInfo().entries) {
      if (e.eff.op === 'restrict' && e.eff.action === action && !e.eff.target) {
        const pls = playersOf(this, e.ctx, e.eff.player);
        if (pls.includes(pi)) return true;
      }
    }
    return false;
  };
  G.cardRestricted = function (c, action, extra) {
    for (const m of this.activeMods(c, 'restrict')) if (m.action === action) return true;
    for (const e of this.contInfo().entries) {
      if (e.eff.op === 'restrict' && e.eff.action === action && e.eff.target && this.matchTargetStatic(e.eff.target, e.ctx, c)) {
        if (e.eff.filter && extra && !this.matchFilter(extra, e.eff.filter, e.ctx)) continue;
        return true;
      }
    }
    return false;
  };
  G.playerCardRestricted = function (pi, action, card) {
    const p = this.players[pi];
    const chk = (r, ctx) => {
      if (r.action !== action) return false;
      if (r.filter && card && !this.matchFilter(card, r.filter, ctx)) return false;
      if (r.exceptFilter && card && this.matchFilter(card, r.exceptFilter, ctx)) return false;
      return true;
    };
    if (p.restrictions && p.restrictions.some(r => chk(r, { src: r.srcCard, controller: r.owner }))) return true;
    for (const e of this.contInfo().entries) {
      if (e.eff.op === 'restrict' && !e.eff.target && playersOf(this, e.ctx, e.eff.player).includes(pi) && chk(e.eff, e.ctx)) return true;
    }
    return false;
  };
  G.isProtected = function (c, from, sourceCard) {
    const check = (m, ctx) => {
      if (m.from !== from && !(from === 'battleDestroy' && m.from === 'destroy') && !(from === 'abilityDestroy' && m.from === 'destroy')) return false;
      if (m.sourceFilter && sourceCard && !this.matchFilter(sourceCard, m.sourceFilter, ctx)) return false;
      if (m.exceptSource && sourceCard && this.matchFilter(sourceCard, m.exceptSource, ctx)) return false;
      return true;
    };
    for (const m of this.activeMods(c, 'protect')) if (check(m, { src: m.srcCard, controller: m.owner })) return true;
    for (const e of this.contInfo().entries) {
      if (e.eff.op === 'protect' && this.matchTargetStatic(e.eff.target, e.ctx, c) && check(e.eff, e.ctx)) return true;
    }
    return false;
  };

  /* ======================================================================
   * Filters, refs, selectors, amounts, conditions
   * ==================================================================== */
  const cmp = (v, spec, g, ctx) => {
    if (spec == null) return true;
    const val = (x) => (x !== null && typeof x === 'object') ? g.amt(x, ctx) : x;
    if (spec.min != null && v < val(spec.min)) return false;
    if (spec.max != null && v > val(spec.max)) return false;
    if (spec.eq != null && v !== val(spec.eq)) return false;
    if (spec.lt != null && !(v < val(spec.lt))) return false;
    if (spec.gt != null && !(v > val(spec.gt))) return false;
    return true;
  };
  G.matchFilter = function (c, f, ctx) {
    if (!f) return true;
    if (f.anyOf) { if (!f.anyOf.some(x => this.matchFilter(c, x, ctx))) return false; }
    const type = c.def.type;
    if (f.type && !f.type.includes(type) && !(c.isToken && f.type.includes('Token'))) return false;
    if (f.typeNot && f.typeNot.includes(type)) return false;
    if (f.magicType && !f.magicType.includes(c.def.magicType)) return false;
    if (f.symbol) { const s = this.symbolsOf(c); if (!f.symbol.some(x => s.includes(x))) return false; }
    if (f.symbolNot) { const s = this.symbolsOf(c); if (f.symbolNot.some(x => s.includes(x))) return false; }
    if (f.color) { const s = this.colorsOf(c); if (!f.color.some(x => s.includes(x) || s.includes('all'))) return false; }
    if (f.colorNot) { const s = this.colorsOf(c); if (f.colorNot.some(x => s.includes(x))) return false; }
    if (f.nameIs) { const n = this.namesOf(c); if (!f.nameIs.some(x => n.includes(x))) return false; }
    if (f.nameHas) { const n = this.namesOf(c); if (!f.nameHas.some(w => n.some(x => nameHasWord(x, w)))) return false; }
    if (f.nameHasNot) { const n = this.namesOf(c); if (f.nameHasNot.some(w => n.some(x => nameHasWord(x, w)))) return false; }
    if (f.nameNot) { const n = this.namesOf(c); if (f.nameNot.some(x => n.includes(x))) return false; }
    if (f.textHas) { const t = c.def.text || ''; if (!f.textHas.some(x => t.includes(x))) return false; }
    if (f.cost && !cmp(this.effectiveCost(c), f.cost, this, ctx)) return false;
    if (f.gem && !cmp(this.gemOf(c), f.gem, this, ctx)) return false;
    if (f.power && !cmp(this.getPower(c), f.power, this, ctx)) return false;
    if (f.state && c.state !== (f.state === 'awake' ? 'awake' : 'rested')) return false;
    if (f.onlyOne === false && c.def.flags.onlyOne) return false;
    if (f.onlyOne === true && !c.def.flags.onlyOne) return false;
    if (f.isToken != null && !!c.isToken !== f.isToken) return false;
    if (f.equipped != null && (c.equipped.length > 0) !== f.equipped) return false;
    if (f.notThis && ctx && ctx.src === c) return false;
    if (f.hasKeyword && !f.hasKeyword.some(k => this.hasKw(c, k))) return false;
    if (f.equippedTo && !(c.host && this.matchFilter(c.host, f.equippedTo, ctx))) return false;
    if (f.equippedWith) {
      const n = c.equipped.filter(e => this.matchFilter(e, f.equippedWith.filter, ctx)).length;
      if (n < (f.equippedWith.min || 1)) return false;
    }
    if (f.printedOwner === 'self' && ctx && c.owner !== ctx.controller) return false;
    if (f.printedOwner === 'enemy' && ctx && c.owner === ctx.controller) return false;
    if (f.ownedBy === 'self' && ctx && c.owner !== ctx.controller) return false;
    if (f.ownedBy === 'enemy' && ctx && c.owner === ctx.controller) return false;
    if (f.inPartner != null && !!c.inPartner !== f.inPartner) return false;
    if (f.donjai != null && !!c.def.flags.donjai !== f.donjai) return false;
    if (f.noText && (this.abilitiesOf(c).filter(a => a.kind !== 'rule').length > 0)) return false;
    if (f.battling != null) { const b = this.battle; const inB = !!b && (b.attacker === c || b.target === c); if (inB !== f.battling) return false; }
    if (f.summonedThisTurn != null && ((c.summonedTurn === this.turn) !== f.summonedThisTurn)) return false;
    if (f.summonedFrom && c.summonedFrom !== f.summonedFrom) return false;
    return true;
  };
  /* Thai text has no spaces, so a quoted word is matched as a substring of the card name,
   * except known compound words where the rule book says it is NOT a separate word (e.g. "นาย" in นายนิรยบาล / ทนาย). */
  const COMPOUNDS = { 'นาย': ['นายนิรยบาล', 'ทนาย'] };
  function nameHasWord(name, w) {
    let n = name;
    for (const comp of COMPOUNDS[w] || []) n = n.split(comp).join(' ');
    return n.includes(w);
  }

  G.refCards = function (ref, ctx) {
    const t = ctx.trigger || {};
    const b = this.battle;
    const one = (x) => (x ? [x] : []);
    if (typeof ref !== 'string') return [];
    if (ref.startsWith('chosen:')) return (ctx.chosen[ref.slice(7)] || []).slice();
    if (ref.startsWith('card:')) return ((ctx.src.flags['rem:' + ref.slice(5)]) || []).filter(c => c);
    switch (ref) {
      case 'this': return one(ctx.src);
      case 'host': return one(ctx.src.host);
      case 'attacker': return one((b && b.attacker) || t.attacker || t.self);
      case 'attackTarget': return one((b && b.target) || t.attackTarget);
      case 'battleOpponent': {
        if (b && b.attacker && b.target) return one(ctx.src === b.attacker ? b.target : b.attacker);
        return one(t.opponent);
      }
      case 'triggerCard': return one(t.triggerCard || t.self);
      case 'triggerSource': return one(t.source || t.triggerSource);
      case 'summonedCard': return one(t.summonedCard || t.self);
      case 'equippedCards': return ctx.src.equipped.slice();
      case 'partner': return one(ctx.src.partnerWith);
      case 'revealedLife': return one(t.card || t.self);
      case 'costPaidCards': return (t.costPaid || ctx.costPaid || []).slice();
      case 'lastMoved': return (ctx.lastMoved || []).slice();
      default: return [];
    }
  };

  G.candidates = function (sel, ctx) {
    if (sel.ref) {
      let r = this.refCards(sel.ref, ctx);
      if (sel.filter) r = r.filter(c => this.matchFilter(c, sel.filter, ctx));
      return r;
    }
    const zones = sel.zones || [sel.zone || 'avatarZone'];
    const sides = this.sides(ctx.controller, sel.side || 'self');
    let out = [];
    for (const s of sides) for (const z of zones) {
      let list = this.arr(s, z);
      if (z === 'deck' && sel.top) list = list.slice(0, sel.top);
      out.push(...list);
    }
    out = out.filter(c => this.matchFilter(c, sel.filter, ctx) && !(sel.filter && sel.filter.notThis && c === ctx.src));
    if (sel.lowest || sel.highest) {
      const stat = sel.lowest || sel.highest;
      const val = (c) => stat === 'power' ? this.getPower(c) : stat === 'gem' ? this.gemOf(c) : this.effectiveCost(c);
      if (out.length) {
        const ext = (sel.lowest ? Math.min : Math.max)(...out.map(val));
        out = out.filter(c => val(c) === ext);
      }
    }
    return out;
  };

  G.reqCount = function (sel, n) {
    const c = sel.count;
    if (c === 'all') return { min: n, max: n, all: true };
    if (c == null) return { min: Math.min(1, n), max: 1 };
    if (typeof c === 'number') return { min: Math.min(c, n), max: Math.min(c, n) };
    if (c.upTo != null) return { min: 0, max: Math.min(this.amt(c.upTo, {}), n) };
    return { min: Math.min(c.min || 0, n), max: Math.min(c.max == null ? n : c.max, n) };
  };

  G.select = async function (sel, ctx, hint) {
    if (!sel) return [];
    let cands = this.candidates(sel, ctx);
    // protections vs targeting
    if (sel.zone === 'avatarZone' || sel.zone === 'field' || sel.zones) {
      const enemySide = sel.side === 'enemy' || sel.side === 'any' || sel.side === 'both';
      if (enemySide && hint !== 'static') cands = cands.filter(c => !(c.ctrl !== ctx.controller && this.isProtected(c, 'targeting', ctx.src)));
    }
    let res;
    const rc = this.reqCount(sel, cands.length);
    if (rc.all || cands.length === 0) res = cands;
    else if (sel.ref) res = cands;
    else if (rc.min === cands.length && rc.max === cands.length && !sel.distinctNames && !sel.totalCost) res = cands;
    else {
      const chooser = sel.chooser || 'controller';
      if (chooser === 'random') {
        const tmp = cands.slice(); this.shuffle(tmp); res = tmp.slice(0, rc.max);
      } else {
        const who = chooser === 'opponent' ? 1 - ctx.controller : chooser === 'owner' ? (ctx.src ? ctx.src.owner : ctx.controller) : ctx.controller;
        const ids = await this.ask(who, {
          kind: 'pick', prompt: (ctx.prompt || ctx.ab && ctx.ab.text || 'เลือกการ์ด').slice(0, 200), cards: cands.map(c => c.uid),
          min: rc.min, max: rc.max, hint: hint || 'neutral', ctxCard: ctx.src ? ctx.src.uid : null,
          validate: (uids) => {
            const cs = uids.map(u => cands.find(c => c.uid === u)).filter(Boolean);
            if (sel.distinctNames && new Set(cs.map(c => this.namesOf(c)[0])).size !== cs.length) return false;
            if (sel.distinctSymbols && new Set(cs.map(c => this.symbolsOf(c)[0])).size !== cs.length) return false;
            if (sel.totalCost && cs.reduce((a, c) => a + this.effectiveCost(c), 0) > this.amt(sel.totalCost.max, ctx)) return false;
            return true;
          },
        });
        res = ids.map(u => cands.find(c => c.uid === u)).filter(Boolean);
      }
    }
    if (sel.as) ctx.chosen[sel.as] = res;
    if (sel.remember) ctx.src.flags['rem:' + sel.remember] = res.slice();
    return res;
  };

  G.amt = function (a, ctx) {
    if (a == null) return 0;
    if (typeof a === 'number') return a;
    if (a.count) {
      let n = this.candidates(a.count, ctx).length;
      if (a.per) n = Math.floor(n / a.per);
      n = n * (a.times == null ? 1 : a.times) + (a.plus || 0);
      if (a.max != null) n = Math.min(n, a.max);
      return n;
    }
    if (a.stat) {
      const cs = this.candidates(a.of || { ref: 'this' }, ctx);
      const v = (c) => a.stat === 'power' ? this.getPower(c) : a.stat === 'gem' ? this.gemOf(c) : a.stat === 'cost' ? this.effectiveCost(c)
        : a.stat === 'printedPower' || a.stat === 'basePower' ? (c.def.power || 0) : 0;
      return cs.reduce((s, c) => s + v(c), 0);
    }
    if (a.lifeFaceUp != null) {
      const pls = playersOf(this, ctx, a.lifeFaceUp);
      let n = 0; for (const p of pls) n += this.players[p].life.filter(c => c.faceUp).length;
      return n * (a.times == null ? 1 : a.times);
    }
    if (a.handCount != null) { let n = 0; for (const p of playersOf(this, ctx, a.handCount)) n += this.players[p].hand.length; return n; }
    if (a.x != null) return ctx.vars.x || 0;
    if (a.minus) return this.amt(a.minus[0], ctx) - this.amt(a.minus[1], ctx);
    if (a.sum) return a.sum.reduce((s, x) => s + this.amt(x, ctx), 0);
    return 0;
  };

  const CMP = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '>': (a, b) => a > b, '<': (a, b) => a < b, '!=': (a, b) => a !== b };
  G.condAll = function (list, ctx) { return (list || []).every(c => this.cond(c, ctx)); };
  G.cond = function (c, ctx) {
    if (!c) return true;
    switch (c.cond) {
      case 'count': {
        const n = this.candidates(c.of, ctx).length;
        return CMP[c.op](n, this.amt(c.n, ctx));
      }
      case 'compare': return CMP[c.op](this.amt(c.left, ctx), this.amt(c.right, ctx));
      case 'landIs': return this.land.some(l => this.matchFilter(l, c.filter, ctx));
      case 'thisState': return ctx.src.state === c.state;
      case 'thisInZone': return ZONE_OK[c.zone] ? ZONE_OK[c.zone](ctx.src) : false;
      case 'thisHasEquip': return ctx.src.equipped.filter(e => this.matchFilter(e, c.filter, ctx)).length >= (c.min || 1);
      case 'thisIsEquipped': return !!ctx.src.host && (!c.hostFilter || this.matchFilter(ctx.src.host, c.hostFilter, ctx));
      case 'thisInPartner': return !!ctx.src.inPartner;
      case 'thisSummonedBy': {
        const t = ctx.trigger || {};
        if (c.paid != null && !!t.paid !== c.paid) return false;
        if (c.exactGem != null && !!t.exactGem !== c.exactGem) return false;
        if (c.sourceFilter && !(t.byAbilityOf && this.matchFilter(t.byAbilityOf, c.sourceFilter, ctx))) return false;
        return true;
      }
      case 'turn': return c.whose === 'any' || (c.whose === 'own' ? this.active === ctx.controller : this.active !== ctx.controller);
      case 'phase': return this.phase === c.phase;
      case 'critical': return playersOf(this, ctx, c.player).every(p => this.isCritical(p));
      case 'lifeFaceUp': { let n = 0; for (const p of playersOf(this, ctx, c.player)) n += this.players[p].life.filter(x => x.faceUp).length; return CMP[c.op](n, c.n); }
      case 'magicUsedThisTurn': {
        const used = !!this.magicUsed[c.magicType];
        return c.used === false ? !used : used;
      }
      case 'milledThisTurn': return playersOf(this, ctx, c.player || 'self').some(p => this.players[p].milledTurn === this.turn);
      case 'hostMatches': return !!ctx.src.host && this.matchFilter(ctx.src.host, c.filter, ctx);
      case 'triggerMatches': { const t = (ctx.trigger || {}); const x = t.triggerCard || t.self; return !!x && this.matchFilter(x, c.filter, ctx); }
      case 'triggerSourceMatches': { const t = ctx.trigger || {}; const x = t.source; return !!x && this.matchFilter(x, c.filter, ctx); }
      case 'resultOf': { const r = ctx.results && ctx.results[c.as]; return c.success === false ? !r : !!r; }
      case 'not': return !this.cond(c.of, ctx);
      case 'all': return c.of.every(x => this.cond(x, ctx));
      case 'any': return c.of.some(x => this.cond(x, ctx));
      case 'firstOwnTurn': return this.ownTurnCount(ctx.controller) === 1 && this.active === ctx.controller;
      case 'turnNumber': return CMP[c.op](this.ownTurnCount(ctx.controller), c.n);
      case 'onFieldSince': return ctx.src.summonedTurn >= 0 && (this.turn - ctx.src.summonedTurn) >= (c.minTurns || 0);
      case 'inBattle': { const b = this.battle; if (!b) return false; const x = ctx.src === b.attacker ? b.target : ctx.src === b.target ? b.attacker : null; return !!x && (!c.filter || this.matchFilter(x, c.filter, ctx)); }
      default: return false;
    }
  };
  G.ownTurnCount = function (pi) { return (this.ownTurns && this.ownTurns[pi]) || 0; };
})(typeof window !== 'undefined' ? window : globalThis);
