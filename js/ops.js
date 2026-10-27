'use strict';
/* DSL ops, triggers, response windows. Extends TAL.Game. */
(function (root) {
  const TAL = root.TAL;
  const G = TAL.Game.prototype;
  const FIELD = TAL.FIELD;
  const OPS = {};
  TAL.OPS = OPS;

  const pls = (g, ctx, who) => {
    switch (who) {
      case 'self': case undefined: case 'controller': case 'chooser': return [ctx.controller];
      case 'enemy': return [1 - ctx.controller];
      case 'both': case 'any': return [ctx.controller, 1 - ctx.controller];
      case 'owner': return [ctx.src ? ctx.src.owner : ctx.controller];
      default: return [ctx.controller];
    }
  };
  G.playersOf = function (ctx, who) { return pls(this, ctx, who); };
  const isAv = (c) => c.def.type === 'Avatar';

  /* ---------------------------------------------------------------- */
  G.runOps = async function (ops, ctx) {
    for (const op of ops || []) { await this.runOp(op, ctx); }
  };
  G.runOp = async function (op, ctx) {
    const f = OPS[op.op];
    if (!f) { this.log('(ไม่รองรับ op ' + op.op + ')'); return; }
    await f(this, op, ctx);
    if (op.as) {
      ctx.results = ctx.results || {};
      if (!(op.as in ctx.results)) ctx.results[op.as] = (ctx.chosen[op.as] || []).length > 0;
    }
    this.checkEnd();
  };

  const hintOf = (op, ctx, sel) => {
    const side = sel && sel.side;
    if (['destroy', 'exile', 'sacrifice'].includes(op.op)) return side === 'enemy' ? 'harm' : (side === 'self' || !side ? 'cost' : 'harm');
    if (op.op === 'discard') return 'cost';
    if (op.op === 'modifyPower') { const a = typeof op.amount === 'number' ? op.amount : 1; return (a < 0) === (side === 'enemy') ? 'help' : 'harm'; }
    if (op.op === 'move') return side === 'enemy' ? 'harm' : 'neutral';
    if (op.op === 'summon' || op.op === 'equip') return 'help';
    return 'neutral';
  };

  /* ---------------------------------------------------------------- */
  /* feasibility (a spell/ability cannot be used if it cannot be carried out) */
  G.feasible = function (ops, ctx) {
    for (const op of ops || []) if (!this.opFeasible(op, ctx)) return false;
    return true;
  };
  G.selFeasible = function (sel, ctx) {
    if (!sel || sel.ref) return true;
    const n = this.candidates(sel, ctx).length;
    const c = sel.count;
    if (c === 'all') return true;
    if (c && typeof c === 'object') return (c.min || 0) <= n;
    return n >= (c == null ? 1 : c);
  };
  G.opFeasible = function (op, ctx) {
    switch (op.op) {
      case 'discard': {
        if (op.all) return true;
        const n = this.amt(op.n, ctx);
        const pl = pls(this, ctx, op.player)[0];
        const c = this.players[pl].hand.filter(x => x !== ctx.src && this.matchFilter(x, op.filter, ctx)).length;
        return c >= n;
      }
      case 'mill': case 'draw': return this.players[pls(this, ctx, op.player)[0]].deck.length >= this.amt(op.n, ctx) || op.op === 'mill';
      case 'destroy': case 'exile': case 'sacrifice': case 'tap': case 'untap': case 'takeControl':
        return this.selFeasible(op.target, ctx);
      case 'summon': case 'summonThis': {
        const sideIdx = op.side === 'enemy' ? 1 - ctx.controller : ctx.controller;
        const cs = op.op === 'summonThis' ? [ctx.src] : this.candidates(op.target, ctx);
        if (op.op === 'summon' && op.target && !op.target.ref && !this.selFeasible(op.target, ctx)) return false;
        if (!cs.length) return op.op === 'summon' && !!(op.target && !op.target.ref);
        // room: skip the check when this ability frees room itself (cost/effects remove Avatars)
        const frees = [].concat(ctx.ab ? (ctx.ab.cost || []) : [], ctx.ab ? (ctx.ab.effects || []) : []).some(o => ['destroy', 'move', 'sacrifice', 'exile'].includes(o.op) && o !== op);
        if (!frees && !cs.some(c => this.avatarRoom(sideIdx, c))) return false;
        if ((op.payCost || op.free === false) && !cs.some(c => this.canPay(ctx.controller, c))) return false;
        return true;
      }
      case 'move': return this.selFeasible(op.target, ctx);
      case 'equip': return this.selFeasible(op.card, ctx) && this.selFeasible(op.host, ctx);
      case 'modifyPower': case 'setPower': case 'grantKeyword': case 'protect': case 'changeName': case 'changeSymbol': case 'changeColor':
        return !op.target || op.target.ref || this.selFeasible(op.target, ctx);
      case 'if': return this.cond(op.cond, ctx) ? this.feasible(op.then, ctx) : this.feasible(op.else, ctx);
      case 'choose': return (op.options || []).some(o => this.condAll(o.conditions, ctx) && this.feasible(o.effects, ctx));
      default: return true;
    }
  };

  /* ---------------------------------------------------------------- */
  /* ability use limits / costs */
  G.limitOk = function (c, ab) {
    const nl = this.nameLimit(c, ab);
    if (nl && ((this.nameUses && this.nameUses[nl.key + '|' + this.turn]) || 0) >= nl.n) return false;
    const lim = ab.limit;
    if (lim) {
      const u = c.used[ab.id];
      const n = lim.n || 1;
      if (u) {
        if (lim.per === 'turn' && u.turn === this.turn && u.n >= n) return false;
        if (lim.per === 'game' && u.n >= n) return false;
      }
    }
    if ((ab.keywords || []).includes('เทิร์นละครั้ง') && !lim) {
      const u = c.used[ab.id]; if (u && u.turn === this.turn) return false;
    }
    return true;
  };
  /* "#สามารถใช้ความสามารถของ Avatar ชื่อ X ได้ เทิร์นละ 1 ครั้ง" - a per-name limit shared by every copy */
  G.nameLimit = function (c, ab) {
    if (['rule', 'keyword', 'continuous', 'equipRestriction', 'partner', 'lifeReveal'].includes(ab.kind)) return null;
    for (const r of this.db.byCard[c.id] || []) {
      if (r.kind !== 'rule') continue;
      for (const e of r.effects || []) if (e.op === 'rule.abilityUseLimit' && e.per === 'turn' && this.namesOf(c).includes(e.name)) return { key: c.ctrl + '|' + e.name, n: e.n || 1 };
    }
    return null;
  };
  G.markUsed = function (c, ab) {
    const nl = this.nameLimit(c, ab);
    if (nl) { this.nameUses = this.nameUses || {}; const k = nl.key + '|' + this.turn; this.nameUses[k] = (this.nameUses[k] || 0) + 1; }
    const u = c.used[ab.id];
    if (u && (ab.limit && ab.limit.per === 'game' || u.turn === this.turn)) u.n++;
    else c.used[ab.id] = { turn: this.turn, n: 1 };
  };

  /* ---------------------------------------------------------------- */
  /* destroy / summon / equip / life helpers */
  G.destroy = async function (c, opts) {
    opts = opts || {};
    if (!this.isOnField(c)) return false;
    const cause = opts.cause || 'ability';
    const from = cause === 'battle' ? 'battleDestroy' : 'abilityDestroy';
    if (this.isProtected(c, 'destroy', opts.source) || this.isProtected(c, from, opts.source) ||
        (opts.source && c.ctrl !== opts.source.ctrl && this.isProtected(c, 'enemyAbilityDestroy', opts.source) && cause !== 'battle')) {
      this.log(`${c.def.name} ไม่ถูกทำลาย (ป้องกัน)`); return false;
    }
    const rec = { card: c, cause, prevented: false };
    const saved = this.pendingDestroy; this.pendingDestroy = rec;
    const base = { self: c, triggerCard: c, cause, source: opts.source, bySide: opts.source ? opts.source.ctrl : undefined, side: c.ctrl };
    try {
      await this.event('self.wouldBeDestroyed', base);
      await this.event(isAv(c) ? 'any.avatarWouldBeDestroyed' : 'any.wouldBeDestroyed', base);
      if (c.host == null) await this.event('host.wouldBeDestroyed', base);
    } finally { this.pendingDestroy = saved; }
    if (rec.prevented || !this.isOnField(c)) return false;
    const ctrl = c.ctrl;
    this.log(`${c.def.name} ถูกทำลาย`);
    await this.sendTo(c, 'hell', { cause: 'destroy' });
    const ev = { self: c, triggerCard: c, cause, bySource: opts.source, source: opts.source, bySide: base.bySide, fromZone: c.leftFrom, side: ctrl };
    await this.fire('self.destroyed', ev);
    await this.fire('host.destroyed', ev);
    await this.event(isAv(c) ? 'any.avatarDestroyed' : 'any.leavesField', ev);
    return true;
  };

  G.avatarRoom = function (pi, c) {
    const pl = this.players[pi];
    if (pl.avatarZone.length >= 6) return false;
    if (!c.isToken && pl.avatarZone.filter(x => !x.isToken).length >= 4) return false;
    return true;
  };

  G.summonCard = async function (c, o) {
    o = o || {};
    const ctrl = o.side != null ? o.side : c.owner;
    if (!isAv(c)) return false;
    if (!this.avatarRoom(ctrl, c)) return false;
    if (this.restricted(ctrl, 'summon')) return false;
    const fromZone = c.zone;
    if (fromZone === 'magicZone' && c.host) {
      const h = c.host; h.equipped = h.equipped.filter(x => x !== c); c.host = null;
      this.removeFromZone(c);
    } else if (this.isOnField(c)) { this.removeFromZone(c); }
    else this.removeFromZone(c);
    this.placeIn(c, 'avatarZone', ctrl);
    c.state = o.state === 'rested' ? 'rested' : 'awake';
    c.summonedTurn = this.turn; c.summonedFrom = fromZone;
    this.log(`${this.players[ctrl].name} อัญเชิญ ${c.def.name}`);
    const paid = !!(o.paid || o.asJuti);
    const ev = { self: c, summonedCard: c, triggerCard: c, paid, exactGem: !!o.exactGem, byAbilityOf: o.byAbilityOf, fromZone, asJuti: !!o.asJuti, costPaid: o.costPaid, side: ctrl, actor: ctrl };
    await this.event('self.summoned', ev);
    if (this.isOnField(c)) await this.event('any.avatarSummoned', ev);
    return true;
  };

  G.canEquip = function (c, host, ctx) {
    if (!host || !isAv(host)) return false;
    if (c.def.type === 'Magic' && c.def.magicType !== 'Modification' && !c.isEquipLike) { /* generic cards may equip via ability */ }
    for (const ab of this.abilitiesOf(c, true)) {
      if (ab.kind === 'equipRestriction' && ab.hostFilter && !this.matchFilter(host, ab.hostFilter, { src: c, controller: c.ctrl })) return false;
      for (const e of ab.effects || []) if (e.op === 'rule.cannotEquip') return false;
    }
    if (this.cardRestricted(host, 'equip', c)) return false;
    return true;
  };
  G.equipCard = async function (c, host, ctx) {
    if (!this.canEquip(c, host, ctx)) return false;
    const fromZone = c.zone;
    if (c.host) { c.host.equipped = c.host.equipped.filter(x => x !== c); c.host = null; }
    if (this.isOnField(c)) this.removeFromZone(c); else this.removeFromZone(c);
    this.placeIn(c, 'magicZone', host.ctrl);
    c.host = host; host.equipped.push(c);
    c.faceUp = false;
    this.log(`${c.def.name} สวมใส่ให้ ${host.def.name}`);
    await this.fire('self.equipped', { self: c, host, hostFilter: null, triggerCard: c });
    await this.fire('self.equipReceived', { self: host, triggerCard: c });
    return true;
  };

  /* LIFE */
  G.revealTopLife = async function (pi, opts) {
    opts = opts || {};
    const pl = this.players[pi];
    const c = pl.life.find(x => !x.faceUp);
    if (!c) return null;
    c.faceUp = true;
    this.log(`${pl.name} LIFE ถูกหงาย: ${c.def.name}`);
    if (opts.triggers !== false) {
      const lev = { self: c, card: c, triggerCard: c, attacker: opts.attacker, side: pi };
      await this.fire('self.revealedByAttack', lev);
      if (!opts.byAttack) await this.fire('self.revealedByDamage', lev);
    }
    await this.fire('any.lifeRevealed', { side: pi, byAttack: !!opts.byAttack, card: c, triggerCard: c, attacker: opts.attacker });
    return c;
  };
  G.damageLife = async function (pi, n, opts) {
    opts = opts || {};
    for (let i = 0; i < n; i++) {
      if (this.isCritical(pi)) { this.log(`${this.players[pi].name} ถูกโจมตี LIFE ขณะสาหัส -> แพ้`); this.win(1 - pi, 'life'); }
      await this.revealTopLife(pi, { byAttack: opts.byAttack, attacker: opts.attacker });
    }
  };

  /* ---------------------------------------------------------------- */
  /* triggers */
  const side = (g, c, s, p) => s === 'any' || s == null || (s === 'self' ? p === c.ctrl : s === 'enemy' ? p !== c.ctrl : true);
  function paramsMatch(g, name, params, c, ab, e) {
    if (!params) return true;
    const trigCard = e.triggerCard || e.self;
    for (const [k, v] of Object.entries(params)) {
      switch (k) {
        case 'side': if (!side(g, c, v, e.side)) return false; break;
        case 'filter': if (!trigCard || !g.matchFilter(trigCard, v, { src: c, controller: c.ctrl })) return false; break;
        case 'attackerFilter': if (!e.attacker || !g.matchFilter(e.attacker, v, { src: c, controller: c.ctrl })) return false; break;
        case 'targetFilter': if (!e.attackTarget || !g.matchFilter(e.attackTarget, v, { src: c, controller: c.ctrl })) return false; break;
        case 'opponentFilter': if (!e.opponent || !g.matchFilter(e.opponent, v, { src: c, controller: c.ctrl })) return false; break;
        case 'destroyerFilter': case 'bySource': case 'sourceFilter':
          if (!e.source || !g.matchFilter(e.source, v, { src: c, controller: c.ctrl })) return false; break;
        case 'byAbilityOf': if (!e.byAbilityOf || !g.matchFilter(e.byAbilityOf, v, { src: c, controller: c.ctrl })) return false; break;
        case 'forFilter': if (!e.forCard || !g.matchFilter(e.forCard, v, { src: c, controller: c.ctrl })) return false; break;
        case 'hostFilter': if (!e.host || !g.matchFilter(e.host, v, { src: c, controller: c.ctrl })) return false; break;
        case 'targetKind': if (v !== 'any' && e.targetKind !== v) return false; break;
        case 'magicType': if (!v.includes(e.magicType)) return false; break;
        case 'cause': if (v !== 'any' && e.cause !== v && !(e.cause === 'sacrifice' && v === 'ability')) return false; break;
        case 'fromZone': if (e.fromZone !== v) return false; break;
        case 'paid': if (v !== 'any' && !!e.paid !== v) return false; break;
        case 'exactGem': if (!!e.exactGem !== v) return false; break;
        case 'asJuti': if (!!e.asJuti !== v) return false; break;
        case 'bySide': if (e.bySide == null ? v !== 'any' : !side(g, c, v, e.bySide)) return false; break;
        case 'phase': if (g.phase !== v && e.phase !== v) return false; break;
        case 'turn': if (!(v === 'any' || (v === 'own' ? g.active === c.ctrl : g.active !== c.ctrl))) return false; break;
        case 'byAttack': if (!!e.byAttack !== v) return false; break;
        case 'outsideDrawPhase': if (!!e.outsideDrawPhase !== v) return false; break;
        case 'keyword': { const ks = Array.isArray(v) ? v : [v]; if (!e.keyword || !ks.includes(e.keyword)) return false; break; }
        case 'sourceType': if (!e.sourceCard || !v.includes(e.sourceCard.def.type)) return false; break;
        case 'byAbility': if (!!e.byAbility !== v) return false; break;
        case 'duringPhase': if (e.duringPhase !== v) return false; break;
        default: break;
      }
    }
    return true;
  }
  G.matchTrigger = function (c, ab, name, e) {
    if (name.startsWith('self.')) { if (e.self !== c) return false; }
    else if (name.startsWith('host.')) { if (!(c.host && c.host === e.self)) return false; }
    let zok = this.abilityZoneOk(c, ab);
    if (!zok && /leavesField$/.test(name) && e.fromZone) zok = ab.zone === e.fromZone || (ab.zone === 'field' && FIELD.includes(e.fromZone));
    if (!zok) return false;
    if (this.cardNoAbilities(c) && ab.kind !== 'rule') return false;
    return paramsMatch(this, name, ab.trigger.params, c, ab, e);
  };
  G.gatherTriggers = function (name, e) {
    const out = [];
    const seen = new Set();
    const consider = (c, ab) => {
      const key = c.uid + ':' + ab.id;
      if (seen.has(key)) return; seen.add(key);
      if (ab.trigger.event !== name) return;
      if (!this.matchTrigger(c, ab, name, e)) return;
      out.push({ c, ab });
    };
    for (const ab of this.db.byEvent[name] || []) for (const c of this.cardsById[ab.card] || []) consider(c, ab);
    for (const c of this.allInPlay()) {
      for (const g of c.grants) if (g.ability.trigger) consider(c, g.ability);
      if (c.def.tokenAbilities) for (const ab of c.def.tokenAbilities) if (ab.trigger) consider(c, ab);
    }
    return out;
  };
  G.triggerCtx = function (c, ab, e) {
    return { src: c, ab, controller: c.ctrl, chosen: {}, vars: {}, trigger: e, results: {}, item: e && e.item };
  };
  G.fire = async function (name, e) {
    const items = this.gatherTriggers(name, e);
    if (!items.length) return;
    items.sort((a, b) => (a.c.ctrl === this.active ? 0 : 1) - (b.c.ctrl === this.active ? 0 : 1));
    for (const { c, ab } of items) {
      if (ab.kind === 'lifeReveal') { this.players[c.owner].pendingLife.push({ c, ab, e }); continue; }
      if (ab.kind !== 'triggered' && ab.kind !== 'keyword' && ab.kind !== 'continuous' && ab.kind !== 'rule') {
        continue; // react / activated handled in windows
      }
      if (ab.kind === 'continuous' || ab.kind === 'rule') continue;
      await this.runTriggered(c, ab, e);
    }
  };
  G.runTriggered = async function (c, ab, e) {
    const ctx = this.triggerCtx(c, ab, e);
    if (ab.conditions && ab.conditions.length && !this.condAll(ab.conditions, ctx)) return;
    if (!this.limitOk(c, ab)) return;
    if (ab.optional) {
      const yes = await this.ask(c.ctrl, { kind: 'confirm', prompt: `ใช้ความสามารถ? ${ab.text}`.slice(0, 220), ctxCard: c.uid });
      if (!yes) return;
    }
    if (!(await this.payAbilityCost(ab, ctx))) return;
    this.markUsed(c, ab);
    this.log(`ความสามารถ ${c.def.name}: ${(ab.text || '').slice(0, 60)}`);
    if (ab.modes && ab.modes.length) await this.runModes(ab, ctx); else await this.runOps(ab.effects, ctx);
  };
  G.runModes = async function (ab, ctx) {
    const opts = ab.modes.filter(m => this.condAll(m.conditions, ctx) && this.feasible(m.effects, ctx));
    if (!opts.length) return;
    let pick = opts[0];
    const both = opts.find(m => /\+/.test(String(m.label)));
    if (both) pick = both;
    else if (opts.length > 1) {
      const ids = await this.ask(ctx.controller, { kind: 'options', prompt: 'เลือกความสามารถ', options: opts.map((m, i) => ({ id: i, label: m.label })), min: 1, max: 1, ctxCard: ctx.src.uid });
      pick = opts[ids[0]] || opts[0];
    }
    await this.runOps(pick.effects, ctx);
  };
  G.payAbilityCost = async function (ab, ctx) {
    if (!ab.cost || !ab.cost.length) return true;
    if (!this.feasible(ab.cost, ctx)) return false;
    await this.runOps(ab.cost, ctx);
    return true;
  };

  /* life reveal queue */
  G.resolvePendingLife = async function (pi) {
    const pl = this.players[pi];
    while (pl.pendingLife.length) {
      const q = pl.pendingLife.shift();
      const ctx = this.triggerCtx(q.c, q.ab, q.e);
      ctx.controller = q.c.owner;
      if (q.ab.conditions && q.ab.conditions.length && !this.condAll(q.ab.conditions, ctx)) continue;
      this.log(`LIFE ${q.c.def.name} ทำงาน`);
      await this.runOps(q.ab.effects, ctx);
    }
  };

  /* ---------------------------------------------------------------- */
  /* events with response windows */
  const WINDOWED = new Set(['self.summoned', 'any.avatarSummoned', 'any.attackDeclared', 'self.declaresAttack', 'self.wouldBeDestroyed',
    'any.avatarWouldBeDestroyed', 'any.wouldBeDestroyed', 'host.wouldBeDestroyed', 'any.avatarDestroyed', 'any.magicUsed', 'any.abilityUsed',
    'any.battles', 'self.battles', 'self.attackTargeted', 'any.attackRedirected', 'phase.end', 'phase.start', 'any.leavesField', 'any.destroysInBattle', 'self.battleEnds']);
  const DEFAULT_WINDOW = new Set(['any.avatarSummoned', 'any.attackDeclared', 'any.magicUsed', 'any.abilityUsed', 'phase.end']);
  G.event = async function (name, e) {
    await this.fire(name, e);
    if (WINDOWED.has(name) && this.depth < 6) await this.responseWindow(name, e);
  };
  G.offers = function (pi, name, e) {
    const out = [];
    const cards = this.players[pi].hand.concat(this.allInPlay().filter(c => c.ctrl === pi), this.players[pi].hell, this.players[pi].dark);
    const isDefault = DEFAULT_WINDOW.has(name);
    for (const c of cards) {
      for (const ab of this.abilitiesOf(c)) {
        if (ab.kind !== 'react' && ab.kind !== 'activated') continue;
        const ev = ab.trigger && ab.trigger.event;
        if (!ev) {
          // timed activations usable in the other player's / any player's phase (e.g. "Main Phase ผู้เล่นใดก็ได้")
          const t = ab.timing;
          if (ab.kind === 'activated' && t && name === 'phase.end' && e.phase === this.phase && (t.turn === 'any' || t.turn === 'enemy') &&
              (!t.phases || t.phases.includes(this.phase)) && (t.turn === 'any' || this.active !== pi) && this.abilityZoneOk(c, ab) && this.canUseAbility(pi, c, ab, e)) out.push({ c, ab });
          continue;
        }
        if (ev !== name && !(ev === 'window.default' && isDefault && e.actor !== pi)) continue;
        if (!this.abilityZoneOk(c, ab)) continue;
        if (ev === name && !this.matchTrigger(c, ab, name, Object.assign({}, e))) {
          // matchTrigger enforces self./host. scoping; for any.* checks params
          continue;
        }
        if (this.canUseAbility(pi, c, ab, e)) out.push({ c, ab });
      }
    }
    return out;
  };
  G.responseWindow = async function (name, e) {
    const order = [1 - this.active, this.active];
    for (const pi of order) {
      if (this.over) return;
      const offers = this.offers(pi, name, e);
      if (!offers.length) continue;
      const ids = await this.ask(pi, {
        kind: 'respond', prompt: 'ตอบโต้?', event: name, ctxInfo: e && e.info, min: 0, max: 1,
        options: offers.map((o, i) => ({ id: i, card: o.c.uid, label: o.c.def.name, text: (o.ab.text || '').slice(0, 140) })),
      });
      if (ids && ids.length) {
        const o = offers[ids[0]];
        if (o) { this.depth++; try { await this.useAbility(pi, o.c, o.ab, e); } finally { this.depth--; } }
      }
    }
  };

  /* ================================================================ */
  /* OPS                                                               */
  /* ================================================================ */
  OPS.draw = async (g, op, ctx) => { for (const p of pls(g, ctx, op.player)) await g.draw(p, g.amt(op.n, ctx)); };
  OPS.mill = async (g, op, ctx) => { for (const p of pls(g, ctx, op.player)) await g.mill(p, g.amt(op.n, ctx)); };
  OPS.shuffleDeck = async (g, op, ctx) => { for (const p of pls(g, ctx, op.player)) g.shuffle(g.players[p].deck); };
  OPS.revealHand = async () => {};
  OPS.revealFromHand = async () => {};
  OPS.consumeMagicQuota = async (g, op) => { g.magicUsed[op.magicType] = true; };
  OPS.addMagicQuota = async (g, op, ctx) => {
    for (const p of pls(g, ctx, op.player)) { const pl = g.players[p]; pl.quotaMods = pl.quotaMods || []; pl.quotaMods.push({ type: op.magicType, n: op.n, filter: op.filter }); }
  };

  OPS.discard = async (g, op, ctx) => {
    for (const p of pls(g, ctx, op.player)) {
      const pl = g.players[p];
      let cands = pl.hand.filter(c => c !== ctx.src && g.matchFilter(c, op.filter, ctx));
      let chosen;
      if (op.all) chosen = cands;
      else {
        const n = Math.min(g.amt(op.n, ctx), cands.length);
        if (n <= 0) { chosen = []; }
        else if (op.chooser === 'random') { const t = cands.slice(); g.shuffle(t); chosen = t.slice(0, n); }
        else if (cands.length === n && !op.gemTotal) chosen = cands;
        else {
          const who = op.chooser === 'opponent' ? 1 - p : p;
          const ids = await g.ask(who, { kind: 'pick', prompt: 'ทิ้งการ์ดจากมือ ' + n + ' ใบ', cards: cands.map(c => c.uid), min: n, max: n, hint: 'cost', ctxCard: ctx.src ? ctx.src.uid : null,
            validate: (uids) => !op.gemTotal || (() => { const s = uids.reduce((a, u) => a + g.gemOf(cands.find(c => c.uid === u)), 0); return (op.gemTotal.min == null || s >= op.gemTotal.min) && (op.gemTotal.exact == null || s === op.gemTotal.exact); })() });
          chosen = ids.map(u => cands.find(c => c.uid === u)).filter(Boolean);
        }
      }
      if (op.as) ctx.chosen[op.as] = chosen;
      for (const c of chosen) { g.log(`${pl.name} ทิ้ง ${c.def.name}`); await g.sendTo(c, 'hell', { cause: 'discard' }); }
      if (chosen.length) await g.fire('any.cardsDiscarded', { side: p, byAbility: true });
    }
  };

  OPS.scout = async (g, op, ctx) => {
    for (const p of pls(g, ctx, op.player)) {
      const pl = g.players[p];
      const n = Math.min(g.amt(op.n, ctx), pl.deck.length);
      const taken = op.fromBottom ? pl.deck.splice(pl.deck.length - n, n) : pl.deck.splice(0, n);
      taken.forEach(c => { c.zone = 'limbo'; });
      g.bump();
      g.log(`${pl.name} สอดแนม ${n} ใบ`);
      let pool = taken.slice();
      for (const c of taken) await g.fire('self.scouted', { self: c, triggerCard: c });
      for (const pk of op.pick || []) {
        const cands = pool.filter(c => g.matchFilter(c, pk.filter, ctx));
        if (!cands.length) continue;
        let k = pk.count == null ? 1 : pk.count;
        let min = typeof k === 'number' ? Math.min(k, cands.length) : 0, max = typeof k === 'number' ? Math.min(k, cands.length) : Math.min(k.upTo, cands.length);
        let chosen = cands;
        if (!(min === max && max === cands.length)) {
          const ids = await g.ask(pk.chooser === 'opponent' ? 1 - p : p, { kind: 'pick', prompt: 'เลือกการ์ดจากที่สอดแนม', cards: cands.map(c => c.uid), min, max, hint: 'help', ctxCard: ctx.src ? ctx.src.uid : null, reveal: true });
          chosen = ids.map(u => cands.find(c => c.uid === u)).filter(Boolean);
        }
        if (pk.as) ctx.chosen[pk.as] = chosen;
        pool = pool.filter(c => !chosen.includes(c));
        for (const c of chosen) {
          if (pk.to === 'avatarZone' || pk.summon) { if (!(await g.summonCard(c, { side: p, asJuti: pk.asJuti, state: pk.state, byAbilityOf: ctx.src }))) await g.sendTo(c, 'hell'); }
          else { await g.sendTo(c, pk.to); if (pk.state && c.zone === 'avatarZone') c.state = pk.state; }
        }
      }
      const rest = op.rest || 'deckBottom';
      for (const c of pool) {
        if (rest === 'deckBottomAnyOrder') await g.sendTo(c, 'deckBottom');
        else if (rest === 'deckTopAnyOrder') await g.sendTo(c, 'deckTop');
        else await g.sendTo(c, rest);
      }
    }
  };

  OPS.search = async (g, op, ctx) => {
    for (const p of pls(g, ctx, op.player)) {
      const pl = g.players[p];
      let cands = [];
      for (const z of op.from) cands.push(...g.arr(p, z));
      cands = cands.filter(c => c !== ctx.src && g.matchFilter(c, op.filter, ctx));
      let k = op.count == null ? 1 : op.count;
      let chosen = [];
      if (cands.length) {
        if (k === 'all') chosen = cands;
        else {
          const max = typeof k === 'number' ? Math.min(k, cands.length) : Math.min(k.upTo, cands.length);
          const min = typeof k === 'number' ? max : 0;
          if (min === max && max === cands.length) chosen = cands;
          else {
            const ids = await g.ask(p, { kind: 'pick', prompt: 'เลือกการ์ดจาก ' + op.from.join('/'), cards: cands.map(c => c.uid), min, max, hint: 'help', ctxCard: ctx.src ? ctx.src.uid : null, reveal: true });
            chosen = ids.map(u => cands.find(c => c.uid === u)).filter(Boolean);
          }
        }
      }
      if (op.as) ctx.chosen[op.as] = chosen;
      for (const c of chosen) {
        g.log(`${pl.name} ค้นหา ${c.def.name}`);
        if (op.to === 'avatarZone') await g.summonCard(c, { side: p, state: op.state, byAbilityOf: ctx.src });
        else { await g.sendTo(c, op.to, { cause: 'ability' }); if (op.state && c.zone === 'avatarZone') c.state = op.state; }
      }
      if (op.shuffle !== false && op.from.includes('deck')) g.shuffle(pl.deck);
    }
  };

  OPS.move = async (g, op, ctx) => {
    const cs = await g.select(op.target, ctx, hintOf(op, ctx, op.target));
    ctx.lastMoved = cs;
    for (const c of cs) {
      if (op.to === 'avatarZone') { await g.summonCard(c, { side: ctx.controller, byAbilityOf: ctx.src }); continue; }
      await g.sendTo(c, op.to, { cause: 'ability', bySide: ctx.controller });
    }
  };
  OPS.destroy = async (g, op, ctx) => {
    const cs = await g.select(op.target, ctx, hintOf(op, ctx, op.target));
    for (const c of cs) await g.destroy(c, { cause: 'ability', source: ctx.src });
  };
  OPS.sacrifice = OPS.destroy;
  OPS.exile = async (g, op, ctx) => {
    const cs = await g.select(op.target, ctx, hintOf(op, ctx, op.target));
    ctx.lastMoved = cs;
    for (const c of cs) await g.sendTo(c, 'dark', { cause: 'ability' });
  };

  OPS.summon = async (g, op, ctx) => {
    const sideIdx = op.side === 'enemy' ? 1 - ctx.controller : ctx.controller;
    const cs = await g.select(op.target, ctx, 'help');
    for (const c of cs) {
      if (op.payCost || op.free === false) {
        const opts = g.paymentOptions(ctx.controller, c);
        if (!opts.length) continue;
        const pay = await g.choosePayment(ctx.controller, c, opts);
        if (!pay) continue;
        for (const x of pay) { await g.sendTo(x, 'hell', { cause: 'cost' }); }
        await g.summonCard(c, { side: sideIdx, paid: true, asJuti: op.asJuti, exactGem: false, byAbilityOf: ctx.src, state: op.state, costPaid: pay });
      } else {
        await g.summonCard(c, { side: sideIdx, asJuti: op.asJuti, state: op.state, byAbilityOf: ctx.src });
      }
      if (op.as && c.zone === 'avatarZone') (ctx.chosen[op.as] = ctx.chosen[op.as] || []).push(c);
    }
    ctx.lastMoved = cs;
  };
  OPS.summonThis = async (g, op, ctx) => {
    await g.summonCard(ctx.src, { side: ctx.controller, state: op.state, byAbilityOf: ctx.src });
  };
  OPS.summonToken = async (g, op, ctx) => {
    const sideIdx = op.side === 'enemy' ? 1 - ctx.controller : ctx.controller;
    for (let i = 0; i < (op.count || 1); i++) {
      const t = g.newToken(op.token, sideIdx);
      if (!g.avatarRoom(sideIdx, t)) break;
      g.placeIn(t, 'avatarZone', sideIdx);
      t.state = op.state === 'rested' ? 'rested' : 'awake'; t.summonedTurn = g.turn;
      g.log(`${g.players[sideIdx].name} อัญเชิญ Token ${t.def.name}`);
      const ev = { self: t, summonedCard: t, triggerCard: t, paid: false, byAbilityOf: ctx.src, side: sideIdx, actor: sideIdx };
      await g.event('self.summoned', ev);
      await g.event('any.avatarSummoned', ev);
    }
  };
  OPS.build = async (g, op, ctx) => {
    const cs = await g.select(op.target, ctx, 'help');
    for (const c of cs) await g.buildCard(ctx.controller, c, { free: true, byAbilityOf: ctx.src });
  };
  OPS.playLand = async (g, op, ctx) => {
    const cs = await g.select(op.target, ctx, 'help');
    for (const c of cs) await g.placeLand(ctx.controller, c);
  };
  OPS.equip = async (g, op, ctx) => {
    const cards = await g.select(op.card, ctx, 'help');
    const hosts = await g.select(op.host, ctx, 'help');
    if (cards[0] && hosts[0]) await g.equipCard(cards[0], hosts[0], ctx);
  };
  OPS.unequip = async (g, op, ctx) => {
    const cs = await g.select(op.target, ctx);
    for (const c of cs) await g.sendTo(c, op.to || 'hell');
  };
  OPS.takeControl = async (g, op, ctx) => {
    const cs = await g.select(op.target, ctx, 'harm');
    for (const c of cs) {
      if (!isAv(c) || c.ctrl === ctx.controller || !g.avatarRoom(ctx.controller, c)) continue;
      g.removeFromZone(c);
      g.placeIn(c, 'avatarZone', ctx.controller);
      c.state = op.state === 'rested' ? 'rested' : c.state;
      c.summonedTurn = g.turn;
      if (op.duration && op.duration !== 'permanent') g.addMod(c, { kind: 'control', until: op.duration, owner: ctx.controller, srcCard: ctx.src, back: 1 - ctx.controller });
      g.log(`${g.players[ctx.controller].name} ยึด ${c.def.name}`);
    }
  };
  OPS.tap = async (g, op, ctx) => { for (const c of await g.select(op.target, ctx)) { c.state = 'rested'; g.bump(); } };
  OPS.untap = async (g, op, ctx) => { for (const c of await g.select(op.target, ctx, 'help')) { c.state = 'awake'; g.bump(); } };

  const durOf = (op) => op.duration || 'permanent';
  OPS.modifyPower = async (g, op, ctx) => {
    const cs = await g.select(op.target, ctx, hintOf(op, ctx, op.target));
    const amount = g.amt(op.amount, ctx) * (op.sign || 1);
    for (const c of cs) {
      const layer = g.battle && g.battle.snapshotted ? 4 : 1;
      g.addMod(c, { kind: 'power', amount, layer, until: durOf(op), owner: ctx.controller, srcCard: ctx.src });
    }
  };
  OPS.setPower = async (g, op, ctx) => {
    const cs = await g.select(op.target, ctx);
    const v = g.amt(op.value, ctx);
    for (const c of cs) g.addMod(c, { kind: 'setBase', value: v, until: durOf(op), owner: ctx.controller, srcCard: ctx.src });
  };
  OPS.grantKeyword = async (g, op, ctx) => {
    for (const c of await g.select(op.target, ctx, 'help')) g.addMod(c, { kind: 'keyword', keyword: op.keyword, until: durOf(op), owner: ctx.controller, srcCard: ctx.src });
  };
  OPS.grantAbility = async (g, op, ctx) => {
    for (const c of await g.select(op.target, ctx, 'help')) { c.grants.push({ ability: Object.assign({ id: (ctx.ab.id || 'g') + '#g' + g.uidN++, card: c.id }, op.ability), until: durOf(op) }); g.bump(); }
  };
  OPS.removeAbilities = async (g, op, ctx) => {
    for (const c of await g.select(op.target, ctx, 'harm')) {
      g.addMod(c, { kind: 'noabil', until: durOf(op), owner: ctx.controller, srcCard: ctx.src });
      c.mods = c.mods.filter(m => !(m.kind === 'power' && m.layer === 1 && m.srcCard && m.srcCard !== ctx.src && m.srcCard.def.type !== 'Magic'));
    }
  };
  OPS.changeName = async (g, op, ctx) => { for (const c of await g.select(op.target, ctx)) g.addMod(c, { kind: 'name', name: op.name, mode: op.mode || 'replace', until: durOf(op), owner: ctx.controller }); };
  OPS.changeSymbol = async (g, op, ctx) => { for (const c of await g.select(op.target, ctx)) g.addMod(c, { kind: 'symbol', symbol: op.symbol, mode: op.mode || 'replace', until: durOf(op), owner: ctx.controller }); };
  OPS.changeColor = async (g, op, ctx) => { for (const c of await g.select(op.target, ctx)) g.addMod(c, { kind: 'color', color: op.color, mode: op.mode || 'replace', until: durOf(op), owner: ctx.controller }); };
  OPS.modifyCost = async (g, op, ctx) => { /* one-shot cost mods are rare; continuous handled in contInfo */ };
  OPS.protect = async (g, op, ctx) => {
    for (const c of await g.select(op.target, ctx, 'help')) g.addMod(c, { kind: 'protect', from: op.from, sourceFilter: op.sourceFilter, exceptSource: op.exceptSource, until: durOf(op), owner: ctx.controller, srcCard: ctx.src });
  };
  OPS.preventDestroy = async (g, op, ctx) => {
    const rec = g.pendingDestroy;
    if (!rec) return;
    const cs = await g.select(op.target, ctx, 'static');
    if (cs.includes(rec.card)) { rec.prevented = true; g.log(`${rec.card.def.name} ไม่ถูกทำลาย`); }
  };
  OPS.select = async (g, op, ctx) => { await g.select(op.target, ctx, 'help'); };
  OPS.restrict = async (g, op, ctx) => {
    if (op.filter && (op.filter.sameAs || op.filter.notSameAs)) op = Object.assign({}, op, { filter: g.resolveSame(op.filter, ctx) });
    if (op.target) {
      for (const c of await g.select(op.target, ctx, 'harm')) g.addMod(c, { kind: 'restrict', action: op.action, filter: op.filter, until: durOf(op), owner: ctx.controller, srcCard: ctx.src });
    } else {
      for (const p of pls(g, ctx, op.player)) {
        const pl = g.players[p]; pl.restrictions = pl.restrictions || [];
        pl.restrictions.push({ action: op.action, filter: op.filter, exceptFilter: op.exceptFilter, until: durOf(op), owner: ctx.controller, setTurn: g.turn, srcCard: ctx.src });
      }
    }
  };
  OPS.cancelAttack = async (g) => { if (g.battle) { g.battle.cancelled = true; g.log('การโจมตีถูกยกเลิก'); } };
  OPS.redirectAttack = async (g, op, ctx) => {
    if (!g.battle) return;
    const cs = await g.select(op.to, ctx, 'help');
    if (cs[0]) { g.battle.target = cs[0]; g.battle.targetKind = cs[0].def.type === 'Construct' ? 'construct' : 'avatar'; }
  };
  OPS.damageLife = async (g, op, ctx) => { for (const p of pls(g, ctx, op.player)) await g.damageLife(p, g.amt(op.n, ctx)); };
  OPS.revealLife = async (g, op, ctx) => {
    for (const p of pls(g, ctx, op.player)) for (let i = 0; i < g.amt(op.n, ctx); i++) await g.revealTopLife(p, { triggers: op.triggers !== false });
  };
  OPS.unrevealLife = async (g, op, ctx) => {
    for (const p of pls(g, ctx, op.player)) {
      for (let i = 0; i < g.amt(op.n, ctx); i++) {
        const ups = g.players[p].life.filter(c => c.faceUp);
        if (!ups.length) break;
        let c = ups[ups.length - 1];
        if (op.choose && ups.length > 1) {
          const ids = await g.ask(p, { kind: 'pick', prompt: 'เลือก LIFE ที่จะคว่ำกลับ', cards: ups.map(x => x.uid), min: 1, max: 1, hint: 'help' });
          c = ups.find(x => x.uid === ids[0]) || c;
        }
        c.faceUp = false; g.bump();
      }
    }
  };
  OPS.negate = async (g, op, ctx) => {
    const item = (ctx.trigger && ctx.trigger.item) || g.stack[g.stack.length - 1];
    if (!item) return;
    if (op.what === 'attack') { if (g.battle) g.battle.cancelled = true; return; }
    if (op.what === 'magic' && item.card.def.type !== 'Magic') return;
    if (op.what === 'ability' && item.card.def.type === 'Magic' && item.isMagic) return;
    item.negated = true; g.log(`${item.card.def.name} ถูกยกเลิก`);
  };

  OPS.if = async (g, op, ctx) => {
    if (g.cond(op.cond, ctx)) await g.runOps(op.then, ctx); else await g.runOps(op.else, ctx);
  };
  OPS.choose = async (g, op, ctx) => {
    const opts = op.options.filter(o => g.condAll(o.conditions, ctx) && g.feasible(o.effects, ctx));
    if (!opts.length) return;
    let pick = opts[0];
    if (opts.length > 1) {
      const who = op.chooser === 'opponent' ? 1 - ctx.controller : ctx.controller;
      const ids = await g.ask(who, { kind: 'options', prompt: (ctx.ab && ctx.ab.text || 'เลือก').slice(0, 160), options: opts.map((o, i) => ({ id: i, label: o.label })), min: 1, max: 1, ctxCard: ctx.src ? ctx.src.uid : null });
      pick = opts[ids[0]] || opts[0];
    }
    await g.runOps(pick.effects, ctx);
  };
  OPS.optional = async (g, op, ctx) => {
    if (!g.feasible(op.effects, ctx)) return;
    const yes = await g.ask(ctx.controller, { kind: 'confirm', prompt: `ต้องการทำหรือไม่? ${(ctx.ab && ctx.ab.text || '').slice(0, 160)}`, ctxCard: ctx.src ? ctx.src.uid : null });
    if (yes) { await g.runOps(op.effects, ctx); if (op.as) { ctx.results = ctx.results || {}; ctx.results[op.as] = true; } }
  };
  OPS.random = async (g, op, ctx) => {
    let when;
    if (op.kind === 'coin') when = g.rand() < 0.5 ? 'heads' : 'tails';
    else if (op.kind === 'dice') when = String(1 + Math.floor(g.rand() * (op.sides || 6)));
    else when = 'heads';
    g.log(`สุ่ม: ${when}`);
    for (const o of op.outcomes || []) if (String(o.when) === when) { await g.runOps(o.effects, ctx); break; }
  };
  OPS.forEach = async (g, op, ctx) => {
    const cs = await g.select(op.target, ctx);
    for (const c of cs) { ctx.chosen.each = [c]; await g.runOps(op.effects, ctx); }
  };
  OPS.delayed = async (g, op, ctx) => {
    g.delayed = g.delayed || [];
    g.delayed.push({ at: op.at, effects: op.effects, ctx: { src: ctx.src, ab: ctx.ab, controller: ctx.controller, chosen: ctx.chosen, vars: {}, trigger: ctx.trigger, results: {} }, turn: g.turn });
  };
  G.runDelayed = async function (at) {
    if (!this.delayed || !this.delayed.length) return;
    const due = this.delayed.filter(d => d.at === at);
    this.delayed = this.delayed.filter(d => d.at !== at);
    for (const d of due) {
      const f0 = d.effects[0];
      if (f0 && f0.op === 'move' && f0.target && f0.target.ref === 'this' && d.ctx.src && !this.isOnField(d.ctx.src)) continue;
      await this.runOps(d.effects, d.ctx);
    }
  };

  /* rule.* ops are passive */
  for (const k of ['rule.deckLimit', 'rule.nameAlso', 'rule.symbolAlso', 'rule.colorAlso', 'rule.costPaymentOnlyFor', 'rule.controlLimit', 'rule.abilityUseLimit',
    'rule.deckRequires', 'rule.deckForbids', 'rule.costIs', 'rule.ignoresMagicQuota', 'rule.cannotPlayFromHand', 'rule.summonOnlyBy', 'rule.cannotEquip', 'rule.countsAsNForCost']) OPS[k] = async () => {};
})(typeof window !== 'undefined' ? window : globalThis);
