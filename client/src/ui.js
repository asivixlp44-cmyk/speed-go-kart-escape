import { $ } from './engine.js';
import { S, actions, net } from './state.js';
import * as BX from './bloxity.js';
import { sfx, getVolumes, setVolume, toggleMusic, musicMuted, setMusicDuck } from './audio.js';
import { QUALITIES, getQuality, setQuality } from './fx.js';
import { checkpoints } from './world.js';
import {
    CFG, STAGES, KARTS, kartById, TREADMILLS, TRAILS, BOOSTS, FREE, DAILY, QUESTS, UPGRADES,
    xpFor, maxSpeedOf, kartSpeedFor, rebirthLevel, rebirthMult, multipliers, eventState, levelCost, packAmount, packCost,
    upgradeCost, upg, questProgress, dailyStatus, rewardText, fmt, fmt1, clock, clock3, clamp, trailById, lapTime, recText, recLevel,
} from '../../shared/config.js';

const W = (n) => '🏆 ' + fmt(n);
function setHtml(node, html) { if (node && node.innerHTML !== html) node.innerHTML = html; }
function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }
const css = (h) => '#' + h.toString(16).padStart(6, '0');

const el = {
    wins: $('#winsVal'), speed: $('#speedVal'), rebCur: $('#rebCur'), reb: $('#rebVal'),
    xpFill: $('#xpFill'), levelTxt: $('#levelTxt'), xpTxt: $('#xpTxt'),
    maxSpeed: $('#maxSpeedTxt'), input: $('#speedInput'), slider: $('#speedSlider'), price2x: $('#price2x'),
    freeBadge: $('#freeBadge'), dailyBadge: $('#dailyBadge'), garageBadge: $('#garageBadge'), rebPct: $('#rebirthPct'),
    event: $('#eventBox'), quest: $('#quest'), questTxt: $('#questTxt'), starter: $('#starter'), starterTime: $('#starterTime'),
    starterPrice: $('#starterPrice'), lvlPrice: $('#lvlPrice'), lap: $('#lapBox'), lapNow: $('#lapNow'), lapBest: $('#lapBest'),
    prompt: $('#promptBtn'), promptTxt: $('#promptTxt'), hint: $('#hint'),
    spdNum: $('#spdNum'), spdMax: $('#spdMax'), spdArc: $('#spdArc'), nitroFill: $('#nitroFill'), nitroBar: $('#nitroBar'), drift: $('#driftChip'),
};
export const promptEl = el.prompt, promptTxtEl = el.promptTxt;
const packBtns = [...document.querySelectorAll('[data-pack]')];

// Speedometer ticks (drawn once)
{
    const g = $('#spdTicks');
    let s = '';
    for (let i = 0; i <= 10; i++) {
        const a = (135 + i * 27) * Math.PI / 180, r0 = i % 5 ? 33 : 30, r1 = 36;
        s += `<line x1="${(50 + Math.cos(a) * r0).toFixed(1)}" y1="${(50 + Math.sin(a) * r0).toFixed(1)}" x2="${(50 + Math.cos(a) * r1).toFixed(1)}" y2="${(50 + Math.sin(a) * r1).toFixed(1)}"/>`;
    }
    g.innerHTML = s;
}

