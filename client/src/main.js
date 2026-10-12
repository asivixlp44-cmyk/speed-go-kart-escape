import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, renderer, solids, kills, triggers, prompts, tickers,
    billboard, buildRig, mergeRig, kartPose, burst, confettiAt, floatText, updateEffects, lerpAngle, angleDiff, updateSky, FOG,
} from './engine.js';
import { S, actions, net } from './state.js';
import { initAudio, resumeAudio, audioDebug, startMusic, sfx, setVolume, setMusicIntensity, audioSuspended, setEngine } from './audio.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, unpackAvatar, avatarStats } from './avatar.js';
import { updateMaterials } from './textures.js';
import { pad, pollGamepad, rumble, onGamepadConnection } from './gamepad.js';
import {
    render, setSpeedLines, setSpeedBlur, updateFx, dust, tireSmoke, driftSpark, exhaustFlame, exhaustPuff, wallSparks, sparkleColumn,
    zapSparks, ring, fireworks, setQuality, makeTrail, addSkid, updateAmbient, flame,
} from './fx.js';
import {
    buildWorld, SPAWN, refreshShop, renderBoards, updateLobbySigns, updateWorld, cullZones, checkpoints, windAt, treadOwned, stageStart,
    buildKart, animateKart, showroomPads, superPads, makeCopCar, chases,
} from './world.js';
import {
    updateHud, updateSpeedo, updateLap, updateProgress, showSplit, showSection, showCountdown, showChase, hint, toast, levelUp, showStageTitle, showGoal, showOof, flashBoost, animateCounters, showOffline,
    openDailyOnJoin, refreshModal, closeModal, openModal, promptEl, promptTxtEl, buyKart, buyTread, codeResult,
    showTeleBack, hideTeleBack, questDone, modalOpen,
} from './ui.js';
import {
    CFG, STAGES, TREADMILLS, TREAD_GEO, RAMP, KART_HW, worldSpeed, speedFromWorld, launchFactor, trailById, kartById, KITS, SKINS,
    maxSpeedOf, nitroSecs, nitroPower, nitroRecharge, gripMult, upg, upgCode, parseUpg, stageAt, fmt, clamp,
} from '../../shared/config.js';

// =====================================================================================
// The local kart
// =====================================================================================
const HW = KART_HW, PH = 3.2, STEP = 1.7, GRAV = CFG.grav;
const P = {
    pos: SPAWN.clone(), vx: 0, vy: 0, vz: 0, yaw: 0, speed: 0, steer: 0, onGround: false, ground: null, airTime: 0,
    drift: 0, driftT: 0, driftLvl: 0, boostT: 0, boostPow: 1, nitro: 1, nitroOn: false, nitroIdle: 0,
    dead: false, deadT: 0, deadCause: '', shield: 0, stage: -1, moving: false, lockToastT: -9,
    cp: { stage: -1, k: 0 }, padLock: false, lastRamp: null, launchT: -9, bumpT: 0, accel: 0,
    renderY: SPAWN.y, visYaw: 0, squash: 1, squashV: 0, lap: null, hopHeld: false, hopPress: -9,
    countdown: 0, gasAt: -9,
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shake = 0;
function addShake(a) { if (!reduceMotion) shake = Math.min(1.4, shake + a); }
let rig = null, headLabel = null, nameLabelText = '';

// ----- a racer: group at the kart's wheels -> kart model, driver body in the seat -----
function buildDriver(kit, skin) {
    const g = new T.Group();
    const k = KITS[kit % KITS.length];
    const body = mergeRig(buildRig({ ...k, skin: SKINS[skin % SKINS.length], hair: 0x3a2618 }));
    g.add(body);
    g.userData = { body, kart: null, kartId: '', trail: null, trailId: '', blox: null, steer: 0 };
    return g;
}
// Swaps the kart under a racer and sits the driver in its seat
// code: the upgrades that show on it ("e3n2g1p0")
function setKart(g, id, label, code) {
    const u = g.userData, d = kartById[id] || kartById.wooden, key = d.id + '|' + (code || '');
    if (u.kartKey === key) return;
    if (u.kart) g.remove(u.kart);
    const kart = buildKart(d, { upg: parseUpg(code) });
    g.add(kart);
    kart.add(u.body);
    u.kart = kart; u.kartId = d.id; u.kartKey = key; u.def = d;
    u.body.position.set(0, kart.userData.seatY - 2.05, kart.userData.seatZ);
    if (label) label.position.y = kart.userData.seatY + 5.2;
}
function setTrail(g, id) {
    const u = g.userData;
    const d = trailById[id] || trailById.starter;
    if (!u.trail) u.trail = makeTrail(d.color);
    if (u.trailId !== d.id) { u.trailId = d.id; u.trail.setColor(d.color, d.rainbow); u.trail.width = 0.35 + Math.min(0.6, (d.mult - 1) * 0.12); }
}
const tipAt = new V3(), backDir = new V3();
// Wheels, steering, body roll; exhaust smoke, nitro / boost flames, drift sparks, kart extras
function animateRacer(g, dt, t, o) {
    const u = g.userData;
    if (!u.kart) return;
    animateKart(u.kart, dt, o);
    kartPose(u.body, u.kart.userData.steer, t, Math.abs(o.speed) > 1);
    u.body.rotation.z = u.kart.userData.roll; u.body.rotation.x = u.kart.userData.pitch;
    if (u.blox) u.blox.update(dt, { kart: true, moving: Math.abs(o.speed) > 1, steer: u.kart.userData.steer, t });
    if (!g.visible || o.near === false) return;
    backDir.set(-Math.sin(g.rotation.y), 0, -Math.cos(g.rotation.y));
    const ex = u.kart.userData.exhausts, d = u.def;
    for (const tip of ex) {
        if (Math.random() < dt * (Math.abs(o.speed) > 2 ? 7 : 3)) { tip.getWorldPosition(tipAt); exhaustPuff(tipAt, backDir); }
        if ((o.nitro || o.boost) && Math.random() < dt * 40) { tip.getWorldPosition(tipAt); exhaustFlame(tipAt, backDir, o.nitro ? 'nitro' : 'fire', o.nitro ? 0.8 : 0.7); }
        else if (d && d.fire && Math.abs(o.speed) > 4 && Math.random() < dt * 25) { tip.getWorldPosition(tipAt); exhaustFlame(tipAt, backDir, 'fire', 0.7); }
    }
    if (d && d.sparks && Math.abs(o.speed) > 4 && Math.random() < dt * 14) zapSparks(g.position, 0x5ad8ff);
    if (o.driftLvl !== undefined && o.drift && o.onGround) {
        const col = o.driftLvl >= 3 ? 0xc85aff : o.driftLvl >= 2 ? 0xff9a2a : o.driftLvl >= 1 ? 0x3ad8ff : 0xffe8a0;
        for (const sx of [-1, 1]) {
            if (Math.random() < dt * (o.driftLvl ? 40 : 14)) { wheelWorld(g, sx * 2.36, -2.3, tipAt); driftSpark(tipAt, col, backDir); }
            if (Math.random() < dt * 10) { wheelWorld(g, sx * 2.36, -2.3, tipAt); tireSmoke(tipAt, 0.8); }
        }
    }
}
function wheelWorld(g, lx, lz, out) {
    const s = Math.sin(g.rotation.y), c = Math.cos(g.rotation.y);
    return out.set(g.position.x + lx * c + lz * s, g.position.y + 0.1, g.position.z - lx * s + lz * c);
}

// ----- Bloxity avatars: the avatar replaces the blocky body's meshes, sitting in the seat -----
function dressRig(group, avatar) {
    const body = group.userData.body;
    body.children.forEach((c) => { c.visible = false; });
    body.add(avatar.root);
    group.userData.blox = avatar;
}
let localAvatar = null, localAvatarReq = 0;
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !rig) { a.dispose(); return; }
    if (localAvatar) localAvatar.dispose();
    localAvatar = a;
    dressRig(rig, a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (localAvatar && av) { localAvatar.setProportions(av.proportions); localAvatar.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubble) { group.remove(group.userData.bubble); group.userData.bubble.material.map.dispose(); }
    const b = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#141a2e', px: 44 }], 9, 1024, new V3(0, 10, 0), group);
    group.userData.bubble = b;
    setTimeout(() => { if (group.userData.bubble === b) { group.remove(b); b.material.map.dispose(); group.userData.bubble = null; } }, 5000);
}
function buildPlayer(kit, skin) {
    if (rig) { scene.remove(rig); if (rig.userData.trail) rig.userData.trail.dispose(); }
    rig = buildDriver(kit, skin);
    scene.add(rig);
    nameLabelText = '';
    headLabel = billboard([{ t: S.name || ' ', c: '#ffffff', s: '#141a2e', px: 60 }], 6.5, 512, new V3(0, 6.2, 0), rig);
    headLabel.material.depthTest = false; headLabel.renderOrder = 10;
    setKart(rig, S.kart, headLabel, upgCode(S));
    rig.position.copy(P.pos);
    localAvatar = null;
    setupLocalAvatar();
}

