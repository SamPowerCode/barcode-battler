import './style.css';
import { registerSW } from 'virtual:pwa-register';
import {
  STARTERS, ITEMS, BAG_MAX, derive, eff, isItem, itemKind, randomGtin, rollHit, xpForWin, XP_FOR_LOSS,
  applyXp, r10, digitsOnly, isValidLength,
} from './game.js';
import { drawSprite, drawBars, LCD_INK } from './draw.js';
import { openScanner, detectInImage } from './scanner.js';

registerSW({ immediate: true });

const $ = (s) => document.querySelector(s);
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const TYPE_STYLE = {
  STORM: { bg: '#2A3A9E', ink: '#FFFFFF', ghost: 'rgba(255,255,255,0.12)' },
  SWAMP: { bg: '#23704A', ink: '#FFFFFF', ghost: 'rgba(255,255,255,0.12)' },
  FLAME: { bg: '#FF7A1A', ink: '#1A1208', ghost: 'rgba(26,18,8,0.1)' },
};
const SAVE_KEY = 'barbrawl.v1';

// ---------- state ----------
const S = {
  power: true, screen: 'scan', roster: [], items: [], active: -1, view: -1, sound: true,
  tag: null, battle: null, result: null, lastItem: null, itemSel: 0, scanning: false, timer: null,
};

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (d && Array.isArray(d.roster)) {
      S.roster = d.roster;
      S.items = Array.isArray(d.items) ? d.items : [];
      S.active = typeof d.active === 'number' && d.active < d.roster.length ? d.active : -1;
      S.sound = d.sound !== false;
    }
  } catch { /* no save yet */ }
}
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ roster: S.roster, items: S.items, active: S.active, sound: S.sound }));
  } catch { /* storage unavailable */ }
}

// ---------- LCD ----------
const lcd = $('#lcd');

function segs(cur, max) {
  const on = cur <= 0 ? 0 : Math.max(1, Math.ceil((cur / max) * 10));
  let h = '';
  for (let i = 0; i < 10; i++) h += `<div class="seg${i < on ? ' on' : ''}"></div>`;
  return `<div class="bar">${h}</div>`;
}

function render() {
  $('#led').classList.toggle('on', S.power);
  lcd.className = 'lcd';
  if (!S.power) { lcd.classList.add('off'); lcd.innerHTML = ''; return; }
  ({ scan: scrScan, reveal: scrReveal, item: scrItem, battle: scrBattle, result: scrResult })[S.screen]();
}

function scrScan() {
  lcd.classList.add('center');
  const n = S.roster.length;
  lcd.innerHTML = `
    <div class="row t16"><span>READY</span><span>${S.sound ? 'SND ON' : 'SND OFF'}</span></div>
    <div class="t40">SWIPE A<br>BARCODE</div>
    <canvas id="scanBars"></canvas>
    <div class="t28 blink" style="letter-spacing:6px">&gt;&gt;&gt;&gt;&gt;&gt;</div>
    <div class="t16">${n ? `A: PICK FIGHTER (${n})` : 'ANY PRODUCT WORKS'}</div>`;
  drawBars($('#scanBars'), '0123456789', 44, LCD_INK);
}

function scrReveal() {
  const f = S.roster[S.view];
  const e = eff(f);
  const n = S.roster.length;
  const flags = [f.real && 'REAL', f.rare && 'RARE'].filter(Boolean).join(' ');
  lcd.innerHTML = `
    <div class="row t20 rule"><span>${S.tag || `ROSTER ${S.view + 1}/${n}`}</span><span>LV ${f.lv}</span></div>
    <div class="rev"><canvas class="spr" id="sView"></canvas>
      <div class="stats t22"><span class="t28">${f.name}</span><span>${f.type}</span>
        <span>HP ${e.hp}</span><span>ST ${e.st}</span><span>DF ${e.df}</span></div></div>
    <div class="row t16"><span>#${f.code}</span><span>${flags}</span></div>
    <div class="row t16"><span>XP ${f.xp}/${f.lv * 100}</span><span>WINS ${f.wins}</span></div>
    <div class="t16">A:FIGHT  B:BACK${n > 1 ? '  &lt; &gt;' : ''}</div>`;
  drawSprite($('#sView'), f.shape, 9);
}