// ----- counters -----
const shown = { wins: null, speed: null };
export function animateCounters(dt) {
    for (const key of ['wins', 'speed']) {
        const target = S[key];
        if (shown[key] === null) shown[key] = target;
        if (shown[key] === target) continue;
        if (target > shown[key] && key === 'wins') { const c = $('#winsCur'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
        const diff = target - shown[key];
        shown[key] = Math.abs(diff) < 1 ? target : shown[key] + diff * Math.min(1, dt * 7);
        if (Math.abs(target - shown[key]) < Math.max(1, target * 0.002)) shown[key] = target;
        el[key].textContent = fmt(shown[key]);
    }
}

// ----- the speedometer, every frame -----
let spdShown = -1, spdMaxShown = -1;
export function updateSpeedo(speed, max, nitro, nitroOn, drift) {
    const v = Math.round(Math.abs(speed));
    if (v !== spdShown) { spdShown = v; el.spdNum.textContent = v; }
    if (max !== spdMaxShown) { spdMaxShown = max; el.spdMax.textContent = 'MAX ' + max; }
    const k = clamp(Math.abs(speed) / Math.max(1, max * 1.35), 0, 1);
    el.spdArc.setAttribute('stroke-dasharray', (k * 100).toFixed(1) + ' 100');
    el.nitroFill.style.width = (clamp(nitro, 0, 1) * 100).toFixed(1) + '%';
    el.nitroBar.classList.toggle('on', !!nitroOn);
    const label = drift >= 3 ? '🟣 MEGA TURBO' : drift >= 2 ? '🟠 SUPER TURBO' : drift >= 1 ? '🔵 MINI TURBO' : drift > 0 ? '💨 DRIFT' : '';
    el.drift.classList.toggle('show', !!label);
    if (label) setText(el.drift, label);
}
// Stage stopwatch under the Speed counter
export function updateLap(stage, secs) {
    const on = stage >= 0 && secs !== null;
    el.lap.hidden = !on;
    if (!on) return;
    setText(el.lapNow, '⏱ ' + lapTime(secs));
    const best = S.best && S.best[String(stage)];
    setText(el.lapBest, best ? '🏅 ' + lapTime(best) : '');
}
// ----- stage progress bar: built once per stage, then only the markers move -----
let progStage = -2, progFill = null;
const progEl = { box: $('#progress'), track: $('#progTrack'), me: $('#progMe'), ghost: $('#progGhost') };
export function updateProgress(stage, z, ghostZ) {
    if (stage < 0) { if (progStage !== -1) { progStage = -1; progEl.box.hidden = true; } return; }
    const s = STAGES[stage], z0 = s.zS, z1 = s.zE;
    const at = (zz) => (clamp((zz - z0) / (z1 - z0), 0, 1) * 100).toFixed(2) + '%';
    if (progStage !== stage) {
        progStage = stage;
        progEl.box.hidden = false;
        const cps = (checkpoints[stage] || []).filter(Boolean);
        progEl.track.innerHTML = '<div class="fill"></div>'
            + cps.map((c) => '<div class="tick" style="left:' + at(c.pos.z) + '"></div>').join('')
            + '<div class="mk" style="left:' + at(s.ramp0 + 6) + '">🛫</div>'
            + '<div class="mk" style="left:' + at(z1 - 10) + '">🏆</div>';
        progFill = progEl.track.querySelector('.fill');
    }
    const p = at(z);
    progEl.me.style.left = p;
    progFill.style.width = p;
    progEl.ghost.hidden = ghostZ === null || ghostZ === undefined;
    if (!progEl.ghost.hidden) progEl.ghost.style.left = at(ghostZ);
}
// "-0.42s" (green, ahead of your best) or "+0.31s" (red) at each checkpoint
let splitT = 0;
export function showSplit(diff) {
    const e = $('#split');
    e.textContent = (diff <= 0 ? '−' : '+') + Math.abs(diff).toFixed(2) + 's';
    e.classList.toggle('ahead', diff <= 0); e.classList.toggle('behind', diff > 0);
    e.classList.add('show');
    clearTimeout(splitT); splitT = setTimeout(() => e.classList.remove('show'), 2600);
}
// What's next on the track and what to do about it
export function showSection(info, extra) {
    const c = $('#secCard');
    $('#secIc').textContent = info.icon;
    $('#secTt').textContent = info.title + (extra ? ' ' + extra : '');
    $('#secTp').textContent = info.tip;
    c.style.setProperty('--c', css(info.color));
    c.hidden = false;
    c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
    clearTimeout(showSection.t); showSection.t = setTimeout(() => { c.hidden = true; }, 3400);
}
// Start lights: 3 / 2 / 1 light up red, GO turns them green; null hides them
export function showCountdown(n) {
    const box = $('#countdown');
    clearTimeout(showCountdown.t);
    if (n === null || n === undefined) { box.hidden = true; return; }
    box.hidden = false;
    const lights = box.querySelectorAll('i'), num = $('#cdNum');
    lights.forEach((l, i) => { l.className = n === 0 ? 'green' : i < 4 - n ? 'red' : ''; });
    num.textContent = n === 0 ? 'GO!' : String(n);
    num.classList.toggle('go', n === 0);
    box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
    if (n === 0) showCountdown.t = setTimeout(() => { box.hidden = true; }, 900);
}
// "🚓 32m" chip while a police car chases you (null hides it)
export function showChase(dist) {
    const e = $('#chaseChip');
    if (dist === null || dist === undefined) { e.hidden = true; return; }
    e.hidden = false;
    const m = Math.max(0, Math.round(dist - 7));
    const t = '🚓 ' + m + 'm' + (m < 15 ? ' - FASTER!' : '');
    if (e.textContent !== t) e.textContent = t;
    e.classList.toggle('close', m < 25);
}
let hintT = 0;
export function hint(text, secs) {
    el.hint.textContent = text;
    el.hint.classList.add('show');
    clearTimeout(hintT);
    hintT = setTimeout(() => el.hint.classList.remove('show'), (secs || 2.5) * 1000);
}

// ----- HUD, ten times a second -----
let lastQuestKey = '';
export function updateHud() {
    const now = net.now();
    el.rebCur.hidden = !S.rebirths;
    setText(el.reb, String(S.rebirths));
    const need = xpFor(Math.min(S.level, CFG.maxLevel));
    el.xpFill.style.width = clamp(S.xp / need * 100, 0, 100) + '%';
    setText(el.levelTxt, S.level >= CFG.maxLevel ? 'Level MAX' : 'Level ' + S.level);
    setText(el.xpTxt, fmt1(S.xp) + '/' + fmt1(need));
    const max = maxSpeedOf(S);
    setText(el.maxSpeed, 'Max: ' + max);
    el.slider.max = max; el.slider.min = CFG.minCustom;
    const cur = S.customSpeed > 0 && S.customSpeed <= max ? S.customSpeed : max;
    if (document.activeElement !== el.input) el.input.value = cur;
    if (document.activeElement !== el.slider) el.slider.value = cur;
    setHtml(el.price2x, S.pass2x ? '✅ OWNED' : 'ONLY ' + W(BOOSTS.pass2x.cost));
    const rl = rebirthLevel(S.rebirths);
    setText(el.rebPct, S.level >= rl ? 'READY' : Math.floor(Math.min(99, (S.level - 1) / Math.max(1, rl - 1) * 100)) + '%');
    const ev = eventState(now);
    setText(el.event, ev.on ? '🏁 TURBO RUSH x2 ' + clock3(ev.left) : 'Turbo Rush In ' + clock3(ev.left));
    el.event.classList.toggle('on', ev.on);
    const mins = (now - S.joinedAt) / 60000;
    el.freeBadge.hidden = !FREE.some((r, i) => mins >= r.min && !S.freeClaimed[i]);
    el.dailyBadge.hidden = !(S.daily && dailyStatus(S.daily, now).can);
    el.garageBadge.hidden = !Object.keys(UPGRADES).some((k) => upg(S, k) < UPGRADES[k].max && S.wins >= upgradeCost(k, upg(S, k)));
    $('#btnUpgrade').classList.toggle('ready', !el.garageBadge.hidden);
    const q = QUESTS[S.quest || 0];
    const qText = q ? (q.text + ' (' + fmt(Math.min(q.n, questProgress(q, S))) + '/' + fmt(q.n) + ')') : 'All quests done! 👑';
    if (qText !== lastQuestKey) { lastQuestKey = qText; el.questTxt.textContent = qText; }
    const left = CFG.starterPackMinutes * 60 - (now - S.firstPlay) / 1000;
    el.starter.hidden = S.starterPack || left <= 0;
    if (!el.starter.hidden) { setText(el.starterTime, clock(left)); setText(el.starterPrice, 'ONLY ' + W(BOOSTS.starter.cost)); }
    setText(el.lvlPrice, W(levelCost(S.level)));
    packBtns.forEach((b, i) => {
        setText(b.querySelector('b'), '+' + fmt(packAmount(i, S.level)));
        setText(b.querySelector('.p'), W(packCost(i, S.level)));
    });
    if (!$('#modal').hidden && (modalKind === 'free' || modalKind === 'rebirth' || modalKind === 'stats')) renderModal();
    if (!$('#daily').hidden) renderDaily();
    if (teleBack.until) updateTeleBack();
    dailyTick();
}

export function toast(text, color) {
    const d = document.createElement('div');
    d.className = 'toast o'; d.textContent = text; d.style.color = color || '#fff';
    const box = $('#toasts');
    box.appendChild(d);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => d.remove(), 2600);
}
export function showGoal(n, escape, sub) {
    const g = $('#goalBanner');
    g.querySelector('.goal').textContent = escape ? '👑 ESCAPED! 👑' : '+' + fmt(n) + ' WIN' + (n > 1 ? 'S' : '') + '!';
    $('#goalSub').textContent = sub || (escape ? '+' + fmt(n) + ' Wins' : 'Back to the lobby…');
    g.hidden = false;
    g.classList.remove('show'); void g.offsetWidth; g.classList.add('show');
    clearTimeout(showGoal.t);
    showGoal.t = setTimeout(() => { g.hidden = true; }, 2700);
}
const CRASH_TEXT = {
    fall: ['TOO SLOW!', 'Level up to jump further!'], laser: ['ZAPPED!', 'Time the lasers (or HOP the low ones)'], cop: ['BUSTED!', 'The cops caught you!'],
    spinner: ['WHACKED!', 'Watch the spinning bars'], hammer: ['BONK!', 'Wait for the hammer to swing past'], tire: ['FLATTENED!', 'Dodge the rolling tyres'],
    crusher: ['CRUSHED!', 'Go when the crusher lifts'], car: ['HONK! CRASH!', 'Look out for traffic'], lava: ['TOO HOT!', 'Stay on the bridges'],
    police: ['BUSTED! 🚓', 'Keep your speed up and dodge the roadblocks'], mine: ['BOOM! 💣', 'Drive through the gap between the mines'], wall: ['SQUASHED!', 'Aim for the moving gap'],
    meteor: ['METEOR!', 'Avoid the red targets'], lightning: ['ZZZAP!', 'Avoid the yellow targets'], glitch: ['GLITCHED!', 'Follow the lit path - flickering tiles are about to vanish'],
};
export function showOof(cause, extra) {
    const o = $('#oof');
    const [a, b] = CRASH_TEXT[cause] || ['CRASH!', ''];
    $('#oofA').textContent = a; $('#oofB').textContent = extra || b;
    o.hidden = false; o.classList.remove('show'); void o.offsetWidth; o.classList.add('show');
    const f = $('#flash'); f.classList.remove('show', 'boost'); f.classList.add('dead'); void f.offsetWidth; f.classList.add('show');
    clearTimeout(showOof.t); showOof.t = setTimeout(() => { o.hidden = true; f.classList.remove('dead'); }, 1500);
}
export function flashBoost() {
    const f = $('#flash'); f.classList.remove('show', 'dead'); f.classList.add('boost'); void f.offsetWidth; f.classList.add('show');
    clearTimeout(flashBoost.t); flashBoost.t = setTimeout(() => f.classList.remove('boost'), 700);
}
// "Level Up! (4)" / "NEW KARTSPEED: 13 -> 14" (the reference's popup)
export function levelUp(m) {
    const f = $('#flash'); f.classList.remove('show', 'dead', 'boost'); void f.offsetWidth; f.classList.add('show');
    $('#lvlT').textContent = 'Level Up! (' + m.to + ')';
    $('#lvlD').textContent = 'NEW KARTSPEED: ' + m.kart[0] + ' -> ' + m.kart[1];
    const d = $('#levelPop');
    d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
}
let titleTimer;
export function showStageTitle(s) {
    $('#stageName').textContent = s.name.toUpperCase();
    const sub = $('#stageSub'); sub.textContent = s.sub || ''; sub.style.color = css(s.theme.accent === 0x141a2e ? 0xffd028 : s.theme.trim === 0x22222a ? 0xffd028 : s.theme.accent);
    const ok = maxSpeedOf(S) >= s.need;
    const rec = $('#stageRec'); rec.textContent = recText(s.need) + (ok ? ' ✓' : recLevel(s.need) <= CFG.maxLevel ? ' (you: Level ' + S.level + ')' : ' (you: ' + maxSpeedOf(S) + ')'); rec.style.color = ok ? '#7dff6b' : '#ffb04a';
    const t = $('#stageTitle'); t.style.opacity = 1;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { t.style.opacity = 0; }, 2800);
}
export function showOffline(m) {
    const h = Math.floor(m.secs / 3600), mm = Math.floor((m.secs % 3600) / 60);
    $('#offlineText').textContent = 'Your x' + m.mult + ' Speed Roller kept running for ' + (h ? h + 'h ' : '') + mm + 'm while you were away!';
    $('#offlineGain').textContent = '+' + fmt(m.speed) + ' Speed';
    $('#offlinePop').hidden = false;
    sfx('buy');
}
$('#offlineOk').addEventListener('click', () => { $('#offlinePop').hidden = true; });
export function questDone(m) {
    el.quest.classList.remove('done'); void el.quest.offsetWidth; el.quest.classList.add('done');
    toast('✅ ' + m.done + '  ' + m.reward, '#7dff6b');
    sfx('quest');
}