// ----- collision against the solids near the kart -----
let near = solids, nearKills = kills, nearTriggers = triggers, nearZoneKey = '';
function refreshNear(stage) {
    const zs = new Set([stage - 1, stage, stage + 1]);
    if (stage <= 0) zs.add(-1);
    const key = [...zs].join(',');
    if (key === nearZoneKey) return;
    nearZoneKey = key;
    const ok = (o) => o.zone === undefined || zs.has(o.zone);
    near = solids.filter(ok); nearKills = kills.filter(ok); nearTriggers = triggers.filter(ok);
    cullZones(stage);
}
// Top of a solid under the kart: ramps rise along +z (the kart's front edge decides how high)
function topOf(c, z) {
    if (!c.ramp) return c.max.y;
    const r = c.ramp, k = clamp((Math.min(z + HW, r.z1) - r.z0) / (r.z1 - r.z0), 0, 1);
    return c.min.y + r.h * k;
}
const overlaps = (c, x, y, z) => !c.off && c.max.x > x - HW && c.min.x < x + HW && topOf(c, z) > y && c.min.y < y + PH && c.max.z > z - HW && c.min.z < z + HW;
function freeAt(x, y, z) {
    for (const c of near) if (overlaps(c, x, y, z)) return false;
    return true;
}
// Moves along one axis; returns true when a wall stopped it
function moveAxis(axis, d) {
    if (d === 0) return false;
    const p = P.pos;
    p[axis] += d;
    let hit = false;
    for (const c of near) {
        if (!overlaps(c, p.x, p.y, p.z)) continue;
        if (axis === 'y') {
            if (d < 0) { p.y = topOf(c, p.z); P.vy = Math.max(0, P.vy); P.onGround = true; P.ground = c; }
            else { p.y = c.min.y - PH - 1e-4; if (P.vy > 0) P.vy = 0; }
        } else {
            const top = topOf(c, p.z), rise = top - p.y;
            // Curbs and ramps are climbed while driving; a kart falling into a gap can't climb out of it
            if (rise > 0 && rise <= STEP && (P.onGround || (P.vy <= 0 && P.vy > -12) || c.ramp) && freeAt(p.x, top + 0.01, p.z)) { p.y = top + 0.001; continue; }
            if (d > 0) p[axis] = c.min[axis] - HW - 1e-4; else p[axis] = c.max[axis] + HW + 1e-4;
            hit = true;
        }
    }
    return hit;
}
const topSpeed = () => {
    const max = qaSpeed || maxSpeedOf(S);
    return S.customSpeed > 0 && S.customSpeed <= max ? S.customSpeed : max;
};

function teleport(pos, yaw) {
    if (chase.zone) endChase(false);
    chase.escaped = null;
    P.pos.copy(pos); P.vx = P.vy = P.vz = 0; P.speed = 0; P.drift = 0; P.driftT = 0; P.boostT = 0;
    P.yaw = yaw || 0; P.visYaw = P.yaw; cam.yaw = P.yaw + Math.PI; cam.free = 0;
    // The camera jumps with you (instead of flying across the map to catch up)
    cam.target.set(pos.x, pos.y + 3.1, pos.z); cam.distNow = undefined;
    P.renderY = pos.y;
    P.stage = stageAt(pos.z);
    refreshNear(P.stage);
    for (const t of nearTriggers) t.inside = overlapsBox(t, pos);
    sendMove(true);
}
const overlapsBox = (t, p) => t.max.x > p.x - HW && t.min.x < p.x + HW && t.max.y > p.y && t.min.y < p.y + PH && t.max.z > p.z - HW && t.min.z < p.z + HW;
function teleportLobby() { P.cp = { stage: -1, k: 0 }; P.padLock = false; endLap(); P.countdown = 0; showCountdown(null); teleport(SPAWN, 0); }

// =====================================================================================
// Crashing, checkpoints, pads, teleports
// =====================================================================================
let deaths = 0;
function die(cause) {
    if (P.dead || P.shield > 0) return;
    P.dead = true; P.deadT = CFG.respawnDelay; P.deadCause = cause; deaths++;
    const d = rig && rig.userData.def;
    burst(P.pos.clone().add(new V3(0, 2, 0)), d ? d.body : 0xff5a1e, 0.9, 22);
    for (let k = 0; k < 10; k++) tireSmoke(P.pos, 1.4, 0x55555e);
    sfx('crash'); addShake(1); rumble(1, 380);
    let extra = '';
    // Fell short of a jump: say what speed it takes
    if (cause === 'fall' && P.lastRamp && P.lastRamp.need && clockT - P.launchT < 4) {
        const max = maxSpeedOf(S);
        if (topSpeed() < P.lastRamp.need) extra = max >= P.lastRamp.need ? 'Your Custom Speed is too low for this jump!' : 'This jump needs ⚡ ' + P.lastRamp.need + ' Speed (you: ' + max + '). Level up!';
        else extra = 'Hit the ramp at full speed!';
    }
    if (cause === 'laser') sfx('zap'); else if (cause === 'crusher' || cause === 'wall') sfx('crush'); else if (cause === 'car') sfx('honk'); else if (cause === 'cop' || cause === 'police') sfx('siren');
    if (cause === 'mine') { sfx('boom'); addShake(0.8); for (let k = 0; k < 24; k++) flame(P.pos.clone().add(new V3(0, 1, 0)), 3, 2.4, new V3((Math.random() - 0.5) * 20, 14, (Math.random() - 0.5) * 20)); }
    showOof(cause, extra);
    sendMove(true);
    net.send('died', { s: Math.max(P.stage, -1), c: cause || 'fall' });
}
function respawn() {
    P.dead = false;
    const cp = P.cp.stage >= 0 && checkpoints[P.cp.stage] && checkpoints[P.cp.stage][P.cp.k];
    if (cp) teleport(cp.pos.clone(), cp.yaw); else teleport(SPAWN, 0);
    P.shield = CFG.shieldTime;
    sfx('teleport');
}
actions.checkpoint = (stage, k) => {
    if (P.dead || P.vz < 0) return;
    if (stage > P.cp.stage || (stage === P.cp.stage && k > P.cp.k)) {
        P.cp = { stage, k };
        if (k > 0) sfx('checkpoint');
    }
    // The stopwatch starts on the first arch of a stage
    if (k === 0 && (!P.lap || P.lap.stage !== stage)) startLap(stage);
    const cp = checkpoints[stage] && checkpoints[stage][k];
    if (cp && cp.info) showSection(cp.info, cp.extra);
    if (k > 0 && P.lap && P.lap.stage === stage) splitAt(cp.pos.z);
};
// Through a stage's gate: title, stopwatch, checkpoint 0
actions.stageGate = (i) => {
    if (P.dead || P.vz < -1) return;
    if (P.cp.stage < i) P.cp = { stage: i, k: 0 };
    P.padLock = false;
    showStageTitle(STAGES[i]); sfx('gate');
    setMusicIntensity(i >= 6 ? 1 : 0);
};
// A Wins pad: tell the server (it checks where you are and your speed), then back to the lobby
let lastPadStage = 0;
actions.pad = (s, k) => {
    if (P.dead || P.padLock) return;
    P.padLock = true;
    sendMove(true);
    const t = P.lap && P.lap.stage === s ? clockT - P.lap.t0 : 0;
    if (t) finishRun(s, t);
    net.send('pad', { s, k, t: t ? +t.toFixed(2) : 0 });
    endLap();
    lastPadStage = Math.min(STAGES.length - 1, s + 1);
    P.speed *= 0.3; P.vx *= 0.3; P.vz *= 0.3;
    setTimeout(() => { teleportLobby(); showTeleBack(lastPadStage); }, 700);
};
actions.summit = () => {
    if (P.dead || P.padLock) return;
    P.padLock = true;
    sendMove(true);
    net.send('summit');
    lastPadStage = STAGES.length - 1;
    setTimeout(() => { teleportLobby(); showTeleBack(lastPadStage); }, 1800);
};
actions.teleportStage = (i) => {
    if (i > Math.max(0, S.maxStage)) { toast('Reach ' + STAGES[i].name + ' first!', '#ff5a5a'); return; }
    hideTeleBack(); stopTraining();
    const st = stageStart(i);
    P.cp = { stage: i, k: 0 };
    P.padLock = false;
    teleport(st.pos, st.yaw);
    endLap();
    showStageTitle(STAGES[i]);
    sfx('teleport');
    P.countdown = 3.2; P.countdownStage = i; P.gasAt = -9; P.cdShown = -1;
};
// ----- 3, 2, 1, GO! (start lights) -----
function tickCountdown(dt, gas) {
    if (P.countdown <= 0) return false;
    if (gas && P.gasAt < 0) P.gasAt = clockT;
    if (!gas) P.gasAt = -9;
    P.countdown -= dt;
    const n = Math.ceil(P.countdown - 0.2);
    if (n !== P.cdShown) {
        P.cdShown = n;
        if (n >= 1 && n <= 3) { showCountdown(n); sfx('beep'); }
    }
    if (P.countdown > 0.2) return true;
    // GO! Holding the gas from just before GO (not the whole countdown) gives a rocket start
    P.countdown = 0;
    showCountdown(0); sfx('go');
    const i = P.countdownStage;
    startLap(i);
    const cp = checkpoints[i] && checkpoints[i][0];
    if (cp && cp.info) setTimeout(() => showSection(cp.info, cp.extra), 700);
    if (gas && P.gasAt > 0 && clockT - P.gasAt < 0.9) {
        P.boostT = 1.1; P.boostPow = 1.35; P.speed = topSpeed() * 1.2;
        flashBoost(); sfx('turbo2'); toast('🚀 PERFECT START!', '#ffd028');
    }
    return false;
}

