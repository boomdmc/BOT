'use strict';
/* Browser UI: human vs AI. The engine asks for decisions; this file renders them. */
(function () {
  const TAL = window.TAL;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let db = null, decks = [], game = null;
  const ui = { can: new Set(), canLife: false, onCard: null, onLife: null, wait: false, hover: null };

  /* ---------------- data / menu ---------------- */
  async function load() {
    const rd = async (f) => (window.TAL_DATA && window.TAL_DATA[f]) || (await fetch('data/' + f)).json();
    const [defs, abil, patches, sd, bd] = await Promise.all(['card_definitions.json', 'abilities.json', 'ability_patches.json', 'starter_decks.json', 'bot_decks.json'].map(rd));
    db = TAL.buildDB(defs, abil, patches);
    const colorTh = { red: 'แดง', blue: 'ฟ้า', green: 'เขียว', purple: 'ม่วง' };
    for (const [k, v] of Object.entries(sd)) decks.push({ name: 'Structure Deck: ' + v.name + ' (' + (colorTh[k] || k) + ')', main: v.main, life: v.life });
    for (const b of bd) decks.push({ name: b.name + (b.by ? '  — ' + b.by : ''), main: b.main, life: b.life });
    try { imported = JSON.parse(localStorage.getItem('tal_imported_decks') || '[]'); } catch (e) { imported = []; }
    decks = imported.concat(decks);
    renderLists(0, Math.min(2 + imported.length, decks.length - 1));
    $('#myDeck').onchange = deckNote; $('#aiDeck').onchange = deckNote;
    $('#importBtn').onclick = doImport;
    $('#manageBtn').onclick = openManager;
    setupBookmarklet();
    const hm = location.hash.match(/deck=([^&]+)/);
    if (hm) {
      try { $('#importText').value = decodeURIComponent(escape(atob(decodeURIComponent(hm[1])))); await doImport(); }
      catch (e) { importMsg('อ่านเด็คที่ส่งมาไม่ได้', false); }
      history.replaceState(null, '', location.pathname + location.search);
    }
    $('#importText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doImport(); } });
    $('#startBtn').disabled = false; $('#startBtn').textContent = 'เริ่มเกม';
  }


  /* ---------------- deck import (bottcg.com link / JSON / card list) ---------------- */
  let imported = [];
  function renderLists(myIdx, aiIdx) {
    for (const [sel, idx] of [[$('#myDeck'), myIdx], [$('#aiDeck'), aiIdx]]) {
      sel.innerHTML = '';
      decks.forEach((d, i) => { const o = document.createElement('option'); o.value = i; o.textContent = (d.imported ? '★ ' : '') + d.name; sel.appendChild(o); });
      sel.value = idx;
    }
    deckNote();
  }
  function deckNote() {
    const a = TAL.adaptDeck(db, decks[+$('#myDeck').value], Math.random);
    const b = TAL.adaptDeck(db, decks[+$('#aiDeck').value], Math.random);
    $('#deckNote').textContent = `เด็คคุณแทนที่การ์ดที่ยังไม่รองรับ ${a.replaced.length} ใบ · เด็ค AI ${b.replaced.length} ใบ`;
  }
  const importMsg = (t, ok) => { const m = $('#importMsg'); m.innerHTML = t; m.style.color = ok ? '#9be28a' : '#ffb4a8'; };
  function toCardId(print) {
    if (db.cards[print]) return print;
    const base = String(print).replace(/-[A-Z]{1,4}$/, '');
    return db.cards[base] ? base : null;
  }
  function deckFromJson(j) {
    const k = j.deck || j;
    const main = {}, life = [], unknown = [];
    for (const c of k.cards || []) { const id = toCardId(c.print); if (id) main[id] = (main[id] || 0) + (c.quantity || 1); else unknown.push(c.print); }
    for (const c of k.lifeCards || []) { const id = toCardId(c.print); if (id) life.push(id); else unknown.push(c.print); }
    return { name: k.name || 'เด็คนำเข้า', main, life, unknown };
  }
  function deckFromText(text) {
    const main = {}, life = [], unknown = [];
    const re = /\b([A-Z]{2,5}\d{0,2}-[0-9]{2,3}[A-Z]?)\b/;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(re); if (!m) continue;
      const id = toCardId(m[1]); if (!id) { unknown.push(m[1]); continue; }
      let n = 1, q;
      if ((q = line.match(/(\d+)\s*[xX\u00d7]/)) || (q = line.match(/[xX\u00d7]\s*(\d+)/)) || (q = line.match(/^\s*(\d+)\s+/)) || (q = line.replace(m[1], ' ').match(/\s(\d+)\s*$/))) n = Math.min(+q[1], 50);
      if (db.cards[id].type === 'LIFE') { if (!life.includes(id) && life.length < 5) life.push(id); }
      else main[id] = (main[id] || 0) + n;
    }
    return { name: 'เด็คนำเข้า (ลิสต์)', main, life, unknown };
  }
  async function fetchDeckById(id) {
    const url = 'https://bottcg.com/api/decks/' + id;
    const tries = [url, 'https://api.cors.lol/?url=' + encodeURIComponent(url), 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url), 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url)];
    for (const u of tries) {
      try {
        const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 6000);
        const r = await fetch(u, { signal: ac.signal }); clearTimeout(tm);
        if (!r.ok) continue; const j = await r.json(); if (j && j.deck) return j;
      } catch (e) { /* try next */ }
    }
    return null;
  }
  function setupBookmarklet() {
    const base = location.origin + location.pathname;
    const code = "(async()=>{try{const m=location.pathname.match(/decks\/([A-Za-z0-9]+)/);if(!m){alert('เปิดหน้าเด็คใน bottcg.com ก่อน');return}const j=await (await fetch('/api/decks/'+m[1])).json();const d=j.deck;const o={name:d.name,cards:d.cards,lifeCards:d.lifeCards};location.href='" + base + "#deck='+encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(o)))));}catch(e){alert('ดึงเด็คไม่ได้: '+e.message)}})()";
    const a = $('#bmLink'); if (a) a.setAttribute('href', 'javascript:' + code);
  }
  async function doImport() {
    const text = $('#importText').value.trim();
    if (!text) { importMsg('วางลิงก์เด็ค หรือข้อความก่อน', false); return; }
    let d = null;
    try {
      if (/^\s*\{/.test(text)) d = deckFromJson(JSON.parse(text));
      else {
        const idm = text.match(/decks\/([A-Za-z0-9]{6,16})/) || text.match(/^([A-Za-z0-9]{8,16})$/);
        if (idm) {
          importMsg('กำลังดึงเด็คจาก bottcg.com …', true);
          const j = await fetchDeckById(idm[1]);
          if (!j) { importMsg(`ดึงจากลิงก์ตรง ๆ ไม่ได้ (เว็บ official ไม่ให้เว็บอื่นดึงข้อมูล) ใช้ปุ่ม “ส่งเด็คเข้าเกม” ด้านล่าง หรือเปิด <a href="https://bottcg.com/api/decks/${idm[1]}" target="_blank" rel="noopener">ข้อมูลเด็คนี้</a> แล้วคัดลอกข้อความทั้งหมดมาวางช่องนี้`, false); return; }
          d = deckFromJson(j);
        } else d = deckFromText(text);
      }
    } catch (e) { importMsg('อ่านข้อมูลไม่ได้: ' + esc(e.message), false); return; }
    const total = Object.values(d.main).reduce((a, b) => a + b, 0);
    if (!total) { importMsg('ไม่พบการ์ดในข้อความที่วาง', false); return; }
    d.imported = true; d.key = 'u' + Date.now();
    const errs = TAL.validateDeck(db, d);
    imported = imported.filter(x => x.name !== d.name); imported.unshift(d);
    try { localStorage.setItem('tal_imported_decks', JSON.stringify(imported.slice(0, 20))); } catch (e) { /* storage unavailable */ }
    decks = imported.concat(decks.filter(x => !x.imported));
    renderLists(0, +$('#aiDeck').value + 1 <= decks.length - 1 ? Math.min(+$('#aiDeck').value + 1, decks.length - 1) : 0);
    $('#importText').value = '';
    importMsg(`นำเข้า "${esc(d.name)}" แล้ว (${total} ใบ + LIFE ${d.life.length})` + (d.unknown.length ? ` · ไม่รู้จัก ${d.unknown.length} ใบ: ${esc(d.unknown.slice(0, 6).join(', '))}` : '') + (errs.length ? `<br>หมายเหตุกติกา: ${esc(errs.join(' · '))}` : ''), !errs.length);
  }


  /* ---------------- deck manager ---------------- */
  const persistImported = () => { try { localStorage.setItem('tal_imported_decks', JSON.stringify(imported.slice(0, 40))); } catch (e) { /* storage unavailable */ } };
  const deckTotal = (d) => Object.values(d.main).reduce((a, b) => a + b, 0);
  function openManager() {
    const src = decks[+$('#myDeck').value];
    const ed = { key: src.imported ? src.key : null, name: src.imported ? src.name : src.name + ' (แก้ไข)', main: Object.assign({}, src.main), life: (src.life || []).slice() };
    let q = '', tab = 'main';
    const m = modal('');
    const nameOf = (id) => db.cards[id] ? db.cards[id].name : id;
    const sup = (id) => TAL.cardSupported(db, id);
    const sortedIds = () => Object.keys(ed.main).filter(id => db.cards[id]).sort((a, b) => {
      const A = db.cards[a], B = db.cards[b]; const ta = ['Avatar', 'Construct', 'Magic'].indexOf(A.type), tb = ['Avatar', 'Construct', 'Magic'].indexOf(B.type);
      return ta - tb || (A.cost || 0) - (B.cost || 0) || a.localeCompare(b);
    });
    const results = () => {
      const t = q.trim().toLowerCase();
      const want = tab === 'life' ? ['LIFE'] : ['Avatar', 'Construct', 'Magic'];
      const out = [];
      for (const c of Object.values(db.cards)) {
        if (!want.includes(c.type) || c.flags.isToken || c.flags.lamiang) continue;
        if (t && !(c.id.toLowerCase().includes(t) || c.name.toLowerCase().includes(t) || (c.symbol || '').toLowerCase().includes(t) || (c.color || '').includes(t))) continue;
        out.push(c); if (out.length >= 80) break;
      }
      return out;
    };
    const meta = (c) => `${esc(c.id)} · ${esc(c.type)}${c.cost != null ? ' · Cost ' + c.cost : ''}${c.color ? ' · ' + esc(c.color) : ''}`;
    const draw = () => {
      const total = deckTotal(ed), errs = TAL.validateDeck(db, ed);
      const mainRows = sortedIds().map(id => { const c = db.cards[id]; return `<div class="drow"><img src="img/cards/${esc(id)}.webp" alt=""><span class="dn">${esc(c.name)}${sup(id) ? '' : ' <b title="ยังไม่รองรับความสามารถ จะถูกแทนที่ตอนเล่น">⚠</b>'}<em>${meta(c)}</em></span><span class="dq"><button data-act="dec" data-id="${esc(id)}">−</button><b>${ed.main[id]}</b><button data-act="inc" data-id="${esc(id)}">+</button><button data-act="del" data-id="${esc(id)}" title="เอาออก">×</button></span></div>`; }).join('') || '<div class="hint">ยังไม่มีการ์ด ค้นหาด้านขวาแล้วกด เพิ่ม</div>';
      const lifeRows = ed.life.map(id => `<div class="drow"><img src="img/cards/${esc(id)}.webp" alt=""><span class="dn">${esc(nameOf(id))}<em>${esc(id)}</em></span><span class="dq"><button data-act="dellife" data-id="${esc(id)}" title="เอาออก">×</button></span></div>`).join('') || '<div class="hint">ยังไม่มี LIFE</div>';
      const res = results().map(c => `<div class="drow res"><img src="img/cards/${esc(c.id)}.webp" alt=""><span class="dn">${esc(c.name)}${sup(c.id) ? '' : ' <b>⚠</b>'}<em>${meta(c)}</em></span><span class="dq"><button data-act="add" data-id="${esc(c.id)}">เพิ่ม</button></span></div>`).join('') || '<div class="hint">ไม่พบการ์ด</div>';
      const hadFocus = document.activeElement && document.activeElement.id === 'mgSearch';
      const pos = hadFocus ? document.activeElement.selectionStart : 0;
      m.innerHTML = `<div class="dlg mgr"><h3>จัดการเด็ค</h3>
        <div class="mname"><input id="mgName" value="${esc(ed.name)}" placeholder="ชื่อเด็ค"><span class="${total === 50 ? 'ok' : 'bad'}">${total}/50</span><span class="${ed.life.length === 5 ? 'ok' : 'bad'}">LIFE ${ed.life.length}/5</span></div>
        <div class="mcols">
          <div class="mcol"><div class="mh">ในเด็ค (Main ${total} ใบ)</div><div class="mlist">${mainRows}</div><div class="mh">LIFE</div><div class="mlist short">${lifeRows}</div></div>
          <div class="mcol"><div class="mtabs"><button data-act="tab" data-tab="main" class="${tab === 'main' ? 'on' : ''}">การ์ดหลัก</button><button data-act="tab" data-tab="life" class="${tab === 'life' ? 'on' : ''}">LIFE</button><input id="mgSearch" placeholder="ค้นหา: ชื่อ / รหัส เช่น KD01-002 / สี / Symbol" value="${esc(q)}"></div><div class="mlist tall">${res}</div></div>
        </div>
        <div class="mmsg ${errs.length ? 'bad' : 'ok'}">${errs.length ? esc(errs.slice(0, 4).join(' · ')) : 'เด็คถูกต้องตามกติกา'}</div>
        <div class="btns"><button class="primary" data-act="save">บันทึกเด็ค</button><button data-act="export">คัดลอกเป็นข้อความ</button>${ed.key ? '<button data-act="remove">ลบเด็คนี้</button>' : ''}<button data-act="close">ปิด</button></div></div>`;
      const si = m.querySelector('#mgSearch');
      si.oninput = () => { q = si.value; draw(); };
      m.querySelector('#mgName').oninput = (e) => { ed.name = e.target.value; };
      if (hadFocus) { si.focus(); si.setSelectionRange(pos, pos); }
    };
    m.onclick = (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const id = b.dataset.id, act = b.dataset.act;
      if (act === 'inc') ed.main[id] = (ed.main[id] || 0) + 1;
      else if (act === 'dec') { ed.main[id] = (ed.main[id] || 1) - 1; if (ed.main[id] <= 0) delete ed.main[id]; }
      else if (act === 'del') delete ed.main[id];
      else if (act === 'dellife') ed.life = ed.life.filter(x => x !== id);
      else if (act === 'add') {
        const c = db.cards[id];
        if (c.type === 'LIFE') {
          if (ed.life.length >= 5) { alert('LIFE ครบ 5 ใบแล้ว ลบใบเดิมก่อน'); return; }
          if (ed.life.includes(id) || ed.life.some(x => db.cards[x].name === c.name)) { alert('LIFE ต้องชื่อไม่ซ้ำกัน'); return; }
          ed.life.push(id);
        } else ed.main[id] = (ed.main[id] || 0) + 1;
      }
      else if (act === 'tab') tab = b.dataset.tab;
      else if (act === 'close') { closeModal(); m.onclick = null; return; }
      else if (act === 'export') {
        const o = { name: ed.name, cards: Object.entries(ed.main).map(([print, quantity]) => ({ print, quantity })), lifeCards: ed.life.map(print => ({ print })) };
        const txt = JSON.stringify(o);
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => alert('คัดลอกแล้ว วางในช่องนำเข้าเพื่อใช้ซ้ำได้'), () => prompt('คัดลอกข้อความนี้', txt));
        return;
      }
      else if (act === 'remove') {
        if (!confirm('ลบเด็คนี้ออกจากรายการ?')) return;
        imported = imported.filter(x => x.key !== ed.key); persistImported();
        decks = imported.concat(decks.filter(x => !x.imported)); renderLists(0, Math.min(+$('#aiDeck').value, decks.length - 1)); closeModal(); m.onclick = null; return;
      }
      else if (act === 'save') {
        if (!deckTotal(ed)) { alert('เด็คว่างเปล่า'); return; }
        const d = { name: (ed.name || 'เด็คของฉัน').trim(), main: Object.assign({}, ed.main), life: ed.life.slice(), imported: true, key: ed.key || ('u' + Date.now()) };
        const i = imported.findIndex(x => x.key === d.key);
        if (i >= 0) imported[i] = d; else imported.unshift(d);
        persistImported();
        decks = imported.concat(decks.filter(x => !x.imported));
        renderLists(Math.max(0, decks.findIndex(x => x.key === d.key)), Math.min(+$('#aiDeck').value + (i >= 0 ? 0 : 1), decks.length - 1));
        closeModal(); m.onclick = null;
        const errs = TAL.validateDeck(db, d);
        importMsg(`บันทึก "${esc(d.name)}" แล้ว (${deckTotal(d)} ใบ + LIFE ${d.life.length})` + (errs.length ? '<br>หมายเหตุกติกา: ' + esc(errs.join(' · ')) : ''), !errs.length);
        return;
      }
      draw();
    };
    draw();
  }


  /* short on-screen notice for the things that change the board (so a card never "just disappears") */
  let toastTimer = null;
  function toast(m) {
    if (!/ถูกทำลาย|ต่อสู้:|ถูกยกเลิก|ไม่ถูกทำลาย|ส่งลงนรก|โจมตี|ธรณีสูบ|เนรเทศ|ใช้ .*Magic|สั่งใช้|ทิ้ง |ลด POWER|ยึด/.test(m)) return;
    let t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    const line = document.createElement('div'); line.textContent = m; t.appendChild(line);
    while (t.children.length > 3) t.removeChild(t.firstChild);
    t.classList.add('on'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('on'); t.innerHTML = ''; }, 3200);
  }

  /* ---------------- card html ---------------- */
  function cardHtml(c, o) {
    o = o || {};
    if (!c) return '';
    const hidden = o.hidden || (!o.reveal && c.zone === 'life' && !c.faceUp);
    const cls = ['card'];
    if (o.big) cls.push('big');
    if (c.state === 'rested' && (c.zone === 'avatarZone' || c.zone === 'constructZone')) cls.push('rested');
    if (ui.can.has(c.uid)) cls.push('can');
    if (o.sel) cls.push('sel');
    if (c.zone === 'life' && c.faceUp) cls.push('faceup-life');
    if (hidden) return `<div class="${cls.join(' ')} back" data-uid="${c.uid}" data-hidden="1"></div>`;
    let badge = '';
    if ((c.zone === 'avatarZone' || c.zone === 'constructZone') && game) {
      const p = game.getPower(c), base = c.def.power || 0;
      badge += `<span class="pw ${p > base ? 'up' : p < base ? 'down' : ''}">${p}</span>`;
      if (c.equipped.length) badge += `<span class="eq">+${c.equipped.length}</span>`;
      if (c.inPartner) badge += `<span class="st">คู่หู</span>`;
    }
    const img = c.id !== 'TOKEN' ? `<img class="cimg" src="img/cards/${esc(c.id)}.webp" alt="" data-name="${esc(c.def.name)}">` : `<div class="fallback"><b>${esc(c.def.name)}</b><br>POWER ${c.def.power}<br>Token</div>`;
    return `<div class="${cls.join(' ')}" data-uid="${c.uid}">${img}${badge}${o.extra || ''}</div>`;
  }
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.classList.contains('cimg')) {
      const d = document.createElement('div'); d.className = 'fallback'; d.innerHTML = `<b>${esc(t.dataset.name)}</b>`;
      t.replaceWith(d);
    }
  }, true);

  /* ---------------- board render ---------------- */
  const MAT = { // zone rectangles on the original play-mat art (percent of the 1073x323 image, opponent orientation)
    deck: [1.7, 5.6, 9.5, 40.9], hell: [1.4, 49.5, 9.8, 46.4], dark: [12.6, 62, 15.4, 34], magic: [13.1, 1.5, 74, 28],
    avatar: [13.1, 31.9, 74, 27.6], land: [39.6, 66.6, 20, 29.4], construct: [60.6, 63.5, 26.6, 32.5], life: [88.5, 6.8, 9.8, 78.4],
  };
  const useMat = () => true;
  const zbox = (k, flip, extra) => {
    const [l, t, w, h] = MAT[k];
    const L = flip ? 100 - l - w : l, T = flip ? 100 - t - h : t;
    return `<div class="zb z-${k}${extra || ''}" style="left:${L}%;top:${T}%;width:${w}%;height:${h}%">`;
  };
  function renderMat(pi) {
    const g = game, pl = g.players[pi], flip = pi === 0;
    const cards = (list) => list.map(c => cardHtml(c)).join('');
    const hellTop = pl.hell[pl.hell.length - 1];
    const canL = pi === 1 && ui.canLife;
    let h = `<div class="mat${flip ? ' flip' : ''}">`;
    h += `<div class="mat-name">${esc(pl.name)} · Deck ${pl.deck.length} · มือ ${pl.hand.length}</div>`;
    h += zbox('deck', flip) + `<div class="card back deckimg"></div><span class="cnt">${pl.deck.length}</span></div>`;
    h += zbox('hell', flip) + `<a href="#" data-view="hell${pi}" class="viewlink">${hellTop ? cardHtml(hellTop, { reveal: true }) : ''}<span class="cnt">${pl.hell.length}</span></a></div>`;
    h += zbox('dark', flip) + `<a href="#" data-view="dark${pi}" class="viewlink"><span class="cnt">${pl.dark.length}</span></a></div>`;
    h += zbox('magic', flip, ' zc') + cards(pl.magicZone) + '</div>';
    h += zbox('avatar', flip, ' zc') + cards(pl.avatarZone) + '</div>';
    h += zbox('land', flip, ' zc') + cards(g.land.filter(c => c.ctrl === pi)) + '</div>';
    h += zbox('construct', flip, ' zc') + cards(pl.constructZone) + '</div>';
    h += zbox('life', flip, ' zlife' + (canL ? ' can' : '')) + `<div class="lifecol" data-life="${pi}">${pl.life.map(c => cardHtml(c, { reveal: c.faceUp })).join('')}</div></div>`;
    return h + '</div>';
  }

  function renderSide(pi) {
    const g = game, pl = g.players[pi];
    const el = $('#side' + pi);
    if (document.body.classList.contains('matmode')) { el.innerHTML = renderMat(pi); return; }
    const hide = pi === 1;
    const lifeHtml = pl.life.map(c => cardHtml(c, { reveal: c.faceUp })).join('');
    const canL = pi === 1 && ui.canLife;
    const info = `<div class="info"><b>${esc(pl.name)}</b><br>Deck ${pl.deck.length} · มือ ${pl.hand.length}<br>
      <a href="#" data-view="hell${pi}">นรก ${pl.hell.length}</a> · <a href="#" data-view="dark${pi}">มิติมืด ${pl.dark.length}</a><br>
      <div class="lifebox target-life${canL ? ' can' : ''}" data-life="${pi}">${lifeHtml}</div></div>`;
    const row = (label, list) => `<div class="zone"><span class="zl">${label}</span><div class="row">${list.map(c => cardHtml(c)).join('')}</div></div>`;
    el.innerHTML = info + `<div class="zones">${row('Avatar Zone', pl.avatarZone)}${row('Magic Zone', pl.magicZone)}${row('Construct Zone', pl.constructZone)}</div>`;
  }
  function render() {
    const g = game;
    if (!g) return;
    document.body.classList.toggle('matmode', useMat());
    document.querySelectorAll('#phases span').forEach(s => s.classList.toggle('on', s.dataset.p === g.phase));
    renderSide(1); renderSide(0);
    if (!document.body.classList.contains('matmode')) $('#landZone').innerHTML = `<span class="zl">Land Magic Zone</span><div class="row">${g.land.map(c => cardHtml(c)).join('')}</div>`;
    $('#handArea').innerHTML = g.players[0].hand.map(c => cardHtml(c, { big: true })).join('');
    const oh = $('#oppHand'); if (oh) oh.innerHTML = g.players[1].hand.map(c => `<div class="card back" data-hidden="1"></div>`).join('');
    if (!ui.statusFixed) {
      const who = g.active === 0 ? 'ตาของคุณ' : 'ตาของ AI';
      $('#status').textContent = g.over ? '' : `เทิร์น ${g.turn} · ${who}${g.phase ? ' · ' + g.phase : ''}${ui.wait ? '' : ' · AI กำลังเล่น…'}`;
    }
  }
  function setStatus(t) { $('#status').textContent = t; ui.statusFixed = !!t; }

  /* ---------------- interaction plumbing ---------------- */
  document.addEventListener('click', (e) => {
    const view = e.target.closest('[data-view]');
    if (view) { e.preventDefault(); showZoneView(view.dataset.view); return; }
    const life = e.target.closest('[data-life]');
    if (life && ui.canLife && ui.onLife && life.dataset.life === '1') { ui.onLife(); return; }
    const card = e.target.closest('#game [data-uid]');
    if (card && ui.onCard && ui.can.has(+card.dataset.uid)) ui.onCard(+card.dataset.uid);
  });
  document.addEventListener('mouseover', (e) => {
    const card = e.target.closest('[data-uid]');
    const pv = $('#preview');
    if (!card || card.dataset.hidden || !game) { pv.hidden = true; return; }
    const c = game.uidMap[+card.dataset.uid];
    if (!c) { pv.hidden = true; return; }
    const pwr = (c.zone === 'avatarZone' || c.zone === 'constructZone') ? ` · POWER ${game.getPower(c)}` : '';
    pv.innerHTML = `<img src="img/cards/${esc(c.id)}.webp" alt=""><p><b>${esc(c.def.name)}</b>${pwr}\n${esc(c.def.text || '')}</p>`;
    pv.hidden = false;
  });
  function bar(buttons) {
    const b = $('#actionBar'); b.innerHTML = '';
    for (const x of buttons) {
      const btn = document.createElement('button'); btn.textContent = x.label; if (x.cls) btn.className = x.cls;
      btn.onclick = x.fn; b.appendChild(btn);
    }
  }
  function clearInteract() { ui.can = new Set(); ui.canLife = false; ui.onCard = null; ui.onLife = null; ui.wait = false; bar([]); setStatus(''); }
  function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="dlg">${html}</div>`; m.hidden = false; return m; }
  function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

  function showZoneView(key) {
    const pi = +key.slice(-1), z = key.slice(0, -1);
    const list = game.players[pi][z];
    const m = modal(`<h3>${z === 'hell' ? 'นรก' : 'มิติมืด'} ของ ${esc(game.players[pi].name)} (${list.length})</h3><div class="cards">${list.map(c => cardHtml(c, { reveal: true })).join('') || '<span class="hint">ว่าง</span>'}</div><div class="btns"><button id="zv">ปิด</button></div>`);
    m.querySelector('#zv').onclick = closeModal;
  }

  /* ---------------- human decisions ---------------- */
  function humanDecide(req, g) {
    return new Promise((resolve) => {
      const done = (v) => { clearInteract(); closeModal(); resolve(v); };
      ui.wait = true;
      render();
      switch (req.kind) {
        case 'action': return actionReq(req, g, done);
        case 'attack': return attackReq(req, g, done);
        case 'target': return targetReq(req, g, done);
        case 'confirm': return confirmReq(req, done);
        case 'options': return optionsReq(req, done);
        case 'respond': return respondReq(req, g, done);
        case 'pick': case 'pay': return pickReq(req, g, done);
        default: return done([]);
      }
    });
  }

  function actionReq(req, g, done) {
    const byCard = {}, extras = [];
    for (const a of req.actions) { if (a.type === 'endPhase' || a.card == null) extras.push(a); else (byCard[a.card] = byCard[a.card] || []).push(a); }
    ui.can = new Set(Object.keys(byCard).map(Number));
    setStatus('ตาของคุณ (Main Phase): คลิกการ์ดที่เรืองแสงเพื่อเล่น หรือกดปุ่มด้านล่าง');
    ui.onCard = (uid) => {
      const list = byCard[uid];
      const run = (a) => done([a.id]);
      if (list.length === 1 && ['summon', 'build', 'land', 'modify'].includes(list[0].type)) return run(list[0]);
      const m = modal(`<h3>เลือกการกระทำ</h3><div class="btns">${list.map((a, i) => `<button data-i="${i}" title="${esc(a.text || '')}">${esc(a.label)}</button>`).join('')}<button data-i="x">ยกเลิก</button></div>${list.map(a => a.text ? `<p class="hint">${esc(a.text)}</p>` : '').join('')}`);
      m.querySelectorAll('button').forEach(b => b.onclick = () => { if (b.dataset.i === 'x') { closeModal(); return; } run(list[+b.dataset.i]); });
    };
    bar(extras.map(a => ({ label: a.label, cls: a.type === 'endPhase' ? 'primary' : '', fn: () => done([a.id]) })));
    render();
  }

  function attackReq(req, g, done) {
    const byCard = {}; req.attackers.forEach(a => { byCard[a.card] = a; });
    const acts = {}; (req.actions || []).forEach(a => { (acts[a.card] = acts[a.card] || []).push(a); });
    ui.can = new Set(Object.keys(byCard).concat(Object.keys(acts)).map(Number));
    setStatus('Battle Phase: คลิก Avatar ที่จะโจมตี' + (req.actions && req.actions.length ? ' หรือการ์ดที่สั่งใช้ได้' : ''));
    ui.onCard = (uid) => {
      if (acts[uid] && !byCard[uid]) {
        const list = acts[uid];
        if (list.length === 1) return done([{ act: list[0].id }]);
        const m = modal(`<h3>เลือกการกระทำ</h3><div class="btns">${list.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`);
        m.querySelectorAll('button').forEach(b => b.onclick = () => done([{ act: list[+b.dataset.i].id }]));
        return;
      }
      if (acts[uid]) {
        const list = acts[uid];
        const m = modal(`<h3>เลือกการกระทำ</h3><div class="btns"><button data-i="atk">โจมตี</button>${list.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('')}</div>`);
        m.querySelectorAll('button').forEach(b => b.onclick = () => done(b.dataset.i === 'atk' ? [byCard[uid].id] : [{ act: list[+b.dataset.i].id }]));
        return;
      }
      done([byCard[uid].id]);
    };
    bar([{ label: 'จบ Battle Phase', cls: 'primary', fn: () => done([]) }]);
    render();
  }
  function targetReq(req, g, done) {
    const byCard = {}; let lifeT = null;
    req.targets.forEach(t => { if (t.card == null) lifeT = t; else byCard[t.card] = t; });
    ui.can = new Set(Object.keys(byCard).map(Number));
    ui.canLife = !!lifeT; if (lifeT) ui.onLife = () => done([lifeT.id]);
    setStatus('เลือกเป้าหมายการโจมตี: Avatar/Construct ของ AI หรือ LIFE (กรอบประ)');
    ui.onCard = (uid) => done([byCard[uid].id]);
    bar([]);
    render();
  }
  function confirmReq(req, done) {
    const m = modal(`<h3>${esc(req.prompt)}</h3><div class="btns"><button class="primary" id="y">ใช่</button><button id="n">ไม่</button></div>`);
    m.querySelector('#y').onclick = () => done(true); m.querySelector('#n').onclick = () => done(false);
  }
  function optionsReq(req, done) {
    const m = modal(`<h3>${esc(req.prompt)}</h3><div class="btns">${req.options.map((o, i) => `<button data-i="${i}">${esc(o.label)}</button>`).join('')}</div>`);
    m.querySelectorAll('button').forEach(b => b.onclick = () => done([req.options[+b.dataset.i].id]));
  }
  function respondReq(req, g, done) {
    const m = modal(`<h3>ตอบโต้ได้ — ${esc(req.event || '')}${req.ctxInfo ? ' (' + esc(req.ctxInfo) + ')' : ''}</h3>
      ${req.options.map((o, i) => `<div class="offer">${cardHtml(g.uidMap[o.card], { reveal: true })}<p><b>${esc(o.label)}</b><br>${esc(o.text)}</p><button data-i="${i}" class="primary">ใช้</button></div>`).join('')}
      <div class="btns"><button id="skip">ไม่ใช้</button></div>`);
    m.querySelectorAll('button[data-i]').forEach(b => b.onclick = () => done([req.options[+b.dataset.i].id]));
    m.querySelector('#skip').onclick = () => done([]);
  }
  function pickReq(req, g, done) {
    const cards = req.cards.map(u => g.uidMap[u]).filter(Boolean);
    const sel = new Set();
    const isPay = req.kind === 'pay';
    const min = isPay ? 1 : (req.min || 0), max = isPay ? 99 : (req.max == null ? cards.length : req.max);
    const m = modal('');
    const draw = () => {
      const chosen = [...sel];
      const total = isPay ? chosen.reduce((s, u) => s + (req.gems[u] || 0), 0) : 0;
      const valid = (isPay ? true : (chosen.length >= min && chosen.length <= max)) && (!req.validate || (chosen.length === 0 && !isPay && min === 0) || req.validate(chosen));
      m.innerHTML = `<div class="dlg"><h3>${esc(req.prompt)}</h3>
        <div class="hint">${isPay ? `รวม GEM ${total} / ต้องใช้ ${req.cost} (ห้ามเกินจนมีการ์ดที่ทิ้งเพิ่มโดยไม่จำเป็น)` : `เลือก ${chosen.length} / ${min === max ? min : min + '–' + max}`}</div>
        <div class="cards">${cards.map(c => cardHtml(c, { big: true, reveal: true, sel: sel.has(c.uid), extra: isPay ? `<span class="gemtag">${req.gems[c.uid] || 0}</span>` : '' })).join('') || '<span class="hint">ไม่มีการ์ดให้เลือก</span>'}</div>
        <div class="btns"><button class="primary" id="ok" ${valid ? '' : 'disabled'}>ตกลง</button>${isPay ? '<button id="cancel">ยกเลิก</button>' : ''}</div></div>`;
      m.querySelectorAll('.card[data-uid]').forEach(el => el.onclick = () => {
        const u = +el.dataset.uid;
        if (sel.has(u)) sel.delete(u); else if (isPay || sel.size < max) sel.add(u);
        draw();
      });
      m.querySelector('#ok').onclick = () => done([...sel]);
      const cb = m.querySelector('#cancel'); if (cb) cb.onclick = () => done(null);
    };
    draw();
  }

  /* ---------------- game start ---------------- */
  async function startGame() {
    const my = TAL.adaptDeck(db, decks[+$('#myDeck').value], Math.random);
    const ai = TAL.adaptDeck(db, decks[+$('#aiDeck').value], Math.random);
    $('#menu').hidden = true; $('#game').hidden = false; $('#logPanel').innerHTML = '';
    const aiDecide = TAL.makeAI(1);
    const setups = [
      { name: 'คุณ', main: my.main, life: my.life, isHuman: true, decide: humanDecide },
      { name: 'AI', main: ai.main, life: ai.life, decide: async (req, g) => { render(); await sleep(req.kind === 'action' || req.kind === 'attack' ? 650 : 250); return aiDecide(req, g); } },
    ];
    game = new TAL.Game(db, setups, {
      onLog: (m) => { const p = $('#logPanel'); const d = document.createElement('div'); d.textContent = m; p.appendChild(d); p.scrollTop = p.scrollHeight; toast(m); },
      onChange: () => render(),
    });
    try {
      const res = await game.run();
      render();
      const win = res && res.winner === 0;
      const why = { life: 'LIFE ถูกทำลายครบ', 'deck-out': 'Deck หมด' }[res && res.reason] || '';
      const m = modal(`<h3>${win ? 'คุณชนะ!' : 'คุณแพ้'}</h3><p class="hint">${esc(why)}</p><div class="btns"><button class="primary" id="again">กลับเมนู</button></div>`);
      m.querySelector('#again').onclick = () => { closeModal(); $('#game').hidden = true; $('#menu').hidden = false; game = null; };
    } catch (e) {
      console.error(e);
      modal(`<h3>เกิดข้อผิดพลาด</h3><p class="hint">${esc(e && e.message)}</p><div class="btns"><button id="r">กลับเมนู</button></div>`).querySelector('#r').onclick = () => location.reload();
    }
  }

  /* touch: long-press a card to preview it */
  let lp = null;
  document.addEventListener('touchstart', (e) => {
    const card = e.target.closest('[data-uid]');
    if (!card || !game || card.dataset.hidden) return;
    lp = setTimeout(() => { const c = game.uidMap[+card.dataset.uid]; if (!c) return; const pv = $('#preview');
      pv.innerHTML = `<img src="img/cards/${esc(c.id)}.webp" alt=""><p><b>${esc(c.def.name)}</b>
${esc(c.def.text || '')}</p>`; pv.hidden = false; }, 450);
  }, { passive: true });
  const endLp = () => { clearTimeout(lp); const pv = $('#preview'); if (pv) setTimeout(() => { pv.hidden = true; }, 150); };
  document.addEventListener('touchend', endLp, { passive: true }); document.addEventListener('touchcancel', endLp, { passive: true });
  /* fullscreen + landscape lock where the browser allows it (Android Chrome; iOS Safari does not support it) */
  $('#fsBtn').onclick = async () => {
    try { await document.documentElement.requestFullscreen(); } catch (e) { /* ignore */ }
    try { await screen.orientation.lock('landscape'); } catch (e) { /* ignore */ }
  };
  window.addEventListener('resize', () => { if (game) render(); });
  /* iPhone/iPad Safari has no Fullscreen API: hide those buttons and show how to install it as an app instead */
  if (!document.documentElement.requestFullscreen) { for (const id of ['#fsBtn', '#fsGameBtn']) { const b = $(id); if (b) b.hidden = true; } }
  if (matchMedia('(pointer:coarse)').matches) { const f = document.querySelector('.mfoot'); if (f) f.textContent = 'เล่นเต็มจอบนมือถือ: กดปุ่มแชร์ แล้วเลือก “เพิ่มไปยังหน้าจอโฮม” · โปรเจกต์แฟนเมด ไม่แสวงหากำไร'; }
  $('#fsGameBtn').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (e) { /* not allowed */ }
    try { if (document.fullscreenElement && window.innerWidth < 900) await screen.orientation.lock('landscape'); } catch (e) { /* unsupported */ }
  };
  document.addEventListener('fullscreenchange', () => { if (game) render(); });
  $('#startBtn').onclick = startGame;
  $('#logToggle').onclick = () => { const p = $('#logPanel'); p.hidden = !p.hidden; };
  $('#quitBtn').onclick = () => { if (confirm('ออกจากเกม?')) location.reload(); };
  load().catch(e => { $('#startBtn').textContent = 'โหลดข้อมูลไม่สำเร็จ: ' + e.message; });
})();