// ----- "Teleport Back!" after a Wins pad: on to the next stage -----
const teleBack = { until: 0, stage: -1 };
export function showTeleBack(stage) {
    teleBack.until = performance.now() + CFG.teleportBackSecs * 1000; teleBack.stage = stage;
    $('#teleBack').hidden = false;
    updateTeleBack();
}
export function hideTeleBack() { teleBack.until = 0; $('#teleBack').hidden = true; }
function updateTeleBack() {
    const left = (teleBack.until - performance.now()) / 1000;
    if (left <= 0) { hideTeleBack(); return; }
    $('#teleNum').textContent = Math.ceil(left);
    $('#teleRing').style.setProperty('--p', (left / CFG.teleportBackSecs * 100).toFixed(0) + '%');
}
$('#teleBack').addEventListener('click', () => { const s = teleBack.stage; hideTeleBack(); actions.teleportStage(s); });

// ----- buying with Wins -----
let pendingConfirm = null;
export function confirmBuy(o) {
    if (S.wins < o.cost) { toast('Not Enough Wins! (need ' + fmt(o.cost - S.wins) + ' more)', '#ff5a5a'); sfx('denied'); return; }
    // Cheap things (under a tenth of your Wins) are bought straight away
    if (o.quick && o.cost <= Math.max(3, S.wins * 0.1)) { o.onYes(); return; }
    pendingConfirm = o;
    $('#confirmIc').textContent = o.ic || '🛒';
    $('#confirmTitle').textContent = o.title || 'Buy?';
    $('#confirmText').textContent = o.text || '';
    $('#confirmCost').textContent = '🏆 ' + fmt(o.cost) + ' Wins';
    $('#confirm').hidden = false;
}
$('#confirmYes').addEventListener('click', () => { $('#confirm').hidden = true; if (pendingConfirm) pendingConfirm.onYes(); pendingConfirm = null; });
for (const id of ['#confirmNo', '#confirmClose']) $(id).addEventListener('click', () => { $('#confirm').hidden = true; pendingConfirm = null; });