// ----- the stopwatch and your ghost: your best run on this stage, recorded and replayed -----
let ghostRec = null, ghostPlay = null, ghostRig = null;
const ghostKey = (i) => 'gke_ghost3_' + i;
function startLap(stage) {
    P.lap = { stage, t0: clockT };
    ghostRec = { stage, kart: S.kart, samples: [], t: -1 };
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(ghostKey(stage)) || 'null'); } catch (e) { saved = null; }
    ghostPlay = saved && saved.samples && saved.samples.length > 4 ? saved : null;
    if (ghostPlay) showGhost(ghostPlay.kart);
    else hideGhost();
}
function endLap() { P.lap = null; ghostRec = null; ghostPlay = null; hideGhost(); }
function recordGhost() {
    if (!ghostRec || !P.lap) return;
    const t = clockT - P.lap.t0;
    if (t - ghostRec.t < 0.1 || ghostRec.samples.length > 3000) return;
    ghostRec.t = t;
    ghostRec.samples.push([+t.toFixed(2), +P.pos.x.toFixed(1), +P.renderY.toFixed(1), +P.pos.z.toFixed(1), +P.visYaw.toFixed(2)]);
}
// Kept until the server says whether it was a best time
let pendingRun = null;
function finishRun(stage, t) {
    recordGhost();
    if (ghostRec && ghostRec.stage === stage) pendingRun = { stage, kart: ghostRec.kart, time: t, samples: ghostRec.samples };
}
function saveGhost(stage) {
    if (!pendingRun || pendingRun.stage !== stage) return;
    try { localStorage.setItem(ghostKey(stage), JSON.stringify(pendingRun)); } catch (e) { /* storage full */ }
    pendingRun = null;
}
// The ghost's time at z (first time it got there), or null
function ghostTimeAt(z) {
    const sm = ghostPlay && ghostPlay.samples;
    if (!sm) return null;
    for (let i = 1; i < sm.length; i++) {
        if (sm[i][3] >= z && sm[i - 1][3] < z) {
            const k = (z - sm[i - 1][3]) / Math.max(1e-3, sm[i][3] - sm[i - 1][3]);
            return sm[i - 1][0] + (sm[i][0] - sm[i - 1][0]) * k;
        }
    }
    return null;
}
function splitAt(z) {
    const g = ghostTimeAt(z);
    if (g === null || !P.lap) return;
    showSplit(clockT - P.lap.t0 - g);
}
let ghostMat = null;
function showGhost(kartId) {
    const id = kartById[kartId] ? kartId : 'wooden';
    if (ghostRig && ghostRig.userData.id === id) { ghostRig.visible = true; return; }
    hideGhost(true);
    ghostMat = ghostMat || new T.MeshBasicMaterial({ color: 0x9ae4ff, transparent: true, opacity: 0.45, depthWrite: false });
    ghostRig = buildKart(kartById[id]);
    ghostRig.traverse((o) => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; } });
    const label = billboard([{ t: '👻 BEST', c: '#bfe8ff', s: '#141a2e', px: 54 }], 5, 512, new V3(0, 6, 0), ghostRig);
    label.material.opacity = 0.8;
    ghostRig.userData.id = id;
    scene.add(ghostRig);
}
function hideGhost(dispose) {
    if (!ghostRig) return;
    ghostRig.visible = false;
    if (dispose) { scene.remove(ghostRig); ghostRig = null; }
}
function updateGhost(dt) {
    if (!ghostRig || !ghostRig.visible || !ghostPlay || !P.lap) { if (ghostRig && ghostRig.visible && !P.lap) ghostRig.visible = false; return null; }
    const t = clockT - P.lap.t0, sm = ghostPlay.samples;
    if (t > sm[sm.length - 1][0] + 0.5) { ghostRig.visible = false; return null; }
    let i = 1;
    while (i < sm.length - 1 && sm[i][0] < t) i++;
    const a = sm[i - 1], b = sm[i], k = clamp((t - a[0]) / Math.max(1e-3, b[0] - a[0]), 0, 1);
    ghostRig.position.set(a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
    ghostRig.rotation.y = lerpAngle(a[4], b[4], k);
    const sp = Math.hypot(b[1] - a[1], b[3] - a[3]) / Math.max(1e-3, b[0] - a[0]);
    animateKart(ghostRig, dt, { speed: sp, steer: 0 });
    return ghostRig.position.z;
}
actions.teleportLobby = () => { stopTraining(); teleportLobby(); sfx('teleport'); };
actions.teleportSpot = (spot) => {
    stopTraining();
    if (spot === 'rollers') teleport(new V3(TREAD_GEO.x0 + 3 * TREAD_GEO.step, 0.6, TREAD_GEO.z - 22), 0);
    else if (spot === 'karts') teleport(new V3(-22, 0.5, -60), -Math.PI / 2);
    else if (spot === 'supercars') teleport(new V3(0, 0.5, -48), Math.PI);
    else teleport(new V3(70, 0.5, 6), 0);
    P.cp = { stage: -1, k: 0 };
    sfx('teleport');
};
actions.boostPad = () => {
    if (P.dead) return;
    P.boostT = Math.max(P.boostT, 1.2); P.boostPow = Math.max(P.boostT > 1.2 ? P.boostPow : 1, 1.45);
    P.speed = Math.max(P.speed, topSpeed() * 1.25);
    sfx('boost'); flashBoost(); addShake(0.2); rumble(0.4, 150);
};

// ----- Auto Train: park on your best Speed Roller with the throttle down -----
let training = false;
function stopTraining() { if (training) { training = false; $('#btnTreadmill').classList.remove('on'); } }
function trainOn(def) {
    const i = TREADMILLS.indexOf(def);
    if (i < 0) return;
    if (P.dead) respawn();
    teleport(new V3(TREAD_GEO.x0 + i * TREAD_GEO.step, TREAD_GEO.top + 0.4, TREAD_GEO.z), 0);
    P.cp = { stage: -1, k: 0 };
    training = true;
    $('#btnTreadmill').classList.add('on');
    toast('Auto Train ON - x' + def.mult + ' Speed Roller (steer or brake to stop)', '#5ad8ff');
}
actions.trainOn = trainOn;
actions.autoTrain = () => {
    if (!running) return;
    if (training) { stopTraining(); toast('Auto Train OFF', '#5ad8ff'); return; }
    let best = null;
    for (const d of TREADMILLS) if (treadOwned(d) && (!best || d.mult > best.mult)) best = d;
    trainOn(best || TREADMILLS[0]);
};
// ----- lobby shops -----
actions.kartPad = (d) => { if (P.lockToastT + 1 < clockT) { P.lockToastT = clockT; buyKart(d); } };
actions.treadBuy = (d) => { if (P.lockToastT + 2 < clockT) { P.lockToastT = clockT; if (d.daily) toast('The Aqua Roller is the Day 7 daily reward!', '#2ae6ff'); else buyTread(d); } };
actions.trail = (d) => net.send('trail', { id: d.id });
actions.openShop = (tab) => openModal('shop', tab);
actions.openGarage = (key) => { P.speed *= 0.4; openModal('garage', key); };
actions.openCodes = () => openModal('codes');
actions.chest = () => net.send('chest');
actions.inLobby = () => running && !P.dead && P.stage < 0 && Math.abs(P.speed) < 4;

// =====================================================================================
// Police chase: drive into a chase zone and a cruiser comes after you. It follows the exact path
// you drove (through the same gaps) at a little under the stage's speed: keep your speed up and
// don't hit the roadblocks. Too close and you're BUSTED.
// =====================================================================================
const chase = { zone: null, cops: [], path: [], t: 0, sirenT: 0, escaped: null, close: 0 };
const copPool = [];
const pathTmp = { x: 0, z: 0, yaw: 0 };
function startChase(zone) {
    chase.zone = zone; chase.t = 0; chase.sirenT = 0;
    // starts 30-40 behind; on a clean run at the stage speed it closes most of that by the end
    const back = 40 - 10 * zone.d;
    chase.back = back; chase.len = Math.max(60, zone.b - P.pos.z);
    chase.path = [{ x: P.pos.x, z: P.pos.z - back, s: 0 }, { x: P.pos.x, z: P.pos.z, s: back }];
    for (let k = 0; k < zone.cops; k++) {
        const m = copPool.pop() || makeCopCar();
        m.visible = true; m.rotation.y = 0;
        scene.add(m);
        chase.cops.push({ m, s: -k * 30, delay: k * 0.9, fast: 1 + k * 0.04 });
    }
    toast('🚨 POLICE CHASE! Keep your speed up!', '#ff5a5a');
    sfx('siren');
}
function endChase(escaped) {
    for (const c of chase.cops) { scene.remove(c.m); copPool.push(c.m); }
    chase.cops = []; chase.zone = null; chase.path = []; chase.close = 0;
    showChase(null);
    if (escaped) { chase.escaped = escaped; toast('🚓💨 YOU ESCAPED THE POLICE!', '#7dff6b'); sfx('cheer'); }
}
// A point s along the path you drove (before its start: straight back along -z)
function pathAt(s, out) {
    const p = chase.path;
    if (s <= 0) { out.x = p[0].x; out.z = p[0].z + s; out.yaw = 0; return out; }
    let lo = 0, hi = p.length - 1;
    if (s >= p[hi].s) { const a = p[hi - 1], b = p[hi]; out.x = b.x; out.z = b.z; out.yaw = Math.atan2(b.x - a.x, b.z - a.z); return out; }
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].s <= s) lo = mid; else hi = mid; }
    const a = p[lo], b = p[hi], k = (s - a.s) / Math.max(1e-3, b.s - a.s);
    out.x = a.x + (b.x - a.x) * k; out.z = a.z + (b.z - a.z) * k; out.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    return out;
}
function updateChase(dt) {
    if (!chase.zone) {
        if (P.dead || P.stage < 0) return;
        // Anywhere in a chase zone you haven't escaped yet (after a crash it starts again from the checkpoint)
        for (const zn of chases) if (zn.stage === P.stage && P.pos.z > zn.a && P.pos.z < zn.b - 20 && chase.escaped !== zn) { startChase(zn); break; }
        return;
    }
    const zn = chase.zone;
    if (P.dead || P.stage !== zn.stage || P.pos.z < zn.a - 30) { endChase(false); return; }
    if (P.pos.z > zn.b + 4) { endChase(zn); return; }
    chase.t += dt;
    let last = chase.path[chase.path.length - 1];
    const dl = Math.hypot(P.pos.x - last.x, P.pos.z - last.z);
    if (dl > 1.2) { chase.path.push({ x: P.pos.x, z: P.pos.z, s: last.s + dl }); last = chase.path[chase.path.length - 1]; }
    const sMe = last.s + Math.hypot(P.pos.x - last.x, P.pos.z - last.z);
    // A little faster than the stage's speed: drive clean at the stage's speed and you get away by
    // 10-15 m. Crash into a roadblock or come in ~10% too slow and it catches
    // you; boosts and nitro buy you room.
    const target = zn.vs * (1 + 0.85 * (chase.back - 7) / chase.len);
    let nearest = Infinity;
    for (const c of chase.cops) {
        if (chase.t < c.delay) { c.m.visible = false; continue; }
        c.m.visible = true;
        let v = target * c.fast * (0.85 + 0.15 * Math.min(1, (chase.t - c.delay) / 1.2));
        if (sMe - c.s > 150) v *= 1.3;   // never hopelessly far behind
        c.s = Math.min(sMe, c.s + v * dt);
        const gap = sMe - c.s;
        nearest = Math.min(nearest, gap);
        pathAt(c.s, pathTmp);
        c.m.position.set(pathTmp.x, 0, pathTmp.z);
        c.m.rotation.y = lerpAngle(c.m.rotation.y, pathTmp.yaw, 1 - Math.exp(-dt * 10));
        const flash = Math.floor(clockT * 8) % 2 === 0;
        c.m.userData.red.visible = flash; c.m.userData.blue.visible = !flash;
        // the cruiser's nose (5 ahead of its middle) touching your back bumper
        if (gap < 7 && P.shield <= 0) { die('police'); return; }
    }
    showChase(nearest === Infinity ? null : nearest);
    // 0..1: how close the nearest cruiser is (the camera rises to see over it)
    chase.close = nearest === Infinity ? 0 : clamp((32 - nearest) / 20, 0, 1);
    chase.sirenT -= dt;
    if (chase.sirenT <= 0) { chase.sirenT = nearest < 30 ? 0.45 : 0.8; sfx('siren'); }
}

