'use strict';
/* Turn flow, legal actions, magic, battle, setup. Extends TAL.Game. */
(function (root) {
  const TAL = root.TAL;
  const G = TAL.Game.prototype;
  const FIELD = TAL.FIELD;
  const GAME_OVER = TAL.GAME_OVER;
  const isAv = (c) => c.def.type === 'Avatar';

  /* ---------- costs ---------- */
  G.effectiveCost = function (c) {
    const info = this.contInfo();
    let cost = c.def.cost || 0;
    for (const ab of this.abilitiesOf(c, true)) for (const e of ab.effects || []) {
      if (e.op === 'rule.costIs') {
        const ctx = { src: c, ab, controller: c.ctrl, chosen: {}, vars: {}, trigger: {} };
        if (!e.while || this.cond(e.while, ctx)) cost = e.n;
      }
    }
    for (const e of info.costSets) if (e.matches(c)) cost = e.value;
    for (const e of info.costMods) if (e.matches(c)) cost += e.amount;
    return Math.max(0, cost);
  };

  G.choosePayment = async function (pi, card, opts) {
    if (!opts) opts = this.paymentOptions(pi, card);
    if (!opts.length) return null;
    if (opts.length === 1 && opts[0].length === 0) return [];
    const cost = this.effectiveCost(card);
    const cand = this.players[pi].hand.filter(c => c !== card && this.gemOf(c) > 0 && this.gemCompat(c, card));
    const ids = await this.ask(pi, {
      kind: 'pay', prompt: `เลือกการ์ดทิ้งเพื่อจ่าย Cost ${cost} ให้ ${card.def.name}`, card: card.uid, cost,
      cards: cand.map(c => c.uid), options: opts.map(o => o.map(c => c.uid)),
      validate: (uids) => this.validPayment(uids.map(u => cand.find(c => c.uid === u)).filter(Boolean), cost, card),
      gems: Object.fromEntries(cand.map(c => [c.uid, this.gemOf(c)])),
    });
    if (ids === null) return null;
    const pay = (ids || []).map(u => cand.find(c => c.uid === u)).filter(Boolean);
    if (!this.validPayment(pay, cost, card)) return opts[0];
    return pay;
  };

  /* ---------- magic quota ---------- */
  /* A React that counters opposing React Magic (e.g. "อย่าให้มีครั้งที่ 2") can be used even
     * when this turn's React quota is already spent. It does not consume the quota. */
  G.isReactCounter = function (c) {
    return c.def.magicType === 'React' && this.abilitiesOf(c, true).some(a => a.kind === 'react' && a.trigger && a.trigger.event === 'any.magicUsed' &&
      a.trigger.params && (a.trigger.params.magicType || []).length === 1 && a.trigger.params.magicType[0] === 'React' &&
      (a.effects || []).some(e => e.op === 'negate'));
  };
  G.quotaAvailable = function (pi, c) {
    const t = c.def.magicType;
    if (this.isReactCounter(c)) return true;
    if (!this.magicUsed[t]) return true;
    for (const ab of this.abilitiesOf(c, true)) for (const e of ab.effects || []) if (e.op === 'rule.ignoresMagicQuota' && e.magicType === t) return true;
    const pl = this.players[pi];
    return (pl.quotaMods || []).some(q => q.type === t && q.n > 0 && (!q.filter || this.matchFilter(c, q.filter, { src: c, controller: pi })));
  };
  G.consumeQuota = function (pi, c) {
    const t = c.def.magicType;
    if (this.isReactCounter(c)) return;
    if (!this.magicUsed[t]) { this.magicUsed[t] = true; return; }
    const pl = this.players[pi];
    const q = (pl.quotaMods || []).find(x => x.type === t && x.n > 0 && (!x.filter || this.matchFilter(c, x.filter, { src: c, controller: pi })));
    if (q) q.n--;
  };

  /* ---------- can use an ability ---------- */
  G.canUseAbility = function (pi, c, ab, e) {
    if (this.over) return false;
    if (c.zone === 'hand' ? c.owner !== pi : c.ctrl !== pi) return false;
    if (!this.limitOk(c, ab)) return false;
    const ctx = { src: c, ab, controller: pi, chosen: {}, vars: {}, trigger: e || {}, results: {} };
    if (ab.conditions && ab.conditions.length && !this.condAll(ab.conditions, ctx)) return false;
    const isMagic = c.def.type === 'Magic' && c.zone === 'hand';
    if (isMagic) {
      if (!this.quotaAvailable(pi, c)) return false;
      if (this.playerCardRestricted(pi, 'useMagic', c)) return false;
      if (ab.kind === 'react' && this.playerCardRestricted(pi, 'useReact', c)) return false;
      for (const x of this.abilitiesOf(c, true)) for (const eff of x.effects || []) if (eff.op === 'rule.cannotPlayFromHand') return false;
    } else if (ab.kind === 'activated') {
      if (this.playerCardRestricted(pi, 'useAbilities', c) || this.cardRestricted(c, 'useAbilities')) return false;
    }
    if (ab.cost && ab.cost.length && !this.feasible(ab.cost, ctx)) return false;
    if (ab.modes && ab.modes.length) { if (!ab.modes.some(m => this.condAll(m.conditions, ctx) && this.feasible(m.effects, ctx))) return false; }
    else if (!this.feasible(ab.effects, ctx)) return false;
    return true;
  };

  /* ---------- use an ability (spell / react / activated) ---------- */
  G.useAbility = async function (pi, c, ab, e) {
    const isMagic = c.def.type === 'Magic' && c.zone === 'hand';
    const item = { card: c, ab, controller: pi, negated: false, isMagic };
    const ctx = { src: c, ab, controller: pi, chosen: {}, vars: {}, trigger: e || {}, results: {}, item };
    const pl = this.players[pi];
    if (isMagic) {
      this.consumeQuota(pi, c);
      this.removeFromZone(c);
      this.placeIn(c, 'magicZone', pi);
      c.resolving = true;
      this.log(`${pl.name} ใช้ ${c.def.magicType} Magic: ${c.def.name}`);
    } else {
      this.log(`${pl.name} สั่งใช้ ${c.def.name}`);
    }
    if (!(await this.payAbilityCost(ab, ctx))) { /* feasibility was checked earlier */ }
    this.stack.push(item);
    try {
      if (isMagic) await this.event('any.magicUsed', { side: pi, actor: pi, triggerCard: c, self: c, magicType: c.def.magicType, item, sourceCard: c, info: c.def.name });
      else {
        const kw = (ab.keywords || [])[0];
        await this.event('any.abilityUsed', { side: pi, actor: pi, triggerCard: c, self: c, item, sourceCard: c, keyword: kw, info: c.def.name });
        await this.fire('self.abilityUsed', { self: c, keyword: kw, item });
      }
      if (!item.negated && (c.zone === 'magicZone' || !isMagic)) {
        this.markUsed(c, ab);
        if (ab.modes && ab.modes.length) await this.runModes(ab, ctx); else await this.runOps(ab.effects, ctx);
      }
    } finally { this.stack.pop(); }
    if (isMagic) {
      c.resolving = false;
      if (c.zone === 'magicZone' && !c.host) await this.sendTo(c, 'hell', { cause: 'magic' });
    }
    this.checkEnd();
  };

  G.placeLand = async function (pi, c) {
    this.removeFromZone(c);
    const old = this.land.slice();
    for (const o of old) await this.sendTo(o, 'hell', { cause: 'ability' });
    this.placeIn(c, 'landZone', pi);
    c.state = 'awake';
    this.log(`${this.players[pi].name} วาง Land Magic: ${c.def.name}`);
  };
  G.playLandCard = async function (pi, c) {
    this.consumeQuota(pi, c);
    this.removeFromZone(c);
    c.zone = 'limbo';
    const item = { card: c, ab: null, controller: pi, negated: false, isMagic: true };
    this.stack.push(item);
    try {
      this.log(`${this.players[pi].name} ใช้ Land Magic: ${c.def.name}`);
      await this.event('any.magicUsed', { side: pi, actor: pi, triggerCard: c, self: c, magicType: 'Land', item, sourceCard: c, info: c.def.name });
    } finally { this.stack.pop(); }
    if (item.negated) await this.sendTo(c, 'hell', { cause: 'magic' }); else await this.placeLand(pi, c);
  };

  G.buildCard = async function (pi, c, o) {
    o = o || {};
    const pl = this.players[pi];
    if (pl.constructZone.length >= 3) return false;
    const names = this.namesOf(c);
    if (pl.constructZone.some(x => this.namesOf(x).some(n => names.includes(n)))) return false;
    this.removeFromZone(c);
    this.placeIn(c, 'constructZone', pi);
    c.summonedTurn = this.turn;
    this.log(`${pl.name} ก่อสร้าง ${c.def.name}`);
    await this.event('self.built', { self: c, triggerCard: c, paid: !o.free, side: pi, actor: pi });
    return true;
  };

  /* ---------- legal actions in Main Phase ---------- */
  G.canSummonFromHand = function (pi, c) {
    if (!isAv(c) || c.zone !== 'hand') return false;
    if (!this.avatarRoom(pi, c)) return false;
    if (this.restricted(pi, 'summon') || this.playerCardRestricted(pi, 'summon', c)) return false;
    for (const ab of this.abilitiesOf(c, true)) for (const e of ab.effects || []) {
      if (e.op === 'rule.cannotPlayFromHand' || e.op === 'rule.summonOnlyBy') return false;
    }
    // control limit rule: rule.controlLimit {name, n}
    for (const ab of this.abilitiesOf(c, true)) for (const e of ab.effects || []) if (e.op === 'rule.controlLimit') {
      const same = this.players[pi].avatarZone.filter(x => this.namesOf(x).includes(e.name)).length;
      if (same >= e.n) return false;
    }
    return this.canPay(pi, c);
  };
  G.canBuildFromHand = function (pi, c) {
    if (c.def.type !== 'Construct' || c.zone !== 'hand') return false;
    const pl = this.players[pi];
    if (pl.constructZone.length >= 3) return false;
    if (this.restricted(pi, 'build') || this.playerCardRestricted(pi, 'build', c)) return false;
    const names = this.namesOf(c);
    if (pl.constructZone.some(x => this.namesOf(x).some(n => names.includes(n)))) return false;
    return this.canPay(pi, c);
  };
  G.timingOk = function (ab, pi) {
    const t = ab.timing;
    if (!t) return this.phase === 'main' && this.active === pi;
    if (t.turn === 'own' && this.active !== pi) return false;
    if (t.turn === 'enemy' && this.active === pi) return false;
    return !t.phases || t.phases.includes(this.phase);
  };
  G.partnerPairs = function (pi) {
    const out = [];
    const av = this.players[pi].avatarZone.filter(c => isAv(c) && !c.inPartner);
    for (const a of av) for (const ab of this.abilitiesOf(a)) {
      if (ab.kind !== 'partner' || !ab.partner) continue;
      for (const b of av) {
        if (b === a || out.some(p => p[0] === b && p[1] === a)) continue;
        if (!this.namesOf(b).includes(ab.partner.name)) continue;
        const bp = this.abilitiesOf(b).filter(x => x.kind === 'partner' && x.partner);
        if (bp.length && !bp.some(x => this.namesOf(a).includes(x.partner.name))) continue;
        out.push([a, b]);
      }
    }
    return out;
  };

  G.listActions = function (pi) {
    const acts = [];
    const pl = this.players[pi];
    let n = 0;
    const add = (a) => { a.id = n++; acts.push(a); };
    for (const c of pl.hand.slice()) {
      if (isAv(c) && this.canSummonFromHand(pi, c)) add({ type: 'summon', card: c, label: 'อัญเชิญ ' + c.def.name });
      else if (c.def.type === 'Construct' && this.canBuildFromHand(pi, c)) add({ type: 'build', card: c, label: 'ก่อสร้าง ' + c.def.name });
      else if (c.def.type === 'Magic') {
        if (c.def.magicType === 'Land') {
          if (this.quotaAvailable(pi, c) && !this.playerCardRestricted(pi, 'playLand', c) && !this.playerCardRestricted(pi, 'useMagic', c)) add({ type: 'land', card: c, label: 'วาง Land ' + c.def.name });
        }
        for (const ab of this.abilitiesOf(c)) {
          if (ab.kind === 'spell' && this.timingOk(ab, pi) && this.canUseAbility(pi, c, ab, {})) add({ type: 'spell', card: c, ab, label: 'ใช้ ' + c.def.name });
        }
      }
      if (c.def.type !== 'Magic') {
        for (const ab of this.abilitiesOf(c)) if (ab.kind === 'activated' && !ab.trigger && c.zone === 'hand' && this.timingOk(ab, pi) && this.canUseAbility(pi, c, ab, {})) add({ type: 'activate', card: c, ab, label: 'สั่งใช้ ' + c.def.name });
      }
    }
    const inPlay = this.allInPlay().filter(c => c.ctrl === pi).concat(pl.hell, pl.dark);
    for (const c of inPlay) for (const ab of this.abilitiesOf(c)) {
      if (ab.kind === 'activated' && !ab.trigger && this.abilityZoneOk(c, ab) && this.timingOk(ab, pi) && this.canUseAbility(pi, c, ab, {})) {
        add({ type: 'activate', card: c, ab, label: 'สั่งใช้ ' + c.def.name + (ab.keywords && ab.keywords.length ? ' (' + ab.keywords[0] + ')' : '') });
      }
    }
    if (!pl.partnerDone && this.partnerPairs(pi).length) add({ type: 'partner', label: 'ประกาศ คู่หู' });
    add({ type: 'endPhase', label: this.turn === 1 ? 'จบเทิร์น' : 'ไป Battle Phase' });
    return acts;
  };

  G.doAction = async function (pi, a) {
    const pl = this.players[pi];
    switch (a.type) {
      case 'summon': {
        const c = a.card;
        const pay = await this.choosePayment(pi, c);
        if (!pay) return;
        const cost = this.effectiveCost(c);
        const sum = pay.reduce((s, x) => s + this.gemOf(x), 0);
        for (const x of pay) { this.removeFromZone(x); x.zone = 'limbo'; }
        this.bump();
        await this.summonCard(c, { side: pi, paid: true, exactGem: cost > 0 && sum === cost, costPaid: pay });
        for (const x of pay) {
          await this.sendTo(x, 'hell', { cause: 'cost' });
          await this.fire('self.usedAsCost', { self: x, triggerCard: x, forCard: c, summonedCard: c, costKind: 'summon', side: pi });
        }
        break;
      }
      case 'build': {
        const c = a.card;
        const pay = await this.choosePayment(pi, c);
        if (!pay) return;
        for (const x of pay) { this.removeFromZone(x); x.zone = 'limbo'; }
        this.bump();
        await this.buildCard(pi, c, {});
        for (const x of pay) { await this.sendTo(x, 'hell', { cause: 'cost' }); await this.fire('self.usedAsCost', { self: x, triggerCard: x, forCard: c, costKind: 'summon', side: pi }); }
        break;
      }
      case 'land': await this.playLandCard(pi, a.card); break;
      case 'spell': case 'activate': await this.useAbility(pi, a.card, a.ab, {}); break;
      case 'partner': {
        const pairs = this.partnerPairs(pi);
        let pair = pairs[0];
        if (pairs.length > 1) {
          const ids = await this.ask(pi, { kind: 'options', prompt: 'เลือกคู่หู', options: pairs.map((p, i) => ({ id: i, label: p[0].def.name + ' & ' + p[1].def.name })), min: 1, max: 1 });
          pair = pairs[ids[0]] || pairs[0];
        }
        pair[0].inPartner = pair[1].inPartner = true; pair[0].partnerWith = pair[1]; pair[1].partnerWith = pair[0];
        pl.partnerDone = true; this.bump();
        this.log(`${pl.name} ประกาศคู่หู ${pair[0].def.name} & ${pair[1].def.name}`);
        await this.fire('self.partnerFormed', { self: pair[0] }); await this.fire('self.partnerFormed', { self: pair[1] });
        break;
      }
      default: break;
    }
    this.checkEnd();
  };

  /* ---------- Battle ---------- */
  G.attackTargets = function (att) {
    const pi = att.ctrl, oi = 1 - pi;
    const opp = this.players[oi];
    const out = [];
    for (const t of opp.avatarZone) if (!this.cardRestricted(t, 'beAttacked') && !this.isProtected(t, 'targeting', att)) out.push({ kind: 'avatar', card: t });
    for (const t of opp.constructZone) if (!this.cardRestricted(t, 'beAttacked')) out.push({ kind: 'construct', card: t });
    const noBlock = opp.avatarZone.length === 0 || this.hasKw(att, 'เตะไข่');
    if (noBlock && !this.cardRestricted(att, 'attackLife') && !this.restricted(oi, 'beAttackedLife')) out.push({ kind: 'life', card: null });
    return out;
  };
  G.possibleAttackers = function (pi) {
    return this.players[pi].avatarZone.filter(c => isAv(c) && c.state === 'awake' && !this.cardRestricted(c, 'attack') && this.attackTargets(c).length > 0);
  };
  G.helpersFor = function (att) {
    return this.players[att.ctrl].avatarZone.filter(c => c !== att && c.state === 'awake' && isAv(c) && (this.hasKw(c, 'สามัคคี') || this.hasKw(c, 'แทงหลัง')));
  };

  G.attackAlive = function (b) { return this.battle === b && !b.cancelled && b.attacker.zone === 'avatarZone'; };
  G.attack = async function (att, helpers, target, kind) {
    const pi = att.ctrl, oi = 1 - pi;
    att.state = 'rested';
    for (const h of helpers) h.state = 'rested';
    const b = this.battle = { attacker: att, target, targetKind: kind, helpers, snapshotted: false, cancelled: false, backstab: [] };
    this.bump();
    for (const h of helpers) {
      if (this.hasKw(h, 'สามัคคี')) this.addMod(att, { kind: 'power', amount: this.getPower(h), layer: 1, until: 'endOfBattle', owner: pi, srcCard: h });
      if (this.hasKw(h, 'แทงหลัง')) { this.addMod(att, { kind: 'power', amount: 1, layer: 1, until: 'endOfBattle', owner: pi, srcCard: h }); b.backstab.push(h); }
    }
    this.log(`${this.players[pi].name}: ${att.def.name} โจมตี ${kind === 'life' ? 'LIFE' : target.def.name}`);
    const ev = () => ({ self: att, attacker: att, attackTarget: b.target, targetKind: b.targetKind, triggerCard: att, side: pi, actor: pi, info: att.def.name });
    try {
      await this.event('self.declaresAttack', ev());
      if (!this.attackAlive(b)) return;
      await this.fire('host.declaresAttack', Object.assign(ev(), { self: att }));
      await this.event('any.attackDeclared', ev());
      if (!this.attackAlive(b)) return;
      b.snapshotted = true;
      // Human Shield
      if (b.targetKind !== 'life') {
        const shields = this.players[oi].avatarZone.filter(x => x.state === 'awake' && this.hasKw(x, 'โล่มนุษย์') && x !== b.target && !this.cardRestricted(x, 'beAttacked'));
        if (shields.length) {
          const ids = await this.ask(oi, { kind: 'pick', prompt: 'ใช้ โล่มนุษย์ เปลี่ยนเป้าหมายการโจมตี?', cards: shields.map(x => x.uid), min: 0, max: 1, hint: 'help', optional: true });
          if (ids && ids.length) {
            const s = shields.find(x => x.uid === ids[0]);
            if (s) { s.state = 'rested'; b.target = s; b.targetKind = 'avatar'; this.log(`${s.def.name} โล่มนุษย์ รับการโจมตีแทน`); await this.fire('any.attackRedirected', { side: oi }); }
          }
        }
      }
      if (b.targetKind !== 'life' && (!b.target || !this.isOnField(b.target))) return;
      if (b.targetKind !== 'life') {
        await this.event('self.attackTargeted', { self: b.target, attacker: att, triggerCard: b.target, side: oi, actor: pi });
        await this.fire('host.attackTargeted', { self: b.target, attacker: att, triggerCard: b.target });
      }
      if (!this.attackAlive(b)) return;
      if (b.targetKind !== 'life' && !this.isOnField(b.target)) return;
      await this.resolveAttack(b);
    } finally {
      this.expireMods('endOfAttack');
      this.expireMods('endOfBattle');
      this.battle = null;
      this.bump();
    }
  };

  G.resolveAttack = async function (b) {
    const att = b.attacker, pi = att.ctrl, oi = 1 - pi;
    if (b.targetKind === 'life') {
      if (this.getPower(att) > 0) {
        if (this.isCritical(oi)) { this.log(`${this.players[oi].name} ถูกโจมตี LIFE ขณะสาหัส -> แพ้`); this.win(pi, 'life'); }
        await this.damageLife(oi, 1, { byAttack: true, attacker: att });
      } else this.log('POWER 0 โจมตี LIFE ไม่ทำความเสียหาย');
      return;
    }
    const tgt = b.target;
    if (b.targetKind === 'construct') {
      if (this.getPower(att) > this.getPower(tgt)) await this.destroy(tgt, { cause: 'battle', source: att });
      else this.log('ไม่มีอะไรเกิดขึ้น (POWER น้อยกว่า Construct)');
      return;
    }
    // Avatar battle
    await this.event('any.battles', { side: pi, triggerCard: att, self: att, opponent: tgt });
    await this.fire('self.battles', { self: att, opponent: tgt, triggerCard: att });
    await this.fire('self.battles', { self: tgt, opponent: att, triggerCard: tgt });
    await this.fire('host.battles', { self: att, opponent: tgt });
    await this.fire('host.battles', { self: tgt, opponent: att });
    if (b.cancelled || !this.isOnField(att) || !this.isOnField(tgt)) return;
    const pA = this.getPower(att), pT = this.getPower(tgt);
    const kA = this.hasKw(att, 'ลูกฮึด'), kT = this.hasKw(tgt, 'ลูกฮึด');
    let dA = false, dT = false;
    if (pA === 0 && pT === 0) { /* nothing */ }
    else if (pA > pT) dT = true;
    else if (pT > pA) dA = true;
    else if (kA && !kT) dT = true;
    else if (kT && !kA) dA = true;
    else { dA = true; dT = true; }
    this.log(`ต่อสู้: ${att.def.name}(${pA}) vs ${tgt.def.name}(${pT})`);
    await this.fire('self.battleEnds', { self: att }); // pre-resolution marker is not used by data
    if (dT) await this.destroy(tgt, { cause: 'battle', source: att });
    if (dA) await this.destroy(att, { cause: 'battle', source: tgt });
    if (dT && !this.isOnField(tgt)) {
      await this.fire('self.destroysInBattle', { self: att, opponent: tgt, triggerCard: att, source: tgt });
      await this.fire('host.destroysInBattle', { self: att, opponent: tgt });
      await this.fire('any.destroysInBattle', { side: pi, triggerCard: att, self: att });
    }
    if (dA && !this.isOnField(att)) {
      await this.fire('self.destroysInBattle', { self: tgt, opponent: att, triggerCard: tgt, source: att });
      await this.fire('host.destroysInBattle', { self: tgt, opponent: att });
      await this.fire('any.destroysInBattle', { side: oi, triggerCard: tgt, self: tgt });
    }
    // backstab: attacker of different colour than the helper is destroyed
    for (const h of b.backstab) {
      if (this.isOnField(att) && att.zone === 'avatarZone') {
        const hc = this.colorsOf(h), ac = this.colorsOf(att);
        if (hc.length && !ac.some(x => hc.includes(x))) await this.destroy(att, { cause: 'ability', source: h });
      }
    }
  };

  /* ---------- Turn flow ---------- */
  G.setup = async function () {
    this.ownTurns = [0, 0];
    for (const pl of this.players) {
      const s = pl.setup;
      for (const [id, n] of Object.entries(s.main)) for (let i = 0; i < n; i++) { const c = this.newCard(id, pl.i); c.zone = 'deck'; pl.deck.push(c); }
      for (const id of s.life) { const c = this.newCard(id, pl.i); c.zone = 'life'; pl.life.push(c); }
      this.shuffle(pl.deck); this.shuffle(pl.life);
    }
    this.firstPlayer = this.rand() < 0.5 ? 0 : 1;
    this.log(`${this.players[this.firstPlayer].name} เริ่มก่อน`);
    for (const pl of this.players) {
      for (let i = 0; i < 5; i++) { const c = pl.deck.shift(); c.zone = 'hand'; pl.hand.push(c); }
    }
    for (const pi of [this.firstPlayer, 1 - this.firstPlayer]) {
      const pl = this.players[pi];
      const ids = await this.ask(pi, { kind: 'pick', prompt: 'Mulligan: เลือกการ์ดที่จะเปลี่ยน (ไม่เลือกก็ได้)', cards: pl.hand.map(c => c.uid), min: 0, max: pl.hand.length, hint: 'mulligan', mulligan: true });
      const sel = (ids || []).map(u => pl.hand.find(c => c.uid === u)).filter(Boolean);
      for (const c of sel) { pl.hand.splice(pl.hand.indexOf(c), 1); c.zone = 'deck'; pl.deck.push(c); }
      for (let i = 0; i < sel.length; i++) { const c = pl.deck.shift(); c.zone = 'hand'; pl.hand.push(c); }
      if (sel.length) this.shuffle(pl.deck);
    }
    for (const pl of this.players) for (const c of pl.life) c.faceUp = false;
    this.bump(); this.changed();
  };

  G.run = async function () {
    try {
      await this.setup();
      for (;;) await this.playTurn();
    } catch (e) {
      if (e !== GAME_OVER) throw e;
    }
    this.changed();
    return this.over;
  };

  G.playTurn = async function () {
    this.turn++;
    this.active = this.turn % 2 === 1 ? this.firstPlayer : 1 - this.firstPlayer;
    const pi = this.active, pl = this.players[pi];
    this.ownTurns[pi]++;
    this.magicUsed = {};
    for (const p of this.players) { p.partnerDone = false; }
    this.log(`--- เทิร์น ${this.turn}: ${pl.name} ---`);

    // Draw phase
    this.phase = 'draw'; this.expireMods('drawPhase', pi);
    for (const c of this.allInPlay()) if (c.ctrl === pi) c.state = 'awake';
    this.bump();
    const nDraw = this.turn === 1 ? 2 : (pl.hand.length < 3 ? 3 - pl.hand.length : 1);
    await this.draw(pi, nDraw);
    await this.event('phase.start', { phase: 'draw', actor: pi });
    await this.event('phase.end', { phase: 'draw', actor: pi });

    // Main phase
    this.phase = 'main';
    await this.event('phase.start', { phase: 'main', actor: pi });
    await this.resolvePendingLife(pi);
    for (;;) {
      this.checkEnd();
      const acts = this.listActions(pi);
      const ids = await this.ask(pi, { kind: 'action', phase: 'main', actions: acts.map(a => ({ id: a.id, type: a.type, card: a.card ? a.card.uid : null, label: a.label, text: a.ab ? (a.ab.text || '').slice(0, 160) : '' })) });
      const a = acts.find(x => x.id === ids[0]);
      if (!a || a.type === 'endPhase') break;
      await this.doAction(pi, a);
    }
    await this.event('phase.end', { phase: 'main', actor: pi });

    // Battle phase
    if (this.turn !== 1) {
      this.phase = 'battle';
      await this.event('phase.start', { phase: 'battle', actor: pi });
      for (;;) {
        this.checkEnd();
        const atts = this.possibleAttackers(pi);
        const bActs = this.listActions(pi).filter(a => (a.type === 'activate' || a.type === 'spell') && a.ab && a.ab.timing && (a.ab.timing.phases || []).includes('battle'));
        if (!atts.length && !bActs.length) break;
        const opts = atts.map((c, i) => ({ id: i, card: c.uid, label: 'โจมตีด้วย ' + c.def.name, targets: this.attackTargets(c).map(t => ({ kind: t.kind, card: t.card ? t.card.uid : null })), helpers: this.helpersFor(c).map(h => h.uid) }));
        const ids = await this.ask(pi, { kind: 'attack', phase: 'battle', attackers: opts, actions: bActs.map(a => ({ id: a.id, type: a.type, card: a.card.uid, label: a.label, text: (a.ab.text || '').slice(0, 160) })) });
        if (!ids || !ids.length) break;
        if (ids[0] && ids[0].act != null) { const a = bActs.find(x => x.id === ids[0].act); if (a) await this.doAction(pi, a); continue; }
        const att = atts[ids[0]];
        if (!att) break;
        const targets = this.attackTargets(att);
        let tgt = targets[0];
        if (targets.length > 1) {
          const tids = await this.ask(pi, { kind: 'target', prompt: 'เลือกเป้าหมายการโจมตี', attacker: att.uid, targets: targets.map((t, i) => ({ id: i, kind: t.kind, card: t.card ? t.card.uid : null })) });
          tgt = targets[tids[0]] || targets[0];
        }
        const hs = this.helpersFor(att);
        let helpers = [];
        if (hs.length) {
          const hids = await this.ask(pi, { kind: 'pick', prompt: 'เลือก Avatar สามัคคี/แทงหลัง ที่จะช่วยโจมตี (ไม่เลือกก็ได้)', cards: hs.map(h => h.uid), min: 0, max: hs.length, hint: 'help', optional: true, helper: true });
          helpers = (hids || []).map(u => hs.find(h => h.uid === u)).filter(Boolean);
        }
        await this.attack(att, helpers, tgt.card, tgt.kind);
      }
      await this.event('phase.end', { phase: 'battle', actor: pi });
    }

    // End phase
    this.phase = 'end';
    await this.event('phase.start', { phase: 'end', actor: pi });
    if (pl.hand.length > 7) {
      const n = pl.hand.length - 7;
      const ids = await this.ask(pi, { kind: 'pick', prompt: `มือเกิน 7 ใบ ทิ้ง ${n} ใบ`, cards: pl.hand.map(c => c.uid), min: n, max: n, hint: 'cost', discard: true });
      for (const u of ids) { const c = pl.hand.find(x => x.uid === u); if (c) await this.sendTo(c, 'hell', { cause: 'discard' }); }
    }
    await this.event('phase.end', { phase: 'end', actor: pi });
    await this.fire('turn.end', { actor: pi });
    await this.runDelayed('endOfTurn');
    this.expireMods('endOfTurn');
    for (const p of this.players) { if (p.restrictions) p.restrictions = p.restrictions.filter(r => r.until !== 'endOfTurn'); }
    this.phase = null;
    this.checkEnd();
  };
})(typeof window !== 'undefined' ? window : globalThis);