export function buyBoost(id) {
    const b = BOOSTS[id];
    if (id === 'pass2x' && S.pass2x) { toast('x2 Speed is already yours!', '#6fe0ff'); return; }
    confirmBuy({ ic: b.ic, title: b.name, text: b.desc, cost: b.cost, onYes: () => net.send('boost', { id }) });
}
function buyLevel() {
    const eng = upg(S, 'engine');
    confirmBuy({ ic: '⬆️', title: '+1 Level', text: 'Level ' + S.level + ' → ' + (S.level + 1) + ' (kart speed ' + kartSpeedFor(S.level, S.rebirths, eng) + ' → ' + kartSpeedFor(S.level + 1, S.rebirths, eng) + ')', cost: levelCost(S.level), quick: true, onYes: () => net.send('level') });
}
function buyPack(i) { confirmBuy({ ic: '⚡', title: '+' + fmt(packAmount(i, S.level)) + ' Speed', text: 'Instant Speed (counts toward your level)', cost: packCost(i, S.level), quick: true, onYes: () => net.send('pack', { i }) }); }
export function buyKart(d) {
    const owned = d.id === 'wooden' || !!S.karts[d.id];
    if (owned) { net.send('kart', { id: d.id }); return; }
    if (d.pack) { toast(d.name + ' comes in the OP STARTER PACK!', '#ff8ad8'); return; }
    if (S.rebirths < d.reb) { toast('🔒 ' + d.name + ' needs ' + d.reb + ' Rebirth' + (d.reb > 1 ? 's' : '') + '!', '#ff5a5a'); sfx('denied'); return; }
    confirmBuy({ ic: '🏎️', title: d.name, text: 'x' + d.mult + ' Speed on everything you earn', cost: d.cost, quick: true, onYes: () => net.send('kart', { id: d.id }) });
}
export function buyTread(d) {
    confirmBuy({ ic: '⚙️', title: 'x' + d.mult + ' Speed Roller', text: 'Every bit of Speed on it counts x' + d.mult, cost: d.cost, onYes: () => net.send('tread', { id: d.id }) });
}
export function buyUpgrade(k) {
    const def = UPGRADES[k], n = upg(S, k);
    if (n >= def.max) { toast(def.name + ' is maxed out!', '#6fe0ff'); return; }
    confirmBuy({ ic: def.ic, title: def.name + ' Lv ' + (n + 1), text: def.desc(n + 1), cost: upgradeCost(k, n), quick: true, onYes: () => net.send('upgrade', { k }) });
}

// ----- custom speed -----
const sendCustom = (v) => net.send('custom', { v: Number(v) || 0 });
el.input.addEventListener('change', () => sendCustom(el.input.value));
el.input.addEventListener('keydown', (e) => e.stopPropagation());
el.slider.addEventListener('input', () => { el.input.value = el.slider.value; });
el.slider.addEventListener('change', () => sendCustom(el.slider.value));

// ----- buttons -----
$('#btnShop').addEventListener('click', () => openModal('shop', 'boosts'));
$('#btnKarts').addEventListener('click', () => openModal('karts'));
$('#btnGarage').addEventListener('click', () => openModal('garage'));
$('#btnUpgrade').addEventListener('click', () => openModal('garage'));
$('#btn2x').addEventListener('click', () => buyBoost('pass2x'));
$('#starter').addEventListener('click', () => buyBoost('starter'));
$('#btnLevel').addEventListener('click', buyLevel);
packBtns.forEach((b, i) => b.addEventListener('click', () => buyPack(i)));
$('#btnRebirth').addEventListener('click', () => openModal('rebirth'));
$('#btnFree').addEventListener('click', () => openModal('free'));
$('#btnTeleport').addEventListener('click', () => openModal('teleport'));
$('#btnTreadmill').addEventListener('click', () => actions.autoTrain());
$('#btnCodes').addEventListener('click', () => openModal('codes'));
$('#btnQuests').addEventListener('click', () => openModal('quests'));
$('#btnDaily').addEventListener('click', () => openDaily());
$('#btnFriends').addEventListener('click', () => openModal('friends'));
$('#btnSettings').addEventListener('click', () => openModal('settings'));
document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button, .btn, .rbx, .ib, #starter, [role="button"], .tab, input[type="range"]');
    if (b && !b.disabled && !['hopBtn', 'nitroBtn', 'brakeBtn'].includes(b.id)) sfx(b.matches('.g-green, .buy, .claim') ? 'clickBuy' : 'click');
}, true);

// ----- panels -----
let modalKind = null, modalTab = null;
export function openModal(kind, tab) { modalKind = kind; modalTab = tab || null; renderModal(); $('#modal').hidden = false; setMusicDuck(true); }
export function closeModal() { $('#modal').hidden = true; modalKind = null; setMusicDuck(false); }
export function refreshModal() { if (!$('#modal').hidden) renderModal(); }
export const modalOpen = () => !$('#modal').hidden;
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });

function rowCard(ic, name, desc, btnText, btnClass, onClick, disabled, on) {
    const d = document.createElement('div');
    d.className = 'row-card' + (on ? ' on' : '');
    d.innerHTML = '<div class="ic"></div><div><div class="nm o1"></div><div class="ds"></div></div><button class="btn o1"></button>';
    d.querySelector('.ic').textContent = ic;
    d.querySelector('.nm').textContent = name;
    d.querySelector('.ds').textContent = desc;
    const b = d.querySelector('button');
    b.classList.add(btnClass);
    b.textContent = btnText; b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return d;
}
function sec(text) { const d = document.createElement('div'); d.className = 'sec'; d.textContent = text; return d; }
function note(body, text) { const p = document.createElement('p'); p.className = 'note'; p.textContent = text; body.appendChild(p); return p; }
function tabs(list) {
    const t = $('#modalTabs');
    t.innerHTML = '';
    t.hidden = !list;
    if (!list) return;
    for (const [key, label] of list) {
        const b = document.createElement('button');
        b.className = 'btn o1 ' + (modalTab === key ? 'g-yellow' : 'g-grey');
        b.textContent = label;
        b.addEventListener('click', () => { modalTab = key; renderModal(); });
        t.appendChild(b);
    }
}

function renderModal() {
    const body = $('#modalBody'), title = $('#modalTitle');
    const keep = body.scrollTop;
    body.innerHTML = '';
    tabs(null);
    const k = modalKind;
    if (k === 'shop') {
        title.textContent = 'Shop';
        tabs([['boosts', '⚡ Boosts'], ['rollers', '⚙️ Speed Rollers'], ['trails', '✨ Trails']]);
        note(body, 'Everything is bought with Wins 🏆. Get Wins on the pads at the end of every stage!');
        if (modalTab === 'boosts') renderBoosts(body);
        else if (modalTab === 'rollers') renderTreads(body);
        else renderTrails(body);
    } else if (k === 'karts') { title.textContent = 'Go-Karts'; renderKarts(body); }
    else if (k === 'garage') { title.textContent = '🔧 Garage'; renderGarage(body); }
    else if (k === 'rebirth') { title.textContent = 'Rebirth'; renderRebirth(body); }
    else if (k === 'free') { title.textContent = 'FREE Rewards'; renderFree(body); }
    else if (k === 'teleport') { title.textContent = 'Teleport'; renderTeleport(body); }
    else if (k === 'codes') { title.textContent = 'Codes'; renderCodes(body); }
    else if (k === 'quests') { title.textContent = 'Quests'; renderQuests(body); }
    else if (k === 'stats') { title.textContent = 'Stats'; renderStats(body); }
    else if (k === 'friends') { title.textContent = 'Friends'; renderFriends(body); }
    else if (k === 'settings') { title.textContent = 'Settings'; renderSettings(body); }
    body.scrollTop = keep;
}