// =====================================================================================
// Friend Boost
// =====================================================================================
let friendNames = [], friendsT = 3, friendSyncT = 5;
async function refreshFriends() {
    if (!BX.bloxity.ready || !BX.identity().loggedIn) return;
    const list = await BX.getFriends();
    friendNames = list.map((f) => f.displayName || f.username).filter(Boolean);
    syncFriends();
}
function syncFriends() {
    const room = net.room;
    if (!room || !room.state || !room.state.players || !friendNames.length) return;
    const here = [];
    room.state.players.forEach((p, id) => { if (id !== room.sessionId && friendNames.includes(p.name)) here.push(p.name); });
    net.send('friends', { names: here });
}

// =====================================================================================
// Other players
// =====================================================================================
const remotes = new Map();
let joinSynced = false;
class Remote {
    constructor(p) {
        this.rig = buildDriver(p.kit, p.skin);
        this.rig.position.set(p.x, p.y, p.z);
        this.rig.rotation.y = p.ry;
        scene.add(this.rig);
        this.label = billboard([{ t: p.name, c: '#ffffff', s: '#141a2e', px: 56 }], 6, 512, new V3(0, 6.2, 0), this.rig);
        this.labelText = p.name;
        this.av = null; this.blox = null; this.dead = false; this.vel = 0; this.lastRy = p.ry; this.steer = 0;
        setKart(this.rig, p.kart, this.label, p.upg);
        this.setAvatar(p.av);
    }
    setAvatar(av) {
        this.av = av;
        const data = av ? unpackAvatar(av) : null;
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        createAvatar(data).then((a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.blox = a;
            dressRig(this.rig, a);
            if (this.av !== av) this.setAvatar(this.av);
        });
    }
    update(p, dt, t) {
        const r = this.rig;
        const k = 1 - Math.exp(-dt * 12);
        if ((r.position.x - p.x) ** 2 + (r.position.z - p.z) ** 2 + (r.position.y - p.y) ** 2 > 2500) r.position.set(p.x, p.y, p.z);
        else { r.position.x += (p.x - r.position.x) * k; r.position.y += (p.y - r.position.y) * k; r.position.z += (p.z - r.position.z) * k; }
        const turn = angleDiff(r.rotation.y, p.ry);
        r.rotation.y = lerpAngle(r.rotation.y, p.ry, k);
        r.visible = p.anim !== 3;
        if (p.av !== this.av) this.setAvatar(p.av);
        setKart(r, p.kart, this.label, p.upg);
        setTrail(r, p.trail);
        const fx = p.fx | 0;
        this.steer += (clamp(-turn * 6, -1, 1) - this.steer) * Math.min(1, dt * 8);
        const drift = fx & 1 ? -1 : fx & 2 ? 1 : 0;
        const near = camera.position.distanceToSquared(r.position) < 220 * 220;
        animateRacer(r, dt, t, { speed: worldSpeed(p.v || 0), steer: this.steer, drift, air: p.anim === 2, nitro: !!(fx & 4), boost: !!(fx & 8), driftLvl: drift ? 1 : undefined, onGround: p.anim !== 2, near });
        r.userData.trail.update(trailPoint(r), Math.abs(p.v || 0) > 8 && r.visible, dt, t);
        if (p.name !== this.labelText) { this.labelText = p.name; this.label.userData.set([{ t: p.name, c: '#ffffff', s: '#141a2e', px: 56 }]); }
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        if (this.rig.userData.trail) this.rig.userData.trail.dispose();
        scene.remove(this.rig);
    }
}
const trailTmp = new V3();
function trailPoint(r) { return trailTmp.set(r.position.x - Math.sin(r.rotation.y) * 3.6, r.position.y + 1.3, r.position.z - Math.cos(r.rotation.y) * 3.6); }

// "+1 ⚡" pops up beside the kart every time Speed goes up, like the reference
let speedSeen = false, popT = 0, popAcc = 0;
function popGain(n) {
    popAcc += n;
    if (clockT - popT < 0.3 && n < 1000) return;
    popT = clockT;
    const side = (Math.random() < 0.5 ? -1 : 1) * (3.5 + Math.random());
    const at = P.pos.clone().add(new V3(Math.cos(P.yaw) * side, 5 + Math.random() * 1.5, -Math.sin(P.yaw) * side));
    floatText('+' + fmt(popAcc) + ' ⚡', '#5ad8ff', at, 4.2);
    popAcc = 0;
    sfx('gain');
}
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return 1;
    const seen = new Set();
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) {
            const oldLevel = S.level;
            if (speedSeen && p.speed > S.speed) popGain(p.speed - S.speed);
            speedSeen = true;
            S.name = p.name; S.speed = p.speed; S.wins = p.wins; S.level = p.level; S.xp = p.xp; S.rebirths = p.rebirths; S.friends = p.friends;
            if (!rig || rig.userData.kit !== p.kit) { buildPlayer(p.kit, p.skin); rig.userData.kit = p.kit; }
            if (oldLevel !== S.level) refreshModal();
            return;
        }
        seen.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p); remotes.set(id, r);
            if (joinSynced) BX.playerJoined(p.name); else BX.playerInRoom(p.name);
        }
        r.update(p, dt, t);
    });
    for (const [id, r] of remotes) if (!seen.has(id)) { r.dispose(); remotes.delete(id); }
    joinSynced = true;
    return room.state.players.size;
}