function scrItem() {
  lcd.classList.add('center');
  const it = S.lastItem;
  lcd.innerHTML = `
    <div class="t22">${it.full ? 'BAG FULL!' : 'ITEM GET!'}</div>
    <div class="t52">${it.kind}</div>
    <div class="t22">${ITEMS[it.kind]}</div>
    <div class="t20">BAG ${S.items.length}/${BAG_MAX}</div>
    <div class="t16 blink">PRESS A</div>`;
}

function scrBattle() {
  const b = S.battle;
  const anim = b.anim;
  b.anim = null;
  let hint = '. . .';
  if (b.turn === 'you' && !b.busy) {
    hint = S.items.length
      ? `A:ATK  B:${S.items[S.itemSel % S.items.length]} (${S.items.length})${S.items.length > 1 ? ' &lt;&gt;' : ''}`
      : 'A:ATTACK  B:NO ITEMS';
  }
  const shake = (t) => (anim && anim.shake && anim.target === t ? ' shake' : '');
  lcd.innerHTML = `
    <div class="row t20"><span>${b.foe.rec.name} L${b.foe.rec.lv}</span><span>${b.foe.cur}</span></div>
    ${segs(b.foe.cur, b.foe.max)}
    <div class="arena">
      <canvas id="sFoe" class="spr foe${shake('foe')}"></canvas>
      <canvas id="sYou" class="spr you${shake('you')}"></canvas>
      ${anim && anim.text ? `<span class="dmg t28 pop ${anim.target}">${anim.text}</span>` : ''}
    </div>
    <div class="row t20"><span>${b.you.rec.name} L${b.you.rec.lv}</span><span>${b.you.cur}</span></div>
    ${segs(b.you.cur, b.you.max)}
    <div class="box t20">${b.msg}</div>
    <div class="t16">${hint}</div>`;
  drawSprite($('#sFoe'), b.foe.rec.shape, 5);
  drawSprite($('#sYou'), b.you.rec.shape, 6);
}

function scrResult() {
  lcd.classList.add('center');
  const r = S.result;
  lcd.innerHTML = `
    <div class="t52">${r.win ? 'YOU WIN!' : 'YOU LOSE'}</div>
    <canvas class="spr" id="sView"></canvas>
    <div class="t20">${r.win ? 'BEAT' : 'LOST TO'} ${r.foe}</div>
    <div class="t22">+${r.gain} XP${r.to > r.from ? `  LV ${r.from} &gt; ${r.to}` : ''}</div>
    <div class="t16 blink">PRESS A</div>`;
  drawSprite($('#sView'), S.roster[S.active].shape, 6);
}

// ---------- sound & haptics ----------
let actx = null;
function beep(f, d = 0.06, delay = 0) {
  if (!S.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + delay;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'square'; o.frequency.value = f; g.gain.value = 0.035;
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d);
  } catch { /* audio unavailable */ }
}
function tune(notes) { let t = 0; for (const [f, d] of notes) { beep(f, d, t); t += d + 0.02; } }
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* no vibration */ } };

// ---------- battle ----------
function startBattle() {
  const you = S.roster[S.view];
  S.active = S.view;
  save();
  const ye = eff(you);
  const foe = derive(randomGtin());
  foe.lv = Math.max(1, you.lv + Math.floor(Math.random() * 3) - 1);
  const fe = eff(foe);
  S.battle = {
    you: { rec: you, st: ye.st, df: ye.df, max: ye.hp, cur: ye.hp },
    foe: { rec: foe, st: fe.st, df: fe.df, max: fe.hp, cur: fe.hp },
    turn: 'you', busy: false, msg: `${foe.name} APPEARS!`, anim: null,
  };
  S.itemSel = 0;
  S.screen = 'battle';
  tune([[392, 0.07], [523, 0.07], [659, 0.1]]);
  renderRoster();
}