function renderBoosts(body) {
    const b = BOOSTS;
    body.appendChild(rowCard(b.pass2x.ic, b.pass2x.name + ' (forever)', b.pass2x.desc, S.pass2x ? 'OWNED' : W(b.pass2x.cost), S.pass2x ? 'g-grey' : 'g-green', () => buyBoost('pass2x'), S.pass2x));
    const boostLeft = (S.boostUntil - net.now()) / 1000;
    body.appendChild(rowCard(b.boost.ic, b.boost.name, boostLeft > 0 ? 'Active: ' + clock(boostLeft) + ' left (adds 15 min)' : b.boost.desc, W(b.boost.cost), 'g-yellow', () => buyBoost('boost')));
    const left = CFG.starterPackMinutes * 60 - (net.now() - S.firstPlay) / 1000;
    if (!S.starterPack && left > 0) body.appendChild(rowCard(b.starter.ic, b.starter.name, b.starter.desc + ' · ' + clock(left) + ' left', W(b.starter.cost), 'g-pink', () => buyBoost('starter')));
    body.appendChild(sec('Levels & Speed'));
    const eng = upg(S, 'engine');
    body.appendChild(rowCard('⬆️', '+1 Level', 'Level ' + S.level + ' → ' + (S.level + 1) + ': kart speed ' + kartSpeedFor(S.level, S.rebirths, eng) + ' → ' + kartSpeedFor(S.level + 1, S.rebirths, eng), W(levelCost(S.level)), 'g-green', buyLevel));
    [0, 1, 2].forEach((i) => body.appendChild(rowCard('⚡', '+' + fmt(packAmount(i, S.level)) + ' Speed', 'Instant Speed for this level', W(packCost(i, S.level)), ['g-blue', 'g-yellow', 'g-purple'][i], () => buyPack(i))));
}
function renderKarts(body) {
    note(body, 'Every Go-Kart multiplies the Speed you earn. Buy them with Wins (the fastest need Rebirths), or drive onto their pads in the lobby showroom.');
    let lastSuper = false;
    for (const d of KARTS) {
        const owned = d.id === 'wooden' || !!S.karts[d.id], on = S.kart === d.id;
        if (d.pack && !owned) continue;
        if (!!d.super !== lastSuper) { lastSuper = !!d.super; body.appendChild(sec(lastSuper ? '⭐ Super Cars (lobby, behind the spawn)' : 'Go-Karts')); }
        const c = document.createElement('div');
        c.className = 'kart-card' + (on ? ' on' : '');
        c.innerHTML = '<div class="sw">🏎️</div><div><div class="nm o1"></div><div class="mult o1"></div><div class="ds"></div></div><button class="btn o1"></button>';
        c.querySelector('.sw').style.background = `linear-gradient(135deg, ${css(d.body)}, ${css(d.glow || d.accent)})`;
        if (d.super) c.querySelector('.sw').textContent = d.hover ? '🛸' : '🏎️';
        c.querySelector('.nm').textContent = d.name;
        c.querySelector('.mult').textContent = 'x' + d.mult + ' ⚡ Speed';
        const locked = !owned && S.rebirths < d.reb;
        c.querySelector('.ds').textContent = owned ? (on ? 'Driving it now' : 'Owned') : d.pack ? 'Starter Pack' : (d.reb ? '🔄 ' + d.reb + ' Rebirth' + (d.reb > 1 ? 's' : '') + ' · ' : '') + '🏆 ' + fmt(d.cost) + ' Wins';
        const b = c.querySelector('button');
        if (on) { b.textContent = 'EQUIPPED'; b.classList.add('g-grey'); b.disabled = true; }
        else if (owned) { b.textContent = 'Equip'; b.classList.add('g-green'); }
        else if (locked) { b.textContent = '🔒 ' + d.reb + ' Rebirth' + (d.reb > 1 ? 's' : ''); b.classList.add('g-grey'); }
        else { b.textContent = W(d.cost); b.classList.add(S.wins >= d.cost ? 'g-green' : 'g-grey'); }
        b.addEventListener('click', () => buyKart(d));
        body.appendChild(c);
    }
}
function renderGarage(body) {
    note(body, 'Upgrade your car with Wins - the upgrades show on it! Engine = higher top speed (jump further). Nitro = hold SHIFT for a boost. Grip = sharper steering and faster drift turbos. Power = more Speed from everything.');
    for (const [k, def] of Object.entries(UPGRADES)) {
        const n = upg(S, k), max = n >= def.max, cost = max ? 0 : upgradeCost(k, n);
        const c = document.createElement('div');
        c.className = 'upg' + (modalTab === k ? ' focus' : '');
        c.innerHTML = '<div class="ic"></div><div><div class="nm o1"></div><div class="ds"></div><div class="pips"></div></div><button class="btn o1"></button>';
        c.querySelector('.ic').textContent = def.ic;
        c.querySelector('.nm').textContent = def.name + ' Lv ' + n + (max ? ' (MAX)' : '');
        c.querySelector('.ds').textContent = max ? def.desc(n) : def.desc(n) + '  →  ' + def.desc(n + 1);
        c.querySelector('.pips').innerHTML = Array.from({ length: def.max }, (_, i) => '<i class="' + (i < n ? 'on' : '') + '"></i>').join('');
        const b = c.querySelector('button');
        b.textContent = max ? 'MAXED' : W(cost);
        b.classList.add(max ? 'g-grey' : S.wins >= cost ? 'g-green' : 'g-grey');
        b.disabled = max;
        b.addEventListener('click', () => buyUpgrade(k));
        body.appendChild(c);
    }
    body.appendChild(sec('Your kart'));
    const p = document.createElement('div'); p.className = 'stats-grid o1';
    const rows = [['Top speed', maxSpeedOf(S)], ['Nitro tank', (1.6 + 0.34 * upg(S, 'nitro')).toFixed(1) + 's'], ['Grip', '+' + upg(S, 'grip') * 7 + '%'], ['Power', '+' + upg(S, 'power') * 10 + '% Speed']];
    p.innerHTML = rows.map(([a, b]) => '<span>' + a + '</span><span>' + b + '</span>').join('');
    body.appendChild(p);
}
function renderTreads(body) {
    note(body, 'Speed Rollers are in the lobby (east side). Drive onto one and keep the throttle down — or press the Rollers button to train automatically while you are away.');
    for (const d of TREADMILLS) {
        const owned = d.cost === 0 && !d.daily ? true : !!S.treads[d.id];
        let btn, cls, fn;
        if (owned) { btn = 'Go train'; cls = 'g-blue'; fn = () => { closeModal(); actions.trainOn(d); }; }
        else if (d.daily) { btn = 'Day 7 reward'; cls = 'g-grey'; fn = () => openDaily(); }
        else { btn = W(d.cost); cls = S.wins >= d.cost ? 'g-green' : 'g-grey'; fn = () => buyTread(d); }
        body.appendChild(rowCard('⚙️', (d.label ? d.label + ' ' : '') + 'x' + d.mult + ' Speed Roller', 'Every bit of Speed counts x' + d.mult + (d.tag ? ' ' + d.tag : ''), btn, cls, fn));
    }
}
function renderTrails(body) {
    for (const d of TRAILS) {
        const ok = d.daily ? !!S.trails[d.id] : S.rebirths >= d.reb, on = S.trail === d.id;
        const how = d.daily ? 'Daily Reward Day 3' : d.reb ? d.reb + ' Rebirth' + (d.reb > 1 ? 's' : '') : 'Free';
        body.appendChild(rowCard('✨', d.name + ' Trail', 'x' + d.mult + ' Speed · ' + how, on ? 'EQUIPPED' : ok ? 'Equip' : '🔒 Locked', on || !ok ? 'g-grey' : 'g-green', () => net.send('trail', { id: d.id }), on || !ok, on));
    }
}
function renderRebirth(body) {
    const need = rebirthLevel(S.rebirths), ready = S.level >= need;
    const cur = rebirthMult(S.rebirths), next = rebirthMult(S.rebirths + 1);
    const w = document.createElement('div');
    w.className = 'rebirth-box';
    const pct = Math.min(100, (S.level - 1) / Math.max(1, need - 1) * 100);
    const locked = KARTS.filter((d) => d.reb === S.rebirths + 1).map((d) => d.name);
    w.innerHTML = `<div class="big o">🔄 ${S.rebirths} Rebirth${S.rebirths === 1 ? '' : 's'}</div>
        <div class="mult o"><span style="color:#6fe0ff">x${cur}</span><span>➜</span><span style="color:#7dff6b">x${next}</span></div>
        <div class="prog"><i style="width:${pct.toFixed(0)}%"></i><span class="o1">Level ${S.level} / ${need}</span></div>
        <p>Rebirth: your Level goes back to 1, but you keep for good: <b>+50% Speed</b>, <b>+25% Wins</b> and <b>+${CFG.kartPerRebirth} kart top speed</b>${locked.length ? ', and you unlock the <b>' + locked.join(', ') + '</b>' : ''}. You keep your Wins, Speed, karts, upgrades and rollers.</p>`;
    const b = document.createElement('button');
    b.className = 'btn o ' + (ready ? 'g-green' : 'g-grey');
    b.textContent = ready ? 'REBIRTH!' : 'Reach Level ' + need;
    b.disabled = !ready;
    b.addEventListener('click', () => { net.send('rebirth'); });
    w.appendChild(b);
    body.appendChild(w);
}
let freeSig = '';
function renderFree(body) {
    const mins = (net.now() - S.joinedAt) / 60000;
    const sig = FREE.map((r, i) => (S.freeClaimed[i] ? 'c' : mins >= r.min ? 'r' : Math.ceil(r.min * 60 - mins * 60))).join(',');
    if (sig === freeSig && body.children.length) return;
    freeSig = sig;
    body.innerHTML = '';
    FREE.forEach((r, i) => {
        const claimed = !!S.freeClaimed[i], ready = mins >= r.min;
        const btn = claimed ? 'Claimed' : ready ? 'CLAIM' : clock(r.min * 60 - mins * 60);
        body.appendChild(rowCard(r.speed ? '⚡' : r.wins ? '🏆' : '⏱️', rewardText(r), 'Play for ' + r.min + ' min', btn,
            claimed ? 'g-grey' : ready ? 'g-green' : 'g-blue', () => { if (!claimed && ready) net.send('free', { i }); }, claimed || !ready));
    });
}
function renderTeleport(body) {
    const grid = document.createElement('div'); grid.className = 'tele-grid';
    const btn = (label, small, cls, fn, disabled) => {
        const b = document.createElement('button');
        b.className = 'btn o1 ' + cls; b.disabled = !!disabled;
        b.innerHTML = '<span></span><small></small>';
        b.firstChild.textContent = label; b.lastChild.textContent = small;
        b.addEventListener('click', () => { closeModal(); fn(); });
        grid.appendChild(b);
    };
    btn('🏠 Lobby', 'Spawn', 'g-orange', () => actions.teleportLobby());
    btn('⚙️ Rollers', 'Train Speed', 'g-blue', () => actions.teleportSpot('rollers'));
    btn('🏎️ Go-Karts', 'Showroom', 'g-red', () => actions.teleportSpot('karts'));
    btn('🔧 Garage', 'Upgrades', 'g-yellow', () => actions.teleportSpot('garage'));
    btn('⭐ Super Cars', 'Showroom', 'g-blue', () => actions.teleportSpot('supercars'));
    const max = maxSpeedOf(S);
    STAGES.forEach((s, i) => {
        const open = i <= Math.max(0, S.maxStage);
        btn((open ? '' : '🔒 ') + s.name, open ? s.sub : 'Jump needs ⚡' + s.entry + ' (you: ' + max + ')', open ? 'g-purple' : 'g-grey', () => actions.teleportStage(i), !open);
    });
    body.appendChild(grid);
}
export function codeResult(m) {
    toast(m.ok ? '🎉 Code redeemed! ' + m.text : '❌ ' + m.text, m.ok ? '#7dff6b' : '#ff5a5a');
    if (m.ok) sfx('buy'); else sfx('denied');
    const i = document.querySelector('#codeInput');
    if (i && m.ok) i.value = '';
}
function renderCodes(body) {
    const row = document.createElement('div'); row.className = 'code-row';
    row.innerHTML = '<input id="codeInput" maxlength="20" placeholder="Enter code" aria-label="Code" autocomplete="off"><button class="btn g-green o1" id="codeGo">Redeem</button>';
    body.appendChild(row);
    const go = () => { const v = row.querySelector('input').value.trim(); if (v) net.send('code', { code: v }); };
    row.querySelector('button').addEventListener('click', go);
    row.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); });
    note(body, 'Codes give free Speed, Wins and boosts. Try GOKART and SPEED! New codes come with every update.');
}
function renderQuests(body) {
    QUESTS.forEach((q, i) => {
        const done = i < (S.quest || 0), cur = i === (S.quest || 0);
        if (i > (S.quest || 0) + 3) return;
        const prog = Math.min(q.n, questProgress(q, S));
        body.appendChild(rowCard(done ? '✅' : cur ? '⭐' : '🔒', q.text, done ? 'Done!' : fmt(prog) + '/' + fmt(q.n) + ' · Reward: ' + rewardText(q.reward), done ? 'DONE' : cur ? 'In progress' : 'Next', done ? 'g-grey' : cur ? 'g-yellow' : 'g-grey', () => {}, true, cur));
    });
}
function renderStats(body) {
    const m = multipliers(S, net.now(), S.friends);
    const k = kartById[S.kart] || kartById.wooden;
    const total = m.global * m.pass * m.kart * m.trail * m.rebirth * m.power * m.friends;
    const g = document.createElement('div'); g.className = 'stats-grid o1';
    const rows = [
        ['🏎️ Kart (' + k.name + ')', 'x' + m.kart], ['⚡ x2 Speed', 'x' + m.pass], ['✨ Trail', 'x' + m.trail], ['🔄 Rebirth', 'x' + m.rebirth], ['⚡ Power upgrade', 'x' + m.power.toFixed(1)],
        ['🏁 Turbo Rush (global)', 'x' + m.global], ['👥 Friends here', 'x' + m.friends.toFixed(1)], ['TOTAL', 'x' + fmt1(total)],
        ['Top speed', maxSpeedOf(S)], ['Best stage', S.maxStage >= 0 ? STAGES[S.maxStage].name : '-'], ['Total Wins earned', fmt(S.totalWins)],
    ];
    g.innerHTML = rows.map(([a, b]) => '<span>' + a + '</span><span>' + b + '</span>').join('');
    body.appendChild(g);
    const bests = Object.entries(S.best || {}).sort((a, b) => a[0] - b[0]);
    if (bests.length) {
        body.appendChild(sec('Best stage times'));
        const t = document.createElement('div'); t.className = 'stats-grid o1';
        t.innerHTML = bests.map(([i, v]) => '<span>' + (STAGES[i] ? STAGES[i].name : i) + '</span><span>' + lapTime(v) + '</span>').join('');
        body.appendChild(t);
    }
}