// =====================================================================================
// Networking
// =====================================================================================
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2597` : location.origin);
async function serverEndpoint() {
    let url = SERVER_URL;
    if (BLOXITY_GAME_ID) {
        const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
        if (r && r.cold) $('#loading').textContent = 'Waking up a server…';
        url = (r && r.endpoint) || SERVER_URL;
    }
    if (!/^https?:/i.test(url)) return url;
    if (!(await serverUp(url))) {
        $('#loading').textContent = 'Waking up a server…';
        const until = Date.now() + 60000;
        while (Date.now() < until) {
            await new Promise((res) => setTimeout(res, 2000));
            if (await serverUp(url)) break;
        }
    }
    return url;
}
async function serverUp(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
    } catch (e) { return false; }
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const a = P.dead ? 3 : !P.onGround ? 2 : P.moving ? 1 : 0;
    const f = (P.drift < 0 ? 1 : 0) | (P.drift > 0 ? 2 : 0) | (P.nitroOn ? 4 : 0) | (P.boostT > 0 ? 8 : 0);
    const m = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.visYaw.toFixed(3), a, mv: P.moving ? 1 : 0, f, v: +P.speed.toFixed(1) };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a + ',' + m.mv + ',' + f + ',' + m.v;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    net.send('move', m);
}

function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function playerUid() {
    let uid = storageGet('gke_uid');
    if (!uid) {
        uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        storageSet('gke_uid', uid);
    }
    return uid;
}

async function connect(name) {
    const client = new Client(await serverEndpoint());
    const id = BX.identity();
    const room = await client.joinOrCreate('kart', {
        uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()),
        save: storageGet('gke_save') || '',
    });
    net.room = room;
    joinSynced = false;
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); net.bloxity = !!m.bloxity; });
    room.onMessage('authed', () => { net.bloxity = true; });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r) playEmoteOn(r.blox, m.id); });
    room.onMessage('chat', (m) => {
        toast(m.name + ': ' + m.text, '#ffffff');
        chatBubble(m.s === room.sessionId ? rig : remotes.get(m.s) && remotes.get(m.s).rig, m.text);
    });
    BX.updateRoom(room.roomId);
    BX.gameplayStart();
    room.onMessage('profile', (m) => {
        if (m.save) storageSet('gke_save', m.save);
        delete m.save;
        Object.assign(S, m);
        if (rig) setKart(rig, S.kart, headLabel, upgCode(S));
        refreshShop(); refreshModal();
        openDailyOnJoin();
    });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('offline', (m) => showOffline(m));
    room.onMessage('levelUp', (m) => {
        levelUp(m);
        sfx('levelUp'); rumble(0.3, 150);
        ring(P.pos, 0x5ae0ff, 12, 0.8);
        sparkleColumn(P.pos, 0x7dff6b);
        refreshShop();
    });
    room.onMessage('gain', (m) => { if (m.pack) { floatText('+' + fmt(m.n) + ' Speed', '#7dff6b', P.pos.clone().add(new V3(0, 6, 0))); sfx('buy'); } });
    room.onMessage('wins', (m) => {
        refreshShop();
        if (m.best) saveGhost(m.s); else pendingRun = null;
        const sub = m.escape ? null : m.best ? '🏅 NEW BEST: ' + m.t.toFixed(2) + 's!' : m.t ? 'Time: ' + m.t.toFixed(2) + 's' : null;
        showGoal(m.n, m.escape, sub);
        sfx('cheer'); if (m.best) setTimeout(() => sfx('best'), 500);
        rumble(0.7, 500);
        confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
        fireworks(P.pos, m.escape ? 14 : 6, () => sfx('firework'));
    });
    room.onMessage('reached', (m) => {
        const s = STAGES[m.s];
        if (s && m.s > 0) toast('🔓 ' + s.name + ' unlocked! (Teleport menu)', '#ffd028');
    });
    room.onMessage('quest', (m) => questDone(m));
    room.onMessage('codeResult', (m) => codeResult(m));
    room.onMessage('announce', (m) => toast(m.text, m.color));
    room.onMessage('event', (m) => {
        if (m.on) { toast('🏁 TURBO RUSH! x2 Speed & x2 Wins for 5 minutes!', '#ff8a2a'); sfx('gate'); fireworks(P.pos, 5, () => sfx('firework')); }
        else toast('Turbo Rush is over. Next one in 25 minutes!', '#ffffff');
    });
    room.onMessage('fx', (m) => {
        confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
        sparkleColumn(P.pos, m.kind === 'rebirth' ? 0x5ae0ff : m.kind === 'upgrade' ? 0xff8a2a : 0xffd028);
        sfx(m.kind === 'upgrade' ? 'upgrade' : 'buy');
        if (m.kind === 'rebirth' || m.kind === 'kart') { fireworks(P.pos, 8, () => sfx('firework')); ring(P.pos, 0xffd028, 14, 1); }
    });
    room.onMessage('boards', renderBoards);
    room.onLeave((code, reason) => {
        console.warn('[net] left room', code, reason || '');
        net.room = null;
        if (code !== 1000) $('#offline').hidden = false;
    });
    return room;
}

// =====================================================================================
// Camera & input
// =====================================================================================
// cam.yaw: direction from the target out to the camera (yaw + PI = right behind the kart)
const cam = { yaw: Math.PI, pitch: 0.25, dist: 13, target: new V3(), free: 0, zoom: 0 };
let camSens = 1;
const keys = {};
const touchMove = { x: 0, y: 0 };
let touchHop = false, touchNitro = false, touchBrake = false, running = false;

addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Enter') e.target.blur(); return; }
    if (e.code === 'Space' && !e.repeat && running) P.hopPress = clockT;
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyE' && running) usePrompt();
    if (e.code === 'KeyR' && running && !P.dead && P.cp.stage >= 0) { P.shield = 0; respawn(); }
    if (e.code === 'KeyC' && running) cam.free = 0;
    if (e.code === 'Escape') {
        for (const id of ['#confirm', '#daily', '#offlinePop']) if (!$(id).hidden) { $(id).hidden = true; return; }
        if (modalOpen()) closeModal();
        else if (running && BX.isEmbedded()) BX.showPortalMenu();
    }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const drags = new Map();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.focus(); });
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const k = (e.pointerType === 'touch' ? 0.008 : 0.005) * camSens;
    cam.yaw -= (e.clientX - d.x) * k;
    cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -0.1, 1.2);
    cam.free = 1.6;
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => drags.delete(e.pointerId);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.zoom = clamp(cam.zoom + Math.sign(e.deltaY) * 2.5, -8, 30); e.preventDefault(); }, { passive: false });

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
(function touchControls() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null;
    const set = (e) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const hold = (btn, on, off) => {
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); on(); });
        btn.addEventListener('pointerup', off); btn.addEventListener('pointercancel', off);
    };
    hold($('#hopBtn'), () => { touchHop = true; P.hopPress = clockT; }, () => { touchHop = false; });
    hold($('#nitroBtn'), () => { touchNitro = true; }, () => { touchNitro = false; });
    hold($('#brakeBtn'), () => { touchBrake = true; }, () => { touchBrake = false; });
})();

function rayHit(o, d, maxT) {
    let best = maxT;
    for (const c of near) {
        if (c.off || c.mover || c.ramp || c.max.y - c.min.y < 3.5) continue;
        let t0 = 0, t1 = best, hit = true;
        for (const a of ['x', 'y', 'z']) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) { hit = false; break; } continue; }
            let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { hit = false; break; }
        }
        if (hit && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}
const camDir = new V3(), camGoal = new V3(), camPos = new V3(), lookTmp = new V3(), lookAt = new V3();
const ATTRACT_LOOK = new V3(0, 6, 40);
let intro = null, baseFov = camera.fov;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const skyTint = new T.Color(FOG), tintTmp = new T.Color();
let qaCam = null;
function updateCamera(dt) {
    const t = performance.now() / 1000;
    if (qaCam) { camera.position.copy(qaCam.pos); camera.lookAt(qaCam.look); return; }
    if (!running) {
        camera.position.set(Math.sin(t * 0.08) * 60, 26, Math.cos(t * 0.08) * 50 - 20);
        camera.lookAt(ATTRACT_LOOK);
        baseFov = camera.fov;
        updateSky(camera.position, t, tintTmp.set(FOG), 0, dt);
        return;
    }
    const top = Math.max(20, topSpeed()), sp = Math.abs(P.speed), f = clamp(sp / 120, 0, 1);
    // Chase: the camera swings behind the kart (and a little into a drift) unless you're looking around
    cam.free -= dt;
    if (cam.free <= 0 && !P.dead) {
        const behind = P.yaw + Math.PI + P.drift * 0.22;
        const rate = P.speed < -3 ? 1.2 : 3.4 + f * 4;
        cam.yaw = lerpAngle(cam.yaw, behind, 1 - Math.exp(-dt * rate));
        cam.pitch += ((0.25 - f * 0.07 + (P.onGround ? 0 : 0.06) + chase.close * 0.2) - cam.pitch) * (1 - Math.exp(-dt * 2));
    }
    const fwdX = Math.sin(P.yaw), fwdZ = Math.cos(P.yaw);
    camGoal.set(P.pos.x + fwdX * (2 + f * 6), P.renderY + 3.1, P.pos.z + fwdZ * (2 + f * 6));
    cam.target.lerp(camGoal, 1 - Math.exp(-dt * 14));
    const dist = clamp(13 + f * 7 + cam.zoom, 6, 60);
    const cp = Math.cos(cam.pitch);
    camDir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    const hitD = Math.max(3.5, rayHit(cam.target, camDir, dist) - 0.8);
    cam.distNow = cam.distNow === undefined ? hitD : cam.distNow + (hitD - cam.distNow) * (hitD < cam.distNow ? 1 : 1 - Math.exp(-dt * 4));
    camPos.copy(cam.target).addScaledVector(camDir, cam.distNow);
    lookAt.copy(cam.target);
    if (intro) {
        intro.t += dt;
        const k = ease(Math.min(1, intro.t / intro.dur));
        camera.position.lerpVectors(intro.from, camPos, k);
        camera.lookAt(lookTmp.lerpVectors(ATTRACT_LOOK, lookAt, k));
        if (intro.t >= intro.dur) intro = null;
    } else {
        camera.position.copy(camPos);
        camera.lookAt(lookAt);
    }
    if (shake > 0.001) {
        const s = shake * shake * 0.9;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        shake = Math.max(0, shake - dt * 2.4);
    }
    // FOV opens up with speed, more with nitro and boosts
    const fovBase = innerWidth < innerHeight ? 85 : 70;
    const want = fovBase + f * 10 + (P.nitroOn ? 8 : 0) + (P.boostT > 0 ? 5 : 0);
    baseFov += (want - baseFov) * Math.min(1, dt * 4);
    if (Math.abs(camera.fov - baseFov) > 0.01) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
    sun.position.set(P.pos.x + 50, P.pos.y + 100, P.pos.z - 90);
    sun.target.position.copy(P.pos);
    const s = STAGES[P.stage];
    skyTint.set(s ? s.theme.sky : FOG);
    updateSky(camera.position, t, skyTint, s && s.theme.night ? 1 : 0, dt);
    updateAmbient(camera.position, t, s ? s.theme.accent : 0xffffff, s && s.theme.night ? 0.9 : 0.35);
    void top;
}

// Proximity prompts (none in this game yet; kept for portal events)
let activePrompt = null;
const projV = new V3();
function updatePrompt() {
    let best = null, bd = Infinity;
    if (!P.dead) for (const p of prompts) {
        const d = p.pos.distanceTo(P.pos);
        if (d < p.r && d < bd) { bd = d; best = p; }
    }
    activePrompt = best;
    if (!best) { promptEl.hidden = true; return; }
    projV.copy(best.pos).setY(best.pos.y + 2).project(camera);
    if (projV.z > 1) { promptEl.hidden = true; return; }
    promptEl.hidden = false;
    promptEl.style.left = ((projV.x + 1) / 2 * innerWidth) + 'px';
    promptEl.style.top = ((1 - projV.y) / 2 * innerHeight) + 'px';
    const txt = best.label();
    if (promptTxtEl.textContent !== txt) promptTxtEl.textContent = txt;
}
function usePrompt() { if (activePrompt) activePrompt.act(); }
promptEl.addEventListener('click', usePrompt);

// Controller buttons: popups and panels first, then gameplay shortcuts
const shownEl = (sel) => { const e = $(sel); return !!e && !e.hidden; };
function focusStep(container, dir) {
    const items = [...container.querySelectorAll('button:not(:disabled), input[type=range]')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = items[i < 0 ? 0 : (i + dir + items.length) % items.length];
    next.focus({ preventScroll: false });
    next.scrollIntoView({ block: 'nearest' });
}
let padHopWas = false;
function padButtons() {
    if (pad.jump && !padHopWas && running) P.hopPress = clockT;
    padHopWas = pad.jump;
    const p = pad.pressed;
    if (!p.size) return;
    const overlay = ['#start', '#offline', '#confirm', '#offlinePop', '#daily', '#modal'].find(shownEl);
    if (overlay === '#start') { if ((p.has('A') || p.has('START')) && shownEl('#playBtn')) play(); return; }
    if (overlay === '#offline') { if (p.has('A')) $('#reconnectBtn').click(); return; }
    if (overlay === '#confirm') { if (p.has('A')) $('#confirmYes').click(); else if (p.has('B')) $('#confirmNo').click(); return; }
    if (overlay === '#offlinePop') { if (p.has('A') || p.has('B')) $('#offlineOk').click(); return; }
    if (overlay === '#daily') { if (p.has('A') && !$('#dailyClaim').disabled) $('#dailyClaim').click(); else if (p.has('A') || p.has('B')) $('#dailyClose').click(); return; }
    if (overlay === '#modal') {
        const body = $(overlay);
        const el = document.activeElement;
        if (p.has('DOWN') || p.has('RIGHT')) focusStep(body, 1);
        else if (p.has('UP') || p.has('LEFT')) focusStep(body, -1);
        else if (p.has('A') && el && body.contains(el) && el.tagName === 'BUTTON') el.click();
        else if (p.has('B') || p.has('BACK') || p.has('START')) { closeModal(); canvas.focus(); }
        return;
    }
    if (!running) return;
    if (p.has('Y')) openModal('shop', 'boosts');
    if (p.has('LB')) openModal('garage');
    if (p.has('RB')) openModal('teleport');
    if (p.has('BACK')) openModal('karts');
    if (p.has('START')) openModal('settings');
    if (p.has('R3')) actions.autoTrain();
    if (p.has('UP')) cam.zoom = clamp(cam.zoom - 4, -8, 30);
    if (p.has('DOWN')) cam.zoom = clamp(cam.zoom + 4, -8, 30);
    if (['Y', 'LB', 'RB', 'BACK', 'START'].some((b) => p.has(b))) focusStep($('#modal'), 1);
}
onGamepadConnection((g, on) => { if (running) toast(on ? '🎮 Controller connected' : '🎮 Controller disconnected', on ? '#7dff6b' : '#ffb51c'); });

// =====================================================================================
// Driving
// =====================================================================================
const botInput = { throttle: 0, steer: 0, hop: false, nitro: false };
let qaSpeed = 0, qaFreeze = false;
let clockT = 0, hudT = 0, online = 1;
const DRIFT_LEVELS = [0.75, 1.5, 2.4];
const TURBO = [[0.55, 1.22], [0.9, 1.3], [1.35, 1.38]];
const prevSkid = [new V3(), new V3()], skidOn = [false, false];

function readInput() {
    let throttle = botInput.throttle, steer = botInput.steer;
    if (keys.KeyW || keys.ArrowUp) throttle += 1;
    if (keys.KeyS || keys.ArrowDown) throttle -= 1;
    if (keys.KeyD || keys.ArrowRight) steer += 1;
    if (keys.KeyA || keys.ArrowLeft) steer -= 1;
    // Controller: triggers for gas and brake, the stick to steer (up on the stick also drives)
    throttle += pad.rt - pad.lt;
    if (!pad.rt && !pad.lt) throttle -= pad.ly;
    steer += pad.lx;
    // Touch: any push on the stick drives forward, pull it down to brake or reverse
    const mag = Math.hypot(touchMove.x, touchMove.y);
    if (mag > 0.15) {
        steer += touchMove.x;
        throttle += touchMove.y < 0.35 ? clamp(Math.max(0.65, mag), 0, 1) : -clamp(touchMove.y, 0, 1);
    }
    if (touchBrake) throttle -= 1;
    return {
        throttle: clamp(throttle, -1, 1), steer: clamp(steer, -1, 1),
        hop: keys.Space || touchHop || pad.jump || botInput.hop,
        nitro: keys.ShiftLeft || keys.ShiftRight || touchNitro || pad.nitro || botInput.nitro,
    };
}

function update(dt) {
    clockT += dt;
    const t = clockT;
    const inp = readInput();
    cam.yaw -= pad.rx * 2.8 * dt;
    if (Math.abs(pad.rx) > 0.1 || Math.abs(pad.ry) > 0.1) cam.free = 1.2;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.8 * dt, -0.1, 1.2);
    if (training && (Math.abs(inp.steer) > 0.2 || inp.throttle < -0.2)) { stopTraining(); toast('Auto Train OFF', '#5ad8ff'); }
    const onRoller = P.onGround && P.ground && P.ground.tread;
    if (training && onRoller && treadOwned(onRoller)) inp.throttle = 1;
    if (P.dead || modalOpen()) { inp.throttle = 0; inp.steer = 0; inp.nitro = false; }
    // Waiting for GO: hold still (the gas is read for a perfect start)
    if (tickCountdown(dt, inp.throttle > 0.5)) { inp.throttle = 0; inp.steer = 0; inp.nitro = false; inp.hop = false; P.hopPress = -9; }

    // Hazards move first, so hits line up with what you see
    updateWorld(dt, P.stage);
    if (!qaFreeze) updateChase(dt);

    const top = topSpeed();
    const grip = gripMult(upg(S, 'grip'));
    if (qaFreeze) { /* dev QA: hold the kart still for posed screenshots */ } else if (!P.dead) {
        const ice = P.ground && P.ground.ice;
        // ----- nitro -----
        const tank = nitroSecs(upg(S, 'nitro'));
        P.nitroOn = inp.nitro && P.nitro > 0.02 && (P.speed > 2 || inp.throttle > 0) && !onRoller;
        if (P.nitroOn) { if (!P.nitroWas) { sfx('nitro'); addShake(0.15); } P.nitro = Math.max(0, P.nitro - dt / tank); P.nitroIdle = 0; }
        else { P.nitroIdle += dt; if (P.nitroIdle > 0.8) P.nitro = Math.min(1, P.nitro + dt * nitroRecharge(upg(S, 'nitro'))); }
        P.nitroWas = P.nitroOn;
        if (P.boostT > 0) P.boostT -= dt;
        const mult = (P.nitroOn ? nitroPower(upg(S, 'nitro')) : 1) * (P.boostT > 0 ? P.boostPow : 1);
        const target = top * mult;
        // ----- throttle, brakes, reverse -----
        const prevSpeed = P.speed;
        if (P.onGround) {
            // Up to top speed in about half a second; ice and boosts change that
            const accel = Math.max(44, top * 2.2) * (mult > 1 ? 1.4 : 1) * (ice ? 0.45 : 1);
            if (inp.throttle > 0.05 || mult > 1.01 && inp.throttle >= 0) {
                const th = Math.max(inp.throttle, mult > 1.01 ? 1 : 0);
                if (P.speed < 0) P.speed = Math.min(0, P.speed + top * 3.5 * dt);
                else if (P.speed < target * th) P.speed = Math.min(target * th, P.speed + accel * th * dt);
                else P.speed += (target * th - P.speed) * (1 - Math.exp(-dt * 1.6));
            } else if (inp.throttle < -0.05) {
                if (P.speed > 0.5) P.speed = Math.max(0, P.speed - Math.max(50, top * 3) * -inp.throttle * dt * (ice ? 0.35 : 1));
                else P.speed = Math.max(-Math.max(12, top * 0.45), P.speed - Math.max(20, top * 0.8) * -inp.throttle * dt);
            } else {
                P.speed *= Math.exp(-dt * (ice ? 0.15 : 0.55));
                if (Math.abs(P.speed) < 0.4) P.speed = 0;
            }
        }
        P.accel = (P.speed - prevSpeed) / Math.max(dt, 1e-4);
        // ----- steering and drifting -----
        P.steer += (inp.steer - P.steer) * (1 - Math.exp(-dt * 13));
        // Sharp at low speed, calmer near top speed, so it feels the same at any level
        const f = clamp(Math.abs(P.speed) / Math.max(25, top), 0, 1.3);
        let rate = (2.9 - 1.15 * Math.min(1, f)) * grip;
        const crawl = worldSpeed(Math.abs(P.speed));
        if (crawl < 8) rate *= crawl / 8;
        const dir = P.speed >= 0 ? 1 : -1;
        // Hop: a little jump; land holding it while steering to start a drift
        if (clockT - P.hopPress < 0.15 && P.onGround) {
            P.hopPress = -9;
            P.vy = CFG.hopV; P.onGround = false; P.ground = null;
            sfx('hop'); P.squashV += 4;
        }
        const canDrift = P.onGround && inp.hop && Math.abs(P.speed) > top * 0.35 && P.speed > 0;
        if (!P.drift && canDrift && Math.abs(inp.steer) > 0.3) { P.drift = Math.sign(inp.steer); P.driftT = 0; P.driftLvl = 0; sfx('drift'); }
        if (P.drift) {
            const endDrift = !inp.hop || P.speed < top * 0.25 || P.airTime > 0.6;
            if (endDrift) {
                if (P.driftLvl > 0 && P.onGround) {
                    const [secs, pw] = TURBO[P.driftLvl - 1];
                    P.boostT = Math.max(P.boostT, secs); P.boostPow = Math.max(P.boostT > secs ? P.boostPow : 1, pw);
                    P.speed = Math.max(P.speed, top * pw * 0.95);
                    sfx('turbo' + P.driftLvl); flashBoost(); addShake(0.12 * P.driftLvl);
                }
                P.drift = 0; P.driftT = 0; P.driftLvl = 0;
            } else {
                const into = clamp(P.steer * P.drift, -1, 1);
                P.yaw -= P.drift * rate * (0.55 + 0.45 * (1 + into)) * dt;
                if (P.onGround) P.driftT += dt * (0.8 + 0.2 * grip) * (0.7 + 0.3 * (1 + into) / 2);
                const lvl = P.driftT >= DRIFT_LEVELS[2] ? 3 : P.driftT >= DRIFT_LEVELS[1] ? 2 : P.driftT >= DRIFT_LEVELS[0] ? 1 : 0;
                if (lvl > P.driftLvl) { P.driftLvl = lvl; sfx('drift'); }
                P.speed *= Math.exp(-dt * 0.1);
            }
        } else if (P.onGround) P.yaw -= P.steer * rate * dir * dt;
        else P.yaw -= P.steer * rate * 0.35 * dir * dt;
        // Track assist: on the stages, let go of the steering and the kart lines up with the track
        if (P.stage >= 0 && !P.drift && Math.abs(inp.steer) < 0.1 && P.speed > 3 && P.onGround) {
            const off = angleDiff(P.yaw, 0);
            if (Math.abs(off) < 1.4) P.yaw += off * (1 - Math.exp(-dt * 2.6));
        }
        // ----- velocity: grip pulls it toward where the kart points (ice barely does) -----
        const nfx = Math.sin(P.yaw), nfz = Math.cos(P.yaw);
        if (P.onGround) {
            const gr = ice ? 1.1 : P.drift ? 5 : 14 * Math.min(1.4, grip);
            const k = 1 - Math.exp(-dt * gr);
            const ws = worldSpeed(P.speed);
            P.vx += (nfx * ws - P.vx) * k;
            P.vz += (nfz * ws - P.vz) * k;
        }
        P.vy -= GRAV * dt;
        let vx = P.vx, vz = P.vz;
        const wind = windAt(P.pos);
        if (wind && P.pos.y > -2) vx += wind;
        // On a Speed Roller the belt holds the kart in place while the wheels spin
        if (onRoller && vz > 0) { vx *= 0.1; vz = 0; }
        const dist = Math.max(Math.abs(vx), Math.abs(vz), Math.abs(P.vy)) * dt;
        const n = Math.max(1, Math.ceil(dist / 0.5));
        const sdt = dt / n;
        const wasGround = P.ground;
        P.onGround = false; P.ground = null;
        let vy = P.vy + 0.5 * GRAV * dt, hitX = false, hitZ = false;
        // Off the lip of a ramp: launch the moment the kart's back wheels leave it (checked every
        // sub-step, so the jump is the same length at any speed and frame rate)
        let onRamp = wasGround && wasGround.ramp ? wasGround.ramp : null, launched = false;
        for (let i = 0; i < n; i++) {
            if (moveAxis('x', vx * sdt)) hitX = true;
            if (moveAxis('z', vz * sdt)) hitZ = true;
            const before = P.vy;
            moveAxis('y', vy * sdt);
            if (P.vy !== before) vy = P.vy;
            if (P.ground && P.ground.ramp) onRamp = P.ground.ramp;
            if (!launched && onRamp && vz > 4 && P.pos.z - HW >= onRamp.z1 - 0.01 && vy <= 1) {
                launched = true;
                P.pos.y = Math.max(P.pos.y, onRamp.h);
                // Gravity still acts for the rest of this frame: end-of-frame and average speeds
                const rem = dt * (n - 1 - i) / n;
                P.vy = RAMP.vy - GRAV * rem; vy = RAMP.vy - GRAV * rem / 2;
                P.onGround = false; P.ground = null;
                P.lastRamp = onRamp; P.launchT = clockT;
                // Too slow for this jump: it comes up short
                const lf = launchFactor(P.speed, onRamp.need);
                if (lf < 1) { P.vx *= lf; P.vz *= lf; vx *= lf; vz *= lf; }
                sfx('ramp'); addShake(0.2); dust(P.pos, 6, 1.2);
            }
        }
        if (launched) { P.onGround = false; P.ground = null; }
        // Stick to the road over small dips (not off ramps)
        if (!P.onGround && wasGround && !wasGround.ramp && P.vy <= 0 && P.vy > -40 && P.airTime < 0.05) {
            const y0 = P.pos.y;
            moveAxis('y', -0.4);
            if (!P.onGround) P.pos.y = y0;
        }
        // Walls: lose the speed into them, scrape sparks
        if (hitX || hitZ) {
            const into = Math.abs(hitX ? P.vx : 0) + Math.abs(hitZ ? P.vz : 0);
            // Side walls: slide along them, losing a little speed; a wall ahead: bounce back
            if (hitX) { P.vx = -P.vx * 0.1; P.vz *= Math.exp(-dt * 1.2); }
            if (hitZ) P.vz = -P.vz * 0.15;
            if (hitX && !hitZ) { const want = P.vz >= 0 ? 0 : Math.PI; P.yaw = lerpAngle(P.yaw, want, 0.12); }
            if (into > 14 && clockT - P.bumpT > 0.3) {
                P.bumpT = clockT;
                sfx('bump'); addShake(Math.min(0.6, into / 80)); rumble(Math.min(1, into / 60), 120);
                wallSparks(P.pos.clone().add(new V3(Math.sin(P.yaw) * 2.5, 0, Math.cos(P.yaw) * 2.5)), 10);
                if (P.drift) { P.drift = 0; P.driftT = 0; P.driftLvl = 0; }
            }
        }
        // A wall took some of the speed: the engine speed follows what is left
        if (!onRoller && (hitX || hitZ)) P.speed = speedFromWorld(P.vx * nfx + P.vz * nfz);
        // Landing
        if (P.onGround) {
            if (P.airTime > 0.15 && inp.hop && Math.abs(inp.steer) > 0.3 && P.speed > top * 0.35 && !P.drift) { P.drift = Math.sign(inp.steer); P.driftT = 0; P.driftLvl = 0; sfx('drift'); }
            if (P.airTime > 0.35) {
                sfx('land');
                dust(P.pos, P.airTime > 0.8 ? 14 : 7, P.airTime > 0.8 ? 1.5 : 1);
                P.squashV -= Math.min(10, 3 + P.airTime * 7);
                if (P.airTime > 0.7) { ring(P.pos, 0xffffff, 6, 0.45); addShake(0.35); rumble(0.5, 140); }
            }
            P.airTime = 0;
        } else P.airTime += dt;
        P.moving = (Math.abs(P.speed) > CFG.moveMin) || !!(training && onRoller);

        if (P.shield > 0) P.shield -= dt;
        // Stage you're in, the abyss under it, hazards
        const here = stageAt(P.pos.z);
        if (here !== P.stage) {
            P.stage = here;
            refreshNear(here);
        }
        if (P.pos.y < -14) { P.shield = 0; die(P.pos.y < -20 && P.stage >= 0 && STAGES[P.stage].themeKey === 'glitch' ? 'glitch' : 'fall'); }
        if (!P.dead) for (const k of nearKills) {
            if (!k.active) continue;
            if (k.test ? k.test(P.pos) : (k.max.x > P.pos.x - HW + 0.4 && k.min.x < P.pos.x + HW - 0.4 && k.max.y > P.pos.y + 0.05 && k.min.y < P.pos.y + 3.6 && k.max.z > P.pos.z - HW + 0.4 && k.min.z < P.pos.z + HW - 0.4)) { die(k.cause); break; }
        }
        for (const tr of nearTriggers) {
            const inside = overlapsBox(tr, P.pos);
            if (inside && !tr.inside && tr.enter) tr.enter();
            tr.inside = inside;
            if (P.dead) break;
        }
        if (onRoller && P.moving && !treadOwned(onRoller) && t - P.lockToastT > 3) { P.lockToastT = t; actions.treadBuy(onRoller); }
    } else {
        P.speed *= Math.exp(-dt * 4);
        P.deadT -= dt;
        if (P.deadT <= 0) respawn();
    }

    if (S.name && S.name !== nameLabelText && headLabel) { nameLabelText = S.name; headLabel.userData.set([{ t: S.name, c: '#ffffff', s: '#141a2e', px: 60 }]); }
    updateEffects(dt);
    updateFx(dt);
    updateMaterials(dt);
    for (const fn of tickers) fn(dt, t);

    online = syncRemotes(dt, t);
    friendsT -= dt; friendSyncT -= dt;
    if (friendsT <= 0) { friendsT = 30; friendSyncT = 5; refreshFriends(); }
    else if (friendSyncT <= 0) { friendSyncT = 5; syncFriends(); }

    // ----- the local racer -----
    if (rig) {
        const u = rig.userData;
        // Steps and ramps look smooth: the drawn kart eases toward the physics height
        P.renderY += (P.pos.y - P.renderY) * (P.pos.y > P.renderY ? 1 - Math.exp(-dt * 22) : 1);
        rig.position.set(P.pos.x, P.renderY, P.pos.z);
        P.visYaw = lerpAngle(P.visYaw, P.yaw - P.drift * 0.36, 1 - Math.exp(-dt * 12));
        rig.rotation.y = P.visYaw;
        setKart(rig, S.kart, headLabel, upgCode(S));
        setTrail(rig, S.trail);
        // Nose up on ramps, follows the arc in the air
        const kartU = u.kart.userData;
        const onRamp = P.onGround && P.ground && P.ground.ramp;
        const pitchT = onRamp ? -Math.atan2(RAMP.h, RAMP.len) : !P.onGround ? clamp(-P.vy * 0.008, -0.35, 0.35) : 0;
        u.pitchX = (u.pitchX || 0) + (pitchT - (u.pitchX || 0)) * (1 - Math.exp(-dt * 8));
        u.kart.rotation.x = u.pitchX;
        animateRacer(rig, dt, t, { speed: worldSpeed(P.speed), steer: P.drift ? P.drift * 0.6 + P.steer * 0.4 : P.steer, drift: P.drift, air: !P.onGround, accel: P.accel, nitro: P.nitroOn, boost: P.boostT > 0, driftLvl: P.driftLvl, onGround: P.onGround });
        u.trail.update(trailPoint(rig).setY(P.renderY + 1.3), Math.abs(P.speed) > 8 && !P.dead, dt, t);
        // Skid marks from the rear wheels while drifting or braking hard
        const skidding = P.onGround && !P.dead && (P.drift || (P.accel < -top * 1.5 && P.speed > 10) || (P.ground && P.ground.ice && Math.abs(P.steer) > 0.5 && P.speed > 20));
        for (let i = 0; i < 2; i++) {
            const w = wheelWorld(rig, (i ? 1 : -1) * 2.36, -2.3, tipAt).clone();
            if (skidding && skidOn[i]) addSkid(prevSkid[i], w, 0.85);
            prevSkid[i].copy(w); skidOn[i] = skidding;
        }
        if (skidding && !P.drift && Math.random() < dt * 20) tireSmoke(P.pos, 0.7);
        P.squashV += (1 - P.squash) * 180 * dt;
        P.squashV *= Math.exp(-12 * dt);
        P.squash = clamp(P.squash + P.squashV * dt, 0.75, 1.25);
        u.kart.scale.set(1 / Math.sqrt(P.squash), P.squash, 1 / Math.sqrt(P.squash));
        rig.visible = !P.dead && (P.shield <= 0 || Math.floor(t * 12) % 2 === 0);
        const fsp = Math.abs(P.speed), wsp = worldSpeed(fsp);
        setSpeedLines(!P.dead && (wsp > 34 || P.nitroOn || P.boostT > 0) && !reduceMotion ? (P.nitroOn ? 1 : P.boostT > 0 ? 0.8 : 0.45) : 0, dt, P.nitroOn);
        setSpeedBlur(reduceMotion ? 0 : clamp((wsp - 26) / 110, 0, 0.45) + (P.nitroOn ? 0.25 : 0));
        setEngine(!P.dead, fsp / Math.max(20, top), Math.max(0, inp.throttle), P.drift ? 1 : 0, P.nitroOn ? 1 : 0);
    }
    updateSpeedo(P.speed, maxSpeedOf(S), P.nitro, P.nitroOn, P.drift ? Math.max(0.5, P.driftLvl) : 0);
    updateLap(P.lap ? P.lap.stage : -1, P.lap ? clockT - P.lap.t0 : null);
    recordGhost();
    const gz = updateGhost(dt);
    updateProgress(P.stage, P.pos.z, gz);

    sendMove(false);
    updatePrompt();
    animateCounters(dt);
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.1; updateHud(); refreshShop(); updateLobbySigns(); }
    void online;
}

// =====================================================================================
// Boot
// =====================================================================================
let lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, showFps = false;
function frame(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) { if (showFps) $('#fps').textContent = Math.round(fpsFrames / fpsAcc) + ' FPS'; fpsAcc = 0; fpsFrames = 0; }
    lastFrame = now;
    if (!loadingSignaled) { loadingSignaled = true; BX.triggerAllSettings(); }
    pollGamepad();
    padButtons();
    if (running) update(dt);
    else { for (const fn of tickers) fn(dt, now / 1000); updateWorld(dt, -1); }
    updateCamera(dt);
    render();
    requestAnimationFrame(frame);
}

let joining = false;
async function play() {
    if (joining || running) return;
    joining = true;
    const err = $('#connectErr'), retry = $('#playBtn');
    err.hidden = true; retry.hidden = true;
    $('#loading').hidden = false;
    $('#loading').textContent = 'Joining…';
    BX.loadingStep('Joining a server…');
    initAudio();
    try {
        await waitForLogin(1500);
        const saved = (storageGet('gke_name') || '').slice(0, 20);
        let room = null;
        for (let attempt = 0; !room; attempt++) {
            try { room = await connect(BX.identity().loggedIn ? '' : saved); } catch (e) {
                if (attempt >= 4) throw e;
                console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
                $('#loading').textContent = 'Waking up a server…';
                await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
            }
        }
        const me = room.state.players && room.state.players.get(room.sessionId);
        S.name = me ? me.name : S.name;
    } catch (e) {
        console.error(e);
        joining = false;
        $('#loading').hidden = true;
        err.hidden = false;
        err.textContent = 'Could not reach the game server. Check your connection and try again.';
        retry.hidden = false;
        BX.loadingEnd();
        return;
    }
    joining = false;
    intro = { t: 0, dur: 2.2, from: camera.position.clone() };
    running = true;
    startMusic();
    $('#start').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !isTouch;
    if (!rig) buildPlayer(0, 0);
    teleportLobby();
    showTips();
    toast('Drive to get +Speed! Every level = a faster kart!', '#7dff6b');
    setTimeout(() => { if (audioSuspended()) toast('🔊 Click or tap anywhere to turn on the sound!', '#ff8a2a'); }, 3500);
    canvas.focus();
    BX.loadingEnd();
}
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => {
        const t0 = performance.now();
        (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })();
    });
}
function showTips() {
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = pad.connected
        ? k('RT', 'Gas') + k('LT', 'Brake') + k('L', 'Steer') + k('A', 'Hop / hold to Drift') + k('X', 'Nitro')
        : isTouch
            ? '<span>Push the stick to drive & steer · hold HOP/DRIFT while turning for a turbo · NITRO for a boost</span>'
            : k('W', 'Gas') + k('S', 'Brake') + k('A D', 'Steer') + k('Space', 'Hop · hold to Drift') + k('Shift', 'Nitro') + k('R', 'Checkpoint') + k('Drag', 'Camera');
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 10000);
    setTimeout(() => { el.hidden = true; }, 10900);
}
function unlockAudioOnGesture() {
    const unlock = () => {
        resumeAudio();
        if (!audioSuspended()) for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) removeEventListener(ev, unlock, true);
    };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) addEventListener(ev, unlock, true);
}
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => { const n = parseFloat(String(v)); if (!isFinite(n)) return undefined; return clamp(n > 1 ? n / 100 : n, 0, 1); };
    BX.listenSetting('master_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('master', p); }));
    BX.listenSetting('music_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('music', p); }));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high')));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { if (P.dead) respawn(); else if (running) teleportLobby(); }
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { playEmoteOn(localAvatar, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}
function showIdentity(id) {
    const avail = BX.bloxity.ready;
    $('#acct').hidden = !avail;
    if (!avail) return;
    $('#acctName').textContent = id.name || 'Guest';
    $('#acctBtn').textContent = id.loggedIn ? 'Log out' : 'Log in';
    const pfp = $('#acctPfp');
    pfp.hidden = !id.pfp;
    if (id.pfp) pfp.src = id.pfp;
}
function toggleLogin() { if (BX.identity().loggedIn) BX.logout(); else BX.login(); }

async function boot() {
    BX.initBloxity();
    BX.loadingStep('Loading fonts…');
    try { await Promise.race([Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('800 40px Montserrat')]), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fallback font */ }
    BX.loadingStep('Building the speedway…');
    buildWorld();
    refreshNear(-1);
    loadBase().catch(() => {});
    wirePortalSettings();
    wirePortalEvents();
    BX.onIdentity((id) => {
        showIdentity(id);
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    $('#acctBtn').addEventListener('click', toggleLogin);
    $('#acctPfp').addEventListener('error', (e) => { e.target.hidden = true; });
    $('#playBtn').addEventListener('click', play);
    $('#reconnectBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// Dev-only hooks for automated QA runs (stripped from production builds)
if (import.meta.env.DEV) {
    window.__qa = {
        audio: () => audioDebug(), input: (o) => Object.assign(botInput, o), solids, cam, P, S, STAGES, avatarStats, scene, camera, net, renderer: () => renderer,
        teleport: (x, y, z, yaw) => { P.padLock = false; teleport(new V3(x, y, z), yaw || 0); },
        speed: (n) => { qaSpeed = n; }, deaths: () => deaths, near: () => near.length, showroomPads,
        // Runs the game at 60 steps a second without rendering, holding the given input
        // Hazards follow the server clock, so the simulated time moves that clock along too
        sim: (secs, inp) => { Object.assign(botInput, inp || {}); for (let i = 0; i < Math.round(secs * 60); i++) { net.offset += 1000 / 60; update(1 / 60); } Object.assign(botInput, { throttle: 0, steer: 0, hop: false, nitro: false }); return window.__qa.state(); },
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; cam.zoom = dist - 15; cam.free = 999; intro = null; },
        follow: () => { cam.free = 0; cam.zoom = 0; intro = null; }, skipIntro: () => { intro = null; },
        settle: (n) => { for (let i = 0; i < (n || 90); i++) updateCamera(1 / 60); },
        camAt: (p, l) => { qaCam = p ? { pos: new V3(...p), look: new V3(...l) } : null; },
        closeDaily: () => { document.querySelector('#daily').hidden = true; },
        info: () => { renderer.info.reset(); renderer.render(scene, camera); return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures }; },
        send: (type, msg) => net.send(type, msg),
        hop: () => { P.hopPress = clockT; },
        freeze: (on) => { qaFreeze = !!on; },
        actions, worldSpeed, chase: () => ({ on: !!chase.zone, cops: chase.cops.length, gap: chase.cops.length ? chase.path[chase.path.length - 1].s - chase.cops[0].s : null }), superPads,
        state: () => ({ x: P.pos.x, y: P.pos.y, z: P.pos.z, yaw: P.yaw, speed: P.speed, dead: P.dead, stage: P.stage, wins: S.wins, level: S.level, xp: S.xp, maxStage: S.maxStage, onGround: P.onGround, drift: P.drift, driftLvl: P.driftLvl, nitro: P.nitro }),
    };
}