function hit(att, def, target) {
  const b = S.battle;
  const h = rollHit({ type: att.rec.type, st: att.st }, { type: def.rec.type, df: def.df });
  if (h.miss) {
    b.msg = `${att.rec.name} MISSED!`;
    b.anim = { target, text: 'MISS', shake: false };
    beep(180, 0.1);
    return;
  }
  def.cur = Math.max(0, def.cur - h.dmg);
  const tag = h.crit ? ' CRIT!' : h.mult > 1 ? ' SUPER!' : h.mult < 1 ? ' WEAK' : '';
  b.msg = `${att.rec.name} -${h.dmg}${tag}`;
  b.anim = { target, text: `-${h.dmg}`, shake: true };
  beep(h.crit || h.mult > 1 ? 990 : 520, 0.07);
  if (target === 'you') buzz(h.crit ? [40, 40, 80] : 40);
}

function endPlayerTurn() {
  const b = S.battle;
  b.busy = true;
  if (b.foe.cur <= 0) { render(); S.timer = setTimeout(() => finish(true), 1000); return; }
  b.turn = 'foe';
  render();
  S.timer = setTimeout(foeAct, 900);
}

function foeAct() {
  const b = S.battle;
  if (!b) return;
  hit(b.foe, b.you, 'you');
  if (b.you.cur <= 0) { render(); S.timer = setTimeout(() => finish(false), 1000); return; }
  b.turn = 'you';
  b.busy = false;
  render();
}

function attack() {
  const b = S.battle;
  if (b.turn !== 'you' || b.busy) return;
  hit(b.you, b.foe, 'foe');
  endPlayerTurn();
}

function useItem() {
  const b = S.battle;
  if (b.turn !== 'you' || b.busy) return;
  if (!S.items.length) { b.msg = 'BAG IS EMPTY'; beep(200, 0.08); render(); return; }
  const kind = S.items.splice(S.itemSel % S.items.length, 1)[0];
  S.itemSel = 0;
  if (kind === 'POTION') {
    const h = r10(b.you.max * 0.4);
    b.you.cur = Math.min(b.you.max, b.you.cur + h);
    b.msg = `POTION! +${h} HP`;
    b.anim = { target: 'you', text: `+${h}`, shake: false };
  } else if (kind === 'POWER') {
    b.you.st = r10(b.you.st * 1.3);
    b.msg = `POWER! ST ${b.you.st}`;
  } else {
    b.you.df = r10(b.you.df * 1.3);
    b.msg = `GUARD! DF ${b.you.df}`;
  }
  tune([[660, 0.05], [880, 0.08]]);
  save();
  endPlayerTurn();
}

function finish(win) {
  const b = S.battle;
  const gain = win ? xpForWin(b.foe.rec.lv) : XP_FOR_LOSS;
  const { from, to } = applyXp(b.you.rec, gain);
  if (win) b.you.rec.wins++;
  S.result = { win, gain, from, to, foe: b.foe.rec.name };
  S.battle = null;
  S.screen = 'result';
  tune(win ? [[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.18]] : [[392, 0.12], [330, 0.12], [262, 0.24]]);
  buzz(win ? [30, 60, 30, 60, 120] : 200);
  save(); render(); renderRoster();
}

// ---------- device buttons ----------
function cycle(d) {
  const n = S.roster.length;
  if (!n) return;
  S.view = (S.view + d + n) % n;
  S.active = S.view;
  S.tag = null;
  save(); renderRoster();
}

function press(k) {
  buzz(8);
  if (k === 'POWER') { togglePower(); return; }
  if (!S.power) return;
  if (k === 'MODE') { S.sound = !S.sound; save(); beep(880, 0.05); render(); return; }
  const back = k === 'L' || k === 'U';
  const fwd = k === 'R' || k === 'D';
  switch (S.screen) {
    case 'scan':
      if (!S.roster.length) { beep(200, 0.08); return; }
      if (k === 'B') return;
      S.view = S.active >= 0 ? S.active : 0;
      S.tag = null; S.screen = 'reveal'; beep(660);
      break;
    case 'reveal':
      if (k === 'A') { startBattle(); break; }
      if (k === 'B') { S.screen = 'scan'; beep(440); break; }
      if (back) cycle(-1); else if (fwd) cycle(1);
      beep(600, 0.03);
      break;
    case 'item':
      S.screen = 'scan'; beep(660);
      break;
    case 'battle':
      if (k === 'A') { attack(); return; }
      if (k === 'B') { useItem(); return; }
      if (S.items.length > 1 && (back || fwd)) {
        S.itemSel = (S.itemSel + (back ? -1 : 1) + S.items.length) % S.items.length;
        beep(600, 0.03);
      }
      break;
    case 'result':
      if (k === 'A' || k === 'B') { S.view = S.active; S.tag = null; S.screen = 'reveal'; beep(660); }
      break;
  }
  render();
}