// ----- Daily Rewards -----
// Pops up once, a little while after joining and only when you're back in the lobby, so it never
// lands on top of a run
let dailyAuto = false, dailyAt = 0;
export function openDailyOnJoin() {
    if (dailyAuto || !S.daily || !net.room) return;
    dailyAuto = true;
    if (dailyStatus(S.daily, net.now()).can) dailyAt = performance.now() + 45000;
}
function dailyTick() {
    if (!dailyAt || performance.now() < dailyAt || !actions.inLobby || !actions.inLobby()) return;
    if (!$('#modal').hidden || !$('#confirm').hidden) return;
    dailyAt = 0;
    if (dailyStatus(S.daily, net.now()).can) openDaily();
}
function openDaily() { renderDaily(true); $('#daily').hidden = false; }
$('#dailyClose').addEventListener('click', () => { $('#daily').hidden = true; });
$('#daily').addEventListener('pointerdown', (e) => { if (e.target.id === 'daily') $('#daily').hidden = true; });
$('#dailyClaim').addEventListener('click', () => { net.send('daily'); setTimeout(() => { $('#daily').hidden = true; }, 700); });
let dailySig = '';
function renderDaily(force) {
    const st = dailyStatus(S.daily, net.now());
    const sig = st.can + '|' + st.streak + '|' + st.day;
    if (force || sig !== dailySig) {
        dailySig = sig;
        const cards = $('#dailyCards');
        cards.innerHTML = '';
        DAILY.forEach((r, i) => {
            const done = i < (st.streak % DAILY.length) && (i < st.day || !st.can);
            const today = i === st.day && st.can;
            const d = document.createElement('div');
            d.className = 'dcard' + (done ? ' done' : '') + (today ? ' today' : '');
            const ic = r.trail ? '🌙' : r.tread ? '🌊' : r.wins ? '🏆' : '⚡';
            const label = r.trail ? trailById[r.trail].name : r.tread ? 'Aqua x40 Roller' : '+' + fmt(r.speed || r.wins) + (r.wins ? ' Wins' : ' Speed');
            d.innerHTML = '<span class="dn o1"></span><span class="di"></span><span class="dr o1"></span><span class="st o1"></span>';
            d.querySelector('.dn').textContent = 'DAY ' + (i + 1);
            d.querySelector('.di').textContent = ic;
            d.querySelector('.dr').textContent = label;
            d.querySelector('.st').textContent = today ? 'CLAIM!' : done ? 'CLAIMED' : 'LOCKED';
            cards.appendChild(d);
        });
        const b = $('#dailyClaim');
        b.disabled = !st.can;
        b.textContent = st.can ? 'CLAIM' : 'CLAIMED!';
    }
    const now = net.now(), next = Math.ceil((now + 1) / 86400000) * 86400000;
    $('#dailyLeft').textContent = st.can ? 'Your daily reward is ready!' : 'Next reward in ' + clock((next - now) / 1000);
}

// ----- Friends, Settings -----
function renderFriends(body) {
    if (!BX.bloxity.ready) { note(body, 'Bloxity is not available right now.'); return; }
    const id = BX.identity();
    const link = document.createElement('div');
    link.className = 'invite-row';
    link.innerHTML = '<input id="inviteLink" readonly aria-label="Invite link"><button class="btn g-green o1">Copy link</button>';
    body.appendChild(link);
    const input = link.querySelector('input');
    input.value = BX.getInviteLink();
    link.querySelector('button').addEventListener('click', async () => {
        input.select();
        try { await navigator.clipboard.writeText(input.value); toast('Invite link copied!', '#7dff6b'); } catch (e) { toast('Select the link and copy it', '#ffb51c'); }
    });
    if (!id.loggedIn) {
        note(body, 'Log in with Bloxity to see your friends and invite them into this server. Friends here give +10% Speed each!');
        const b = document.createElement('button');
        b.className = 'btn g-blue o1'; b.textContent = 'Log in with Bloxity';
        b.addEventListener('click', () => BX.login());
        body.appendChild(b);
        return;
    }
    const loading = note(body, 'Loading friends…');
    BX.getFriends().then((friends) => {
        if (modalKind !== 'friends') return;
        loading.remove();
        if (!friends.length) { note(body, 'No friends yet. Share the invite link above!'); return; }
        const order = { 'in-game': 0, online: 1, away: 2, offline: 3 };
        friends.sort((a, b) => (order[a.presence && a.presence.status] ?? 4) - (order[b.presence && b.presence.status] ?? 4));
        for (const f of friends) {
            const st = (f.presence && f.presence.status) || 'offline';
            const where = st === 'in-game' && f.presence.gameName ? 'Playing ' + f.presence.gameName : st;
            body.appendChild(rowCard(st === 'offline' ? '⚫' : st === 'away' ? '🟡' : '🟢', f.displayName || f.username, where, 'Invite', 'g-green', async (e) => {
                e.currentTarget.disabled = true;
                const ok = await BX.inviteFriend(f._id);
                toast(ok ? 'Invite sent to ' + (f.displayName || f.username) : 'Could not send the invite', ok ? '#7dff6b' : '#ff5a5a');
            }));
        }
    });
}
function renderSettings(body) {
    const vols = getVolumes();
    const on = !musicMuted();
    const mb = document.createElement('button');
    mb.className = 'btn o ' + (on ? 'g-green' : 'g-grey');
    mb.style.fontSize = '1.4rem'; mb.style.padding = '0.45rem';
    mb.textContent = on ? '🎵 Music: ON' : '🔇 Music: OFF';
    mb.addEventListener('click', () => { toggleMusic(); renderModal(); });
    body.appendChild(mb);
    const w = document.createElement('div');
    w.className = 'settings';
    w.innerHTML = `
        <label class="set-row o1" for="volMusic"><span>🎵 Music</span><input id="volMusic" type="range" min="0" max="100" value="${Math.round(vols.music * 100)}"></label>
        <label class="set-row o1" for="volSfx"><span>🔊 Sounds</span><input id="volSfx" type="range" min="0" max="100" value="${Math.round(vols.sfx * 100)}"></label>
        <label class="set-row o1" for="volEngine"><span>🏎️ Engine</span><input id="volEngine" type="range" min="0" max="100" value="${Math.round((vols.engine ?? 0.8) * 100)}"></label>
        <div class="set-row o1"><span>✨ Graphics</span><div class="seg" role="radiogroup" aria-label="Graphics quality"></div></div>
        <p class="note">Low turns off glow and shadows for older phones. Now playing: "Turbo Bricks" 🏁</p>`;
    w.querySelector('#volMusic').addEventListener('input', (e) => setVolume('music', e.target.value / 100));
    w.querySelector('#volSfx').addEventListener('input', (e) => setVolume('sfx', e.target.value / 100));
    w.querySelector('#volEngine').addEventListener('input', (e) => setVolume('engine', e.target.value / 100));
    const seg = w.querySelector('.seg');
    for (const [key, q] of Object.entries(QUALITIES)) {
        const b = document.createElement('button');
        b.className = 'btn o1 ' + (getQuality() === key ? 'g-green' : 'g-grey');
        b.textContent = q.label;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(getQuality() === key));
        b.addEventListener('click', () => { setQuality(key); renderModal(); });
        seg.appendChild(b);
    }
    body.appendChild(w);
    const sb = document.createElement('button');
    sb.className = 'btn g-blue o1'; sb.textContent = '📊 My Stats & multipliers';
    sb.addEventListener('click', () => openModal('stats'));
    body.appendChild(sb);
}