function togglePower() {
  clearTimeout(S.timer);
  S.power = !S.power;
  S.battle = null;
  S.screen = 'scan';
  if (S.power) tune([[262, 0.05], [523, 0.08]]);
  render();
}

document.querySelectorAll('[data-key]').forEach((b) => {
  b.addEventListener('click', () => press(b.dataset.key));
});
window.addEventListener('keydown', (e) => {
  if (document.body.classList.contains('scanning')) return;
  const t = e.target?.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  if (e.key === 'Enter' && (t === 'BUTTON' || t === 'LABEL')) return;
  const map = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D', z: 'A', Z: 'A', Enter: 'A', x: 'B', X: 'B' };
  const k = map[e.key];
  if (!k) return;
  if ('LRUD'.includes(k)) e.preventDefault();
  press(k);
});

// ---------- scanning ----------
const statusEl = $('#status');
function setStatus(msg, err = false) { statusEl.textContent = msg; statusEl.classList.toggle('err', err); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const busyForScan = () => S.power && S.screen === 'battle';

function cardHTML(code) {
  const s = STARTERS[code];
  const t = s ? TYPE_STYLE[s.type] : { bg: '#ECE7DC', ink: '#141626' };
  return `<div class="card-top" style="background:${t.bg};color:${t.ink}">
      <span><span class="card-name">${s ? s.name : 'PRODUCT'}</span><span class="chip">${s ? s.type : '???'}</span></span>
      ${s ? `<canvas class="spr" data-shape="${code}"></canvas>` : ''}
    </div>
    <div class="card-bot"><canvas data-bars="${code}"></canvas><small>${code}</small></div>`;
}
function paintCard(root, big) {
  root.querySelectorAll('canvas[data-shape]').forEach((cv) => {
    const s = STARTERS[cv.dataset.shape];
    const t = TYPE_STYLE[s.type];
    drawSprite(cv, s.shape, big ? 5 : 4, t.ink, t.ghost);
  });
  root.querySelectorAll('canvas[data-bars]').forEach((cv) => drawBars(cv, cv.dataset.bars, big ? 34 : 26, '#141626'));
}

function swipeAnim(code) {
  const el = $('#swipe');
  el.innerHTML = cardHTML(code);
  paintCard(el, true);
  if (reduceMotion || !el.animate) return wait(250);
  return el.animate([
    { transform: 'translateY(-50px)', opacity: 0 },
    { transform: 'translateY(0)', opacity: 1, offset: 0.3 },
    { transform: 'translateY(0)', opacity: 1, offset: 0.45 },
    { transform: 'translateY(150px)', opacity: 1, offset: 0.95 },
    { transform: 'translateY(150px)', opacity: 0 },
  ], { duration: 900, easing: 'ease-in-out' }).finished.catch(() => {});
}

async function scanCode(raw) {
  const code = digitsOnly(raw);
  if (!isValidLength(code)) { setStatus('Barcodes have 6 to 14 digits. Check the number and try again.', true); return; }
  if (S.scanning) return;
  if (busyForScan()) { setStatus('Finish the battle before scanning another code.', true); return; }
  S.scanning = true;
  if (!S.power) { S.power = true; S.screen = 'scan'; render(); }
  setStatus(`Scanning ${code}…`);
  await swipeAnim(code);
  const led = $('#led');
  led.classList.remove('flash'); void led.offsetWidth; led.classList.add('flash');
  tune([[880, 0.04], [1320, 0.06]]);
  if (isItem(code)) {
    const kind = itemKind(code);
    const full = S.items.length >= BAG_MAX;
    if (!full) S.items.push(kind);
    S.lastItem = { kind, full };
    S.screen = 'item';
    setStatus(full
      ? `That code is a ${kind}, but your bag is full. Use an item in battle first.`
      : `That code is an item: ${kind}. It is in your bag for the next battle.`, full);
  } else {
    let idx = S.roster.findIndex((f) => f.code === code);
    if (idx >= 0) {
      S.tag = 'IN ROSTER';
      setStatus(`${S.roster[idx].name} is already in your roster.`);
    } else {
      S.roster.push(derive(code));
      idx = S.roster.length - 1;
      S.tag = 'NEW FIGHTER!';
      setStatus(`${S.roster[idx].name} joined your roster. Press A to fight.`);
    }
    S.view = S.active = idx;
    S.screen = 'reveal';
  }
  S.scanning = false;
  save(); render(); renderRoster();
}

const scannerUI = {
  root: $('#scanner'), video: $('#scanVideo'), hint: $('#scanHint'), closeBtn: $('#scanClose'), torchBtn: $('#torch'),
};

$('#cameraBtn').addEventListener('click', async () => {
  if (S.scanning) return;
  if (busyForScan()) { setStatus('Finish the battle before scanning another code.', true); return; }
  const code = await openScanner(scannerUI);
  if (code) { $('#code').value = code; scanCode(code); }
});

$('#scanForm').addEventListener('submit', (e) => { e.preventDefault(); scanCode($('#code').value); });
$('#random').addEventListener('click', () => { const c = randomGtin(); $('#code').value = c; scanCode(c); });

$('#photo').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  setStatus('Reading the photo…');
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const code = await detectInImage(cv);
    if (!code) throw new Error('notfound');
    $('#code').value = code;
    scanCode(code);
  } catch {
    setStatus('No barcode found in that photo. Try a closer, sharper, well-lit shot.', true);
  }
});

// ---------- panel ----------
function renderCards() {
  const root = $('#cards');
  root.innerHTML = Object.keys(STARTERS).map((c) =>
    `<button type="button" class="card" data-code="${c}" aria-label="Swipe ${STARTERS[c].name} card">${cardHTML(c)}</button>`).join('');
  paintCard(root, false);
  root.querySelectorAll('.card').forEach((b) => {
    b.addEventListener('click', () => { $('#code').value = b.dataset.code; scanCode(b.dataset.code); });
  });
}

function renderRoster() {
  const ul = $('#roster');
  $('#rosterEmpty').hidden = S.roster.length > 0;
  ul.innerHTML = S.roster.map((f, i) => `
    <li><button type="button" class="rost${i === S.active ? ' is-active' : ''}" data-i="${i}">
      <canvas data-i="${i}"></canvas>
      <span><b>${f.name}</b><span class="tchip t-${f.type}">${f.type}</span></span>
      <span class="meta">LV ${f.lv}<br>${f.wins} ${f.wins === 1 ? 'win' : 'wins'}</span>
    </button></li>`).join('');
  ul.querySelectorAll('canvas').forEach((cv) => drawSprite(cv, S.roster[+cv.dataset.i].shape, 3));
  ul.querySelectorAll('.rost').forEach((b) => {
    b.addEventListener('click', () => {
      if (busyForScan()) { setStatus('Finish the battle before switching fighters.', true); return; }
      S.power = true;
      S.view = S.active = +b.dataset.i;
      S.tag = null;
      S.screen = 'reveal';
      save(); render(); renderRoster(); beep(660);
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  });
}

// ---------- fit the handheld to the phone screen ----------
const deviceWrap = $('#deviceWrap');
function fitDevice() {
  const DEVICE_W = 360;
  const DEVICE_H = 840; // shell plus room for the swiping card
  const avail = deviceWrap.parentElement.clientWidth;
  let scale = Math.min(1, avail / DEVICE_W);
  if (window.innerWidth <= 720) {
    const reserved = $('#masthead').offsetHeight + $('#cameraBtn').offsetHeight + 56;
    scale = Math.min(scale, (window.innerHeight - reserved) / DEVICE_H);
  }
  deviceWrap.style.zoom = String(Math.max(0.6, scale));
}
window.addEventListener('resize', fitDevice);

load();
renderCards();
renderRoster();
render();
fitDevice();
