import {
    T, V3, scene, mat, gloss, studMaterial, aabb, solids, kills, triggers, tickers,
    texFrom, billboard, textPlane, camera, buildRig, mergeRig, mergeChildren, chrome, paint,
} from './engine.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildKart, animateKart } from './kart.js';
import {
    chevronTexture, checkerTexture, stripeTexture, boostTexture, lavaTexture, beamTexture, rollerTexture,
    scrolling,
} from './textures.js';
import { emitTread } from './fx.js';
import { S, actions, net } from './state.js';
import {
    CFG, LOBBY, STAGES, STAGE_W, LANE_X, RAMP, PAD, SUMMIT, SHOWROOM, SUPERCARS, TREADMILLS, TREAD_GEO, TRAILS, kartById,
    fmt, clock, rngFrom, eventState, maxSpeedOf, gapFor, runupFor, ENTRY, REST, worldSpeed,
} from '../../shared/config.js';

const HW = STAGE_W / 2;                 // 30: half the corridor width
const LX = LOBBY.halfX, LZ0 = LOBBY.z0, LZ1 = LOBBY.z1;
const WALL_H = 34, PIT = -46;
export const SPAWN = new V3(LOBBY.spawn.x, LOBBY.spawn.y, LOBBY.spawn.z);
const css = (h) => '#' + h.toString(16).padStart(6, '0');
const shade = (c, k) => new T.Color(c).multiplyScalar(k).getHex();
const lighten = (c, k) => new T.Color(c).lerp(new T.Color(0xffffff), k).getHex();

// =====================================================================================
// Zones: the lobby (-1) and one per stage. Each zone's meshes live in their own group, so far
// stages can be hidden, and the kart only collides with nearby zones.
// =====================================================================================
const zoneGroups = new Map();
export function zoneGroup(i) {
    let g = zoneGroups.get(i);
    if (!g) { g = new T.Group(); g.userData.zone = i; scene.add(g); zoneGroups.set(i, g); }
    return g;
}
export function cullZones(stage) {
    for (const [i, g] of zoneGroups) g.visible = i === -1 ? stage <= 0 : stage < 0 ? i === 0 : Math.abs(i - stage) <= 1;
}

// ----- static geometry, merged per zone and material at the end -----
const geoBatches = new Map();
function addGeo(zone, geo, material, cast) {
    const k = zone + '|' + material.uuid + '|' + (cast ? 1 : 0);
    let b = geoBatches.get(k);
    if (!b) { b = { zone, material, cast, list: [] }; geoBatches.set(k, b); }
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!geo.index) { const idx = []; for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i); geo.setIndex(idx); }
    b.list.push(geo);
}
function flushGeo() {
    for (const b of geoBatches.values()) {
        const mesh = new T.Mesh(mergeGeometries(b.list), b.material);
        mesh.receiveShadow = true; mesh.castShadow = !!b.cast;
        mesh.matrixAutoUpdate = false;
        zoneGroup(b.zone).add(mesh);
        for (const g of b.list) g.dispose();
    }
    geoBatches.clear();
}
function solid(zone, x, y, z, sx, sy, sz, extra) {
    const c = aabb(x, y, z, sx, sy, sz);
    c.zone = zone;
    if (extra) Object.assign(c, extra);
    solids.push(c);
    return c;
}
// Box with Roblox studs: UVs in world units / 8 so the stud tile keeps its size on any face
function studBox(zone, sx, sy, sz, x, y, z, color, o) {
    o = o || {};
    const g = new T.BoxGeometry(sx, sy, sz);
    const uv = g.attributes.uv;
    const faces = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * faces[f][0] / 8, uv.getY(i) * faces[f][1] / 8);
    }
    g.translate(x, y, z);
    addGeo(zone, g, studMaterial(color, { rough: o.rough, emissive: o.emissive }), o.cast);
    if (o.solid !== false) return solid(zone, x, y, z, sx, sy, sz, o.extra);
    return null;
}
function plainBox(zone, sx, sy, sz, x, y, z, material, o) {
    o = o || {};
    const g = new T.BoxGeometry(sx, sy, sz);
    if (o.uvScale) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * o.uvScale[0], uv.getY(i) * o.uvScale[1]); }
    if (o.rx) g.rotateX(o.rx);
    if (o.rz) g.rotateZ(o.rz);
    if (o.ry) g.rotateY(o.ry);
    g.translate(x, y, z);
    addGeo(zone, g, material, o.cast);
    if (o.solid) return solid(zone, x, y, z, sx, sy, sz, o.extra);
    return null;
}
function roundBox(zone, sx, sy, sz, x, y, z, material, r, o) {
    o = o || {};
    const g = new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r, sx / 2 - 0.01, sy / 2 - 0.01, sz / 2 - 0.01));
    if (o.ry) g.rotateY(o.ry);
    g.translate(x, y, z);
    addGeo(zone, g, material, o.cast);
    if (o.solid) return solid(zone, x, y, z, sx, sy, sz, o.extra);
    return null;
}
const glowMat = (c, k) => mat(c, { neon: true, boost: k });
function glowBox(zone, sx, sy, sz, x, y, z, color, k) { plainBox(zone, sx, sy, sz, x, y, z, glowMat(color, k)); }
function cyl(zone, r0, r1, h, x, y, z, material, seg, o) {
    o = o || {};
    const g = new T.CylinderGeometry(r0, r1, h, seg || 24);
    if (o.rx) g.rotateX(o.rx);
    if (o.rz) g.rotateZ(o.rz);
    g.translate(x, y, z);
    addGeo(zone, g, material, o.cast);
}
// Traffic cone (static decor)
function cone(zone, x, z, y, s) {
    s = s || 1;
    cyl(zone, 0.15 * s, 0.75 * s, 2.0 * s, x, (y || 0) + 1.05 * s, z, gloss(0xff6a14, { rough: 0.35 }), 14, { cast: true });
    cyl(zone, 0.33 * s, 0.5 * s, 0.4 * s, x, (y || 0) + 1.15 * s, z, gloss(0xffffff, { rough: 0.35 }), 14);
    plainBox(zone, 1.7 * s, 0.16 * s, 1.7 * s, x, (y || 0) + 0.08 * s, z, gloss(0xff6a14, { rough: 0.4 }));
}
// A stack of tyres (decor)
const TIRE_GEO = new T.TorusGeometry(1.25, 0.55, 10, 22);
function tireStack(zone, x, z, n, y) {
    for (let i = 0; i < n; i++) {
        const g = TIRE_GEO.clone(); g.rotateX(Math.PI / 2); g.translate(x, (y || 0) + 0.55 + i * 1.05, z);
        addGeo(zone, g, gloss(0x1e1e24, { rough: 0.8 }), true);
    }
}

// ----- text -----
// Floating title: gradient text with an outline, optional subtitle
function banner(zone, text, colors, w, pos, face, sub, subColor) {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = sub ? 300 : 200;
    const x = cv.getContext('2d');
    x.font = '700 118px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    let px = 118;
    while (x.measureText(text).width > 990 && px > 40) { px -= 4; x.font = `700 ${px}px Fredoka, sans-serif`; }
    x.lineJoin = 'round'; x.lineWidth = 18; x.strokeStyle = '#141a2e'; x.strokeText(text, 512, 100);
    const g = x.createLinearGradient(0, 40, 0, 160);
    g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
    x.fillStyle = g; x.fillText(text, 512, 100);
    if (sub) {
        let sp = 58;
        x.font = `700 ${sp}px Fredoka, sans-serif`;
        while (x.measureText(sub).width > 990 && sp > 20) { sp -= 2; x.font = `700 ${sp}px Fredoka, sans-serif`; }
        x.lineWidth = 12; x.strokeText(sub, 512, 232);
        x.fillStyle = subColor || '#ffd028'; x.fillText(sub, 512, 232);
    }
    const m = new T.Mesh(new T.PlaneGeometry(w, w * cv.height / 1024), new T.MeshBasicMaterial({ map: texFrom(cv), transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    m.position.copy(pos); m.rotation.y = Math.atan2(face.x, face.z);
    zoneGroup(zone).add(m);
    return m;
}

// =====================================================================================
// Signs that depend on your speed ("⚡ NEED 42"): green when your top speed is enough
// =====================================================================================
const speedSigns = [];
function speedSign(zone, need, pos, w, label) {
    const lines = (ok) => [
        { t: label || 'JUMP NEEDS', c: '#ffffff', s: '#141a2e', px: 46 },
        { t: '⚡ ' + need + ' SPEED', c: ok ? '#7dff6b' : '#ff5a5a', s: '#141a2e', px: 78 },
        { t: ok ? 'You can make it!' : 'Level up first!', c: ok ? '#c8ffb8' : '#ffd0d0', s: '#141a2e', px: 38 },
    ];
    const sp = billboard(lines(false), w || 16, 512, pos, zoneGroup(zone));
    speedSigns.push({ sp, need, lines, ok: null });
}
export function refreshSpeedSigns() {
    const max = maxSpeedOf(S);
    for (const s of speedSigns) {
        const ok = max >= s.need;
        if (ok === s.ok) continue;
        s.ok = ok;
        s.sp.userData.set(s.lines(ok));
    }
}

// =====================================================================================
// Lobby: a grey studded plaza (as in the reference) with dark navy walls and orange stripes.
// Stage 1 is through the north wall (+z). West (-x): the GO-KARTS showroom. East (+x): the SPEED
// ROLLERS, trails and the GARAGE. Leaderboards on the north-west wall.
// =====================================================================================
const shopItems = [];
const boards = {};
const signs = {};
export function treadOwned(def) { return def.cost === 0 && !def.daily ? true : !!S.treads[def.id]; }
const LOBBY_FLOOR = 0xb8bccb, LOBBY_WALL = 0x34405e, LOBBY_STRIPE = 0xff5a1e;

function buildLobby() {
    const Z = -1;
    const g = zoneGroup(Z);
    studBox(Z, LX * 2, 2, LZ1 - LZ0, 0, -1, (LZ0 + LZ1) / 2, LOBBY_FLOOR);
    // Darker driving lane from the spawn to Stage 1, with dashed lines and arrows
    plainBox(Z, 26, 0.04, LZ1 - SPAWN.z + 6, 0, 0.02, (SPAWN.z + LZ1) / 2, gloss(0x6a7088, { rough: 0.8 }));
    for (let z = SPAWN.z + 12; z < LZ1 - 6; z += 12) plainBox(Z, 0.6, 0.05, 5, 0, 0.04, z, gloss(0xffffff, { rough: 0.6 }));
    for (const s of [-1, 1]) glowBox(Z, 0.4, 0.06, LZ1 - SPAWN.z, s * 13, 0.05, (SPAWN.z + LZ1) / 2, 0xff8a2a, 1.2);

    // Walls with stripes and pillars; an opening for the Stage 1 corridor
    const WH = LOBBY.wallHeight;
    studBox(Z, 2, WH, LZ1 - LZ0 + 4, LX + 1, WH / 2, (LZ0 + LZ1) / 2, LOBBY_WALL);
    studBox(Z, 2, WH, LZ1 - LZ0 + 4, -LX - 1, WH / 2, (LZ0 + LZ1) / 2, LOBBY_WALL);
    studBox(Z, LX * 2 + 4, WH, 2, 0, WH / 2, LZ0 - 1, LOBBY_WALL);
    for (const s of [-1, 1]) studBox(Z, LX - HW, WH, 2, s * (HW + (LX - HW) / 2), WH / 2, LZ1 + 1, LOBBY_WALL);
    studBox(Z, HW * 2, WH - 30, 2, 0, 30 + (WH - 30) / 2, LZ1 + 1, LOBBY_WALL);
    // Orange diagonal stripes and dark pillars (the reference lobby walls)
    const stripeM = gloss(LOBBY_STRIPE, { rough: 0.45 });
    for (let z = LZ0 + 12; z < LZ1 - 6; z += 26) for (const s of [-1, 1]) {
        plainBox(Z, 0.6, 30, 3, s * (LX - 0.1), 22, z, stripeM, { rx: 0.5 });
        studBox(Z, 3, WH, 4, s * (LX - 1.2), WH / 2, z + 13, 0x1e2438, { solid: false });
    }
    for (let x = -LX + 14; x < LX - 6; x += 26) {
        plainBox(Z, 3, 30, 0.6, x, 22, LZ0 + 0.1, stripeM, { rz: 0.5 });
        if (Math.abs(x) > HW + 4) plainBox(Z, 3, 30, 0.6, x, 22, LZ1 - 0.1, stripeM, { rz: -0.5 });
    }
    for (const [sx, sz, x, z] of [[2.6, LZ1 - LZ0 + 4, LX + 1, (LZ0 + LZ1) / 2], [2.6, LZ1 - LZ0 + 4, -LX - 1, (LZ0 + LZ1) / 2], [LX * 2 + 4, 2.6, 0, LZ0 - 1], [LX * 2 + 4, 2.6, 0, LZ1 + 1]]) {
        roundBox(Z, sx, 1.4, sz, x, WH + 0.7, z, gloss(LOBBY_STRIPE, { rough: 0.35 }), 0.5);
    }
    // Orange frame round the Stage 1 doorway
    for (const s of [-1, 1]) roundBox(Z, 3, 30, 3.2, s * (HW + 1.5), 15, LZ1 - 0.2, gloss(0xff8a2a, { rough: 0.3 }), 0.6);
    roundBox(Z, HW * 2 + 6, 3, 3.2, 0, 30, LZ1 - 0.2, gloss(0xff8a2a, { rough: 0.3 }), 0.6);
    // Ceiling beams over the plaza (the reference's indoor arena look)
    for (let z = LZ0 + 20; z < LZ1; z += 40) studBox(Z, LX * 2, 2.5, 3, 0, WH - 2, z, 0x1e2438, { solid: false });

    // Spawn: a glowing ring on the lane
    const ringM = new T.Mesh(new T.RingGeometry(6.2, 7.4, 48), glowMat(0xff8a2a, 1.4));
    ringM.rotation.x = -Math.PI / 2; ringM.position.set(SPAWN.x, 0.07, SPAWN.z); g.add(ringM);
    // Giant "+1" over the lane, like the reference thumbnail
    const plus = textPlane([{ t: '+1 ⚡', c: '#ffffff', s: '#141a2e', px: 200 }], 26, 1024, new V3(0, 32, 40), new V3(0, 32, -100), g);
    tickers.push((dt, t) => { if (g.visible) plus.position.y = 32 + Math.sin(t * 1.2) * 1.2; });
    // Tyre stacks and cones dressing the lane
    for (const [x, z] of [[-20, -20], [20, -20], [-20, 30], [20, 30]]) tireStack(Z, x, z, 3);
    for (let z = -10; z < 70; z += 20) for (const s of [-1, 1]) cone(Z, s * 16, z);

    buildBoards(Z);
    buildChests(Z);
    buildEventBoard(Z);
    buildShowroom(Z);
    buildRollers(Z);
    buildTrails(Z);
    buildGarage(Z);
    buildSuperShowroom(Z);
}

// ----- leaderboards: TOP SPEED / TOP WINS / TOP REBIRTHS on the north-west wall -----
function leaderboard(Z, pos, title, color, face) {
    const grp = new T.Group(); grp.position.copy(pos); grp.rotation.y = Math.atan2(face.x, face.z); zoneGroup(Z).add(grp);
    const frameM = gloss(color, { rough: 0.3 });
    const add = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; grp.add(o); return o; };
    add(new RoundedBoxGeometry(17, 24, 1.6, 2, 0.6), frameM, 0, 15.5, 0);
    for (const sx of [-1, 1]) add(new RoundedBoxGeometry(1.4, 4, 1.4, 2, 0.4), gloss(shade(color, 0.7), { rough: 0.4 }), sx * 6, 2, 0);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640;
    const tex = texFrom(cv);
    const scr = new T.Mesh(new T.PlaneGeometry(15, 18.75), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, 14.4, 0.82); grp.add(scr);
    const head = textPlane([{ t: title, c: '#ffffff', s: '#141a2e', px: 92 }], 15, 1024, new V3(), new V3(0, 0, 1), grp);
    head.position.set(0, 25.4, 0.85);
    solids.push(Object.assign(aabb(pos.x, 13, pos.z, 16, 26, 4), { zone: Z }));
    return { cv, tex, color };
}
function buildBoards(Z) {
    const face = new V3(0, 0, -1);
    boards.speed = leaderboard(Z, new V3(-46, 0, LZ1 - 4), '⚡ Top Speed', 0x3a8cff, face);
    boards.wins = leaderboard(Z, new V3(-66, 0, LZ1 - 4), '🏆 Top Wins', 0xffb81c, face);
    boards.rebirths = leaderboard(Z, new V3(-86, 0, LZ1 - 4), '🔄 Top Rebirths', 0xff5ab8, face);
}
function drawBoard(b, rows, kind) {
    const x = b.cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 640);
    g.addColorStop(0, '#22305a'); g.addColorStop(1, '#101830');
    x.fillStyle = g; x.fillRect(0, 0, 512, 640);
    x.font = '700 32px Fredoka, sans-serif'; x.textBaseline = 'middle';
    if (!rows.length) { x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.fillText('Be the first!', 256, 320); }
    rows.forEach((r, i) => {
        const y = 34 + i * 62;
        if (i % 2 === 0) { x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(0, y - 31, 512, 62); }
        x.textAlign = 'left'; x.fillStyle = r.you ? '#7dff6b' : i < 3 ? ['#ffd028', '#e0e6f0', '#e8a060'][i] : '#ffffff';
        x.fillText('#' + (i + 1), 14, y);
        x.fillText(r.n.slice(0, 13), 78, y);
        x.textAlign = 'right'; x.fillStyle = kind === 'speed' ? '#6fe0ff' : kind === 'wins' ? '#ffd028' : '#ff8ad8';
        x.fillText(fmt(r.v), 500, y);
    });
    b.tex.needsUpdate = true;
}
export function renderBoards(msg) {
    if (!boards.speed || !msg) return;
    for (const kind of ['speed', 'wins', 'rebirths']) drawBoard(boards[kind], (msg[kind] || []).map((r) => ({ n: r.n, v: r.v, you: r.n === S.name })), kind);
}

// ----- chests: Free Reward (gold) and Codes (blue) -----
function chest(Z, x, z, body, trimC, title, sub, act, faceYaw) {
    const grp = new T.Group(); grp.position.set(x, 0, z); grp.rotation.y = faceYaw; zoneGroup(Z).add(grp);
    const add = (geo, m, px, py, pz, rx) => { const o = new T.Mesh(geo, m); o.position.set(px, py, pz); if (rx) o.rotation.x = rx; o.castShadow = true; grp.add(o); return o; };
    const bodyM = gloss(body, { rough: 0.3, clear: true }), trimM = new T.MeshStandardMaterial({ color: trimC, roughness: 0.25, metalness: 0.7 });
    add(new RoundedBoxGeometry(8, 4.6, 5.4, 2, 0.5), bodyM, 0, 2.3, 0);
    add(new RoundedBoxGeometry(8.2, 2.4, 5.6, 2, 0.6), bodyM, 0, 5.4, -0.3, -0.18);
    for (const sx of [-2.8, 0, 2.8]) add(new T.BoxGeometry(0.6, 4.8, 5.6), trimM, sx, 2.4, 0);
    add(new RoundedBoxGeometry(1.4, 1.6, 0.5, 2, 0.2), trimM, 0, 3.6, 2.8);
    const glow = new T.Mesh(new T.SphereGeometry(0.9, 12, 10), glowMat(trimC, 1.4)); glow.position.set(0, 5.6, 1.6); grp.add(glow);
    const ringM = new T.Mesh(new T.RingGeometry(5.5, 6.3, 40), glowMat(trimC, 1.2)); ringM.rotation.x = -Math.PI / 2; ringM.position.y = 0.06; grp.add(ringM);
    billboard([{ t: title, c: css(lighten(body, 0.4)), s: '#141a2e', px: 70 }, { t: sub, c: '#ffffff', s: '#141a2e', px: 44 }], 13, 512, new V3(x, 11, z), zoneGroup(Z));
    solids.push(Object.assign(aabb(x, 3, z, 7, 6, 7), { zone: Z }));
    const tr = aabb(x, 3, z, 15, 6, 15); tr.enter = act; tr.zone = Z; triggers.push(tr);
    tickers.push((dt, t) => { glow.position.y = 5.6 + Math.sin(t * 3) * 0.3; });
}
function buildChests(Z) {
    chest(Z, 26, 2, 0xffb81c, 0xff5ab8, 'Free Reward', 'Drive in!', () => actions.chest(), -Math.PI / 2);
    chest(Z, -26, 2, 0x2a8cff, 0xffd028, 'Codes', 'Free Stuff!', () => actions.openCodes(), Math.PI / 2);
}

// ----- Turbo Rush countdown board and the "Next Update ???" sign by the lane -----
function buildEventBoard(Z) {
    const pos = new V3(-22, 0, 52), face = new V3(0.5, 0, -1).normalize();
    const grp = new T.Group(); grp.position.copy(pos); grp.rotation.y = Math.atan2(face.x, face.z); zoneGroup(Z).add(grp);
    for (const sx of [-6, 6]) { const post = new T.Mesh(new RoundedBoxGeometry(1.2, 9, 1.2, 2, 0.3), gloss(0x22283a, { rough: 0.5 })); post.position.set(sx, 4.5, 0); grp.add(post); }
    const board = new T.Mesh(new RoundedBoxGeometry(18, 10, 1, 2, 0.4), gloss(0x101626, { rough: 0.4 }));
    board.position.set(0, 13, 0); board.castShadow = true; grp.add(board);
    const c = document.createElement('canvas'); c.width = 768; c.height = 420;
    const tex = texFrom(c);
    const scr = new T.Mesh(new T.PlaneGeometry(17, 9.3), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, 13, 0.52); grp.add(scr);
    signs.event = { cv: c, tex, last: '' };
    solids.push(Object.assign(aabb(pos.x, 8, pos.z, 16, 16, 4), { zone: Z }));
    // "Next Update" sign
    const p2 = new V3(22, 0, 52), f2 = new V3(-0.5, 0, -1).normalize();
    const g2 = new T.Group(); g2.position.copy(p2); g2.rotation.y = Math.atan2(f2.x, f2.z); zoneGroup(Z).add(g2);
    const post = new T.Mesh(new RoundedBoxGeometry(1.2, 9, 1.2, 2, 0.3), gloss(0x22283a, { rough: 0.5 })); post.position.set(0, 4.5, 0); g2.add(post);
    const b2 = new T.Mesh(new RoundedBoxGeometry(12, 7, 0.8, 2, 0.3), gloss(0x101626, { rough: 0.4 })); b2.position.set(0, 11.5, 0); g2.add(b2);
    const t2 = textPlane([{ t: 'NEXT UPDATE', c: '#ffd028', s: '#141a2e', px: 70 }, { t: '???', c: '#ffffff', s: '#141a2e', px: 130 }], 10.5, 512, new V3(0, 11.5, 0.45), new V3(0, 11.5, 10), g2);
    void t2;
    solids.push(Object.assign(aabb(p2.x, 8, p2.z, 6, 16, 4), { zone: Z }));
}
function drawEventBoard() {
    const e = signs.event;
    if (!e) return;
    const ev = eventState(net.now());
    const key = ev.on + '|' + Math.floor(ev.left);
    if (key === e.last) return;
    e.last = key;
    const x = e.cv.getContext('2d'), W = e.cv.width, H = e.cv.height;
    x.fillStyle = '#0c1222'; x.fillRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    const line = (t, y, px, col, stroke) => { x.font = `700 ${px}px Fredoka, sans-serif`; if (stroke) { x.lineWidth = px * 0.2; x.strokeStyle = '#000'; x.strokeText(t, W / 2, y); } x.fillStyle = col; x.fillText(t, W / 2, y); };
    if (ev.on) {
        line('🏁 TURBO RUSH! 🏁', 80, 72, '#ff8a2a', true);
        line('x2 SPEED & x2 WINS', 190, 64, '#7dff6b', true);
        line('Ends in ' + clock(ev.left), 300, 56, '#ffffff');
    } else {
        line('TURBO RUSH IN:', 70, 60, '#ffffff', true);
        const h = Math.floor(ev.left / 3600), m = Math.floor((ev.left % 3600) / 60), s = Math.floor(ev.left % 60);
        line((h ? h + 'h ' : '') + m + 'm ' + String(s).padStart(2, '0') + 's', 175, 80, '#ffd028', true);
        line('x2 SPEED & WINS FOR EVERYONE', 300, 38, '#ff8a2a');
    }
    e.tex.needsUpdate = true;
}

// ----- GO-KARTS showroom (west, -x): two rows of red pads, each with its kart turning slowly -----
const PAD_SIZE = 12;
let blobMat = null;
const BLOB_MAT = () => blobMat || (blobMat = new T.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, toneMapped: false, color: 0x000000, opacity: 0.45 }));
function blobTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
}
export const showroomPads = [];
function kartLines(d) {
    const owned = d.id === 'wooden' || !!S.karts[d.id];
    let sub;
    if (S.kart === d.id) sub = { t: 'EQUIPPED', c: '#6fe0ff' };
    else if (owned) sub = { t: 'OWNED · drive in', c: '#7dff6b' };
    else if (S.rebirths < d.reb) sub = { t: '🔒 ' + d.reb + ' REBIRTH' + (d.reb > 1 ? 'S' : ''), c: '#ff5a5a' };
    else sub = { t: '🏆 ' + fmt(d.cost) + ' Wins', c: S.wins >= d.cost ? '#7dff6b' : '#ffd028' };
    return [
        { t: d.name, c: css(lighten(d.body, 0.35)), s: '#141a2e', px: 44 },
        { t: 'x' + d.mult + ' ⚡ Speed', c: '#5ad8ff', s: '#141a2e', px: 58 },
        { ...sub, s: '#141a2e', px: 46 },
    ];
}
function buildShowroom(Z) {
    const rows = [{ x: -40, y: 0 }, { x: -68, y: 1.6 }];
    // Raised back row
    studBox(Z, 18, 1.6, 150, -68, 0.8, -26, 0x9aa0b4, { extra: {} });
    plainBox(Z, 18.2, 0.4, 150.2, -68, 1.62, -26, gloss(0x2a3352, { rough: 0.5 }));
    SHOWROOM.forEach((d, i) => {
        const r = rows[i < 8 ? 0 : 1], k = i % 8;
        const x = r.x, z = -92 + k * 17, top = r.y;
        roundBox(Z, PAD_SIZE, 0.5, PAD_SIZE, x, top + 0.25, z, gloss(0xe8283a, { rough: 0.4 }), 0.3);
        glowBox(Z, PAD_SIZE + 0.3, 0.12, PAD_SIZE + 0.3, x, top + 0.04, z, 0xff4a5a, 1.3);
        const kart = buildKart(d, { static: true });
        kart.position.set(x, top + 0.5, z);
        kart.rotation.y = Math.PI / 2 + 0.6;
        // Display karts don't cast real shadows (16 of them would double the lobby's draw calls): a soft blob instead
        kart.traverse((o) => { o.castShadow = false; });
        plainBox(Z, 7.5, 0.02, 7.5, x, top + 0.52, z, BLOB_MAT());
        zoneGroup(Z).add(kart);
        const at = new V3(x, top + 1, z);
        tickers.push((dt) => { if (zoneGroup(Z).visible && camera.position.distanceToSquared(at) < 160 * 160) kart.rotation.y += dt * 0.5; });
        const sp = billboard(kartLines(d), 11, 512, new V3(x, top + 8.5, z), zoneGroup(Z));
        shopItems.push({ kind: 'kart', def: d, sp, sig: '' });
        const tr = aabb(x, top + 2, z, PAD_SIZE - 2, 4, PAD_SIZE - 2); tr.zone = Z;
        tr.enter = () => actions.kartPad(d);
        triggers.push(tr);
        showroomPads.push({ def: d, x, z, top });
    });
    banner(Z, 'GO-KARTS', ['#ffffff', '#ffb0b8'], 40, new V3(-LX + 0.4, 30, -26), new V3(1, 0, 0), 'More karts = more Speed!');
}

// ----- SUPER CARS (south, behind the spawn): a dark glossy hall with six turntables -----
export const superPads = [];
function buildSuperShowroom(Z) {
    const x0 = -22, x1 = 22, z0 = LZ0, z1 = -56;
    roundBox(Z, x1 - x0, 0.3, z1 - z0, 0, 0.15, (z0 + z1) / 2, gloss(0x14161e, { rough: 0.15, clear: true }), 0.15, { solid: true });
    for (const x of [x0, x1]) glowBox(Z, 0.4, 0.1, z1 - z0, x, 0.32, (z0 + z1) / 2, 0x5ad8ff, 1.4);
    glowBox(Z, x1 - x0, 0.1, 0.4, 0, 0.32, z1, 0x5ad8ff, 1.4);
    banner(Z, '⭐ SUPER CARS ⭐', ['#ffffff', '#9ae4ff'], 40, new V3(0, 30, LZ0 + 0.4), new V3(0, 0, 1), 'Modern supercars - huge Speed boosts!');
    // light poles at the corners
    for (const x of [x0 + 1, x1 - 1]) for (const z of [z0 + 4, z1 - 2]) {
        cyl(Z, 0.3, 0.4, 16, x, 8, z, gloss(0x22283a, { rough: 0.4 }), 10);
        plainBox(Z, 2.4, 0.6, 1.2, x, 16.2, z, mat(0xeaf4ff, { neon: true, boost: 1.4 }));
    }
    SUPERCARS.forEach((d, i) => {
        const x = [-13, 0, 13][i % 3], z = i < 3 ? -72 : -102;
        const top = 0.3;
        cyl(Z, 5.6, 5.8, 0.4, x, top + 0.2, z, gloss(0x22242e, { rough: 0.2, clear: true }), 40);
        const ringM = new T.Mesh(new T.TorusGeometry(5.7, 0.16, 8, 48), d.prism ? new T.MeshBasicMaterial({ color: 0xffffff }) : glowMat(d.glow || d.accent, 1.6));
        ringM.rotation.x = Math.PI / 2; ringM.position.set(x, top + 0.42, z); zoneGroup(Z).add(ringM);
        const car = buildKart(d, { static: true });
        car.position.set(x, top + 0.4, z);
        car.rotation.y = Math.PI + 0.5;
        car.traverse((o) => { o.castShadow = false; });
        zoneGroup(Z).add(car);
        // a soft light cone from above
        const bm = new T.MeshBasicMaterial({ color: d.glow || 0xffffff, transparent: true, opacity: 0.05, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false });
        const beam = new T.Mesh(new T.CylinderGeometry(1.2, 5, 22, 24, 1, true), bm);
        beam.position.set(x, top + 11, z); zoneGroup(Z).add(beam);
        const at = new V3(x, 1, z);
        tickers.push((dt, t) => { if (zoneGroup(Z).visible && camera.position.distanceToSquared(at) < 170 * 170) { car.rotation.y += dt * 0.45; if (d.prism) ringM.material.color.setHSL((t * 0.15) % 1, 0.9, 0.6).multiplyScalar(2.2); } });
        const sp = billboard(kartLines(d), 12, 512, new V3(x, top + 9.5, z), zoneGroup(Z));
        shopItems.push({ kind: 'kart', def: d, sp, sig: '' });
        const tr = aabb(x, top + 2, z, 9, 4, 9); tr.zone = Z;
        tr.enter = () => actions.kartPad(d);
        triggers.push(tr);
        superPads.push({ def: d, x, z, top });
    });
}
// ----- SPEED ROLLERS (east, +x): dyno bays with rollers; drive on and keep the throttle down -----
export let rollerTex;
function treadLines(def) {
    const owned = treadOwned(def);
    const lines = [{ t: (def.label ? def.label + ' ' : '') + 'x' + def.mult + ' Speed', c: css(lighten(def.color, 0.2)), s: '#141a2e', px: 60 }];
    if (def.tag) lines.push({ t: def.tag, c: '#ffffff', s: '#141a2e', px: 38 });
    if (owned) lines.push({ t: '✓ OWNED', c: '#7dff6b', s: '#141a2e', px: 44 });
    else if (def.daily) lines.push({ t: '📅 Daily Reward Day 7', c: '#ffd028', s: '#141a2e', px: 40 });
    else lines.push({ t: '🏆 ' + fmt(def.cost) + ' Wins', c: S.wins >= def.cost ? '#7dff6b' : '#ffd028', s: '#141a2e', px: 48 });
    return lines;
}
function buildRollers(Z) {
    const g = TREAD_GEO;
    rollerTex = rollerTexture().clone(); rollerTex.needsUpdate = true; rollerTex.repeat.set(1, 4);
    scrolling.push({ tex: rollerTex, u: 0, v: -2.4 });
    const x0 = g.x0 - 6, x1 = g.x0 + (TREADMILLS.length - 1) * g.step + 6;
    roundBox(Z, x1 - x0, 0.6, g.len + 10, (x0 + x1) / 2, 0.3, g.z, gloss(0x22283a, { rough: 0.45 }), 0.3, { solid: true });
    banner(Z, 'SPEED ROLLERS', ['#ffffff', '#ffd8a0'], 44, new V3((x0 + x1) / 2, 30, LZ0 + 0.4), new V3(0, 0, 1), 'Drive on & get Speed automatically!');
    TREADMILLS.forEach((def, i) => {
        const cx = g.x0 + i * g.step, cz = g.z, top = g.top;
        const belt = new T.Mesh(new T.BoxGeometry(g.width, 0.3, g.len), new T.MeshStandardMaterial({ map: rollerTex, roughness: 0.6 }));
        belt.position.set(cx, top + 0.15, cz); belt.receiveShadow = true; zoneGroup(Z).add(belt);
        solid(Z, cx, top + 0.15, cz, g.width, 0.3, g.len, { tread: def });
        for (const s of [-1, 1]) {
            glowBox(Z, 0.35, 0.5, g.len, cx + s * (g.width / 2 + 0.25), top + 0.3, cz, def.color, 1.5);
            roundBox(Z, 1.2, 2.6, g.len + 2, cx + s * (g.width / 2 + 1.0), top + 1.3, cz, gloss(0x14182a, { rough: 0.4 }), 0.3, { solid: true });
        }
        // Console at the front with the multiplier on its screen
        roundBox(Z, g.width + 3.4, 5, 1.2, cx, top + 2.5, cz + g.len / 2 + 1.2, gloss(0x1a1e2e, { rough: 0.35 }), 0.3, { solid: true });
        const scr = textPlane([{ t: 'x' + def.mult, c: css(lighten(def.color, 0.3)), s: '#141a2e', px: 150 }], 5, 256, new V3(cx, top + 3.4, cz + g.len / 2 + 0.55), new V3(cx, top + 3.4, cz - 10), zoneGroup(Z));
        scr.renderOrder = 2;
        const sp = billboard(treadLines(def), 8, 512, new V3(cx, top + 10.5, cz + 3), zoneGroup(Z));
        shopItems.push({ kind: 'tread', def, sp, sig: '' });
        const at = new V3(cx, top + 0.4, cz);
        let acc = Math.random();
        tickers.push((dt) => {
            if (!zoneGroup(Z).visible || camera.position.distanceToSquared(at) > 120 * 120) return;
            acc += dt * (treadOwned(def) ? 6 : 1.5);
            while (acc > 1) { acc -= 1; emitTread(at, def.mult, g.width * 0.8, g.len * 0.9, def.color); }
        });
        const tr = aabb(cx, top + 2, cz, g.width, 3, g.len); tr.zone = Z;
        tr.enter = () => { if (!treadOwned(def)) actions.treadBuy(def); };
        triggers.push(tr);
    });
}
// ----- TRAILS: pads by the rollers, drive onto one to equip it -----
function trailLines(def) {
    const ok = def.daily ? !!S.trails[def.id] : S.rebirths >= def.reb;
    const head = def.reb ? def.reb + ' Rebirth' + (def.reb > 1 ? 's' : '') : def.daily ? def.name : 'Starter';
    const lines = [{ t: head, c: css(lighten(def.color, 0.15)), s: '#141a2e', px: 56 }, { t: 'x' + def.mult + ' Speed', c: '#ffffff', s: '#141a2e', px: 50 }];
    lines.push(S.trail === def.id ? { t: 'EQUIPPED', c: '#6fe0ff', s: '#141a2e', px: 40 } : ok ? { t: 'Drive in to equip', c: '#7dff6b', s: '#141a2e', px: 36 } : { t: '🔒', c: '#ffd028', s: '#141a2e', px: 40 });
    return lines;
}
function buildTrails(Z) {
    TRAILS.forEach((def, i) => {
        const x = 32 + i * 10, z = -50, top = 0;
        roundBox(Z, 8, 0.4, 8, x, top + 0.2, z, gloss(0x14182a, { rough: 0.4 }), 0.25);
        const ringM = new T.Mesh(new T.TorusGeometry(3.2, 0.2, 8, 36), glowMat(def.rainbow ? 0xffffff : def.color, 1.6));
        ringM.rotation.x = Math.PI / 2; ringM.position.set(x, top + 0.5, z); zoneGroup(Z).add(ringM);
        if (def.rainbow) tickers.push((dt, t) => { ringM.material.color.setHSL((t * 0.25) % 1, 1, 0.6).multiplyScalar(1.6); });
        const sp = billboard(trailLines(def), 7.5, 512, new V3(x, top + 7, z), zoneGroup(Z));
        shopItems.push({ kind: 'trail', def, sp, sig: '' });
        const tr = aabb(x, top + 2, z, 7, 4, 7); tr.zone = Z;
        tr.enter = () => actions.trail(def);
        triggers.push(tr);
    });
    banner(Z, 'TRAILS', ['#ffffff', '#c8f0ff'], 18, new V3(62, 14, -56), new V3(0, 0, 1), 'Rebirth to unlock!');
}
// ----- GARAGE (north-east): three bays, ENGINE / NITRO / GRIP, opening the Garage panel -----
function buildGarage(Z) {
    const x0 = 38, x1 = LX, z0 = 24, z1 = LZ1;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, H = 22;
    // Back and side walls, roof with an orange fascia
    studBox(Z, x1 - x0, H, 2, cx, H / 2, z1 - 1, 0x2a3352);
    studBox(Z, 2, H, z1 - z0, x0, H / 2, cz, 0x2a3352);
    studBox(Z, x1 - x0 + 2, 2, z1 - z0 + 2, cx, H + 1, cz, 0x2a3352, { solid: false });
    roundBox(Z, x1 - x0 + 2, 3, 2, cx, H - 1, z0, gloss(0xff8a2a, { rough: 0.35 }), 0.4);
    banner(Z, '🔧 GARAGE 🔧', ['#ffffff', '#ffd8a0'], 34, new V3(cx, H + 6, z0 - 0.6), new V3(0, 0, -1), 'Upgrade your kart with Wins!');
    const bays = [['engine', '⚙️ ENGINE', 0xff8a2a], ['nitro', '🔥 NITRO', 0x3ad8ff], ['grip', '🛞 GRIP', 0x7aff3a]];
    const bw = (x1 - x0 - 6) / 3;
    bays.forEach(([key, label, color], i) => {
        const bx = x0 + 3 + bw * (i + 0.5);
        if (i) studBox(Z, 1.2, H - 2, z1 - z0 - 6, x0 + 3 + bw * i, (H - 2) / 2, cz + 3, 0x22283a);
        plainBox(Z, bw - 2, 0.06, z1 - z0 - 8, bx, 0.04, cz + 2, gloss(0x3a4058, { rough: 0.7 }));
        glowBox(Z, bw - 2, 0.08, 0.5, bx, 0.06, z0 + 1, color, 1.4);
        // Hydraulic lift and a tool wall
        roundBox(Z, 9, 0.6, 12, bx, 0.3, cz + 6, gloss(0xffc414, { rough: 0.4 }), 0.2);
        roundBox(Z, bw - 4, 8, 0.8, bx, 6, z1 - 2.4, gloss(0xc8ccd8, { rough: 0.5 }), 0.2);
        for (let t = 0; t < 5; t++) plainBox(Z, 0.4, 2.2, 0.4, bx - (bw - 8) / 2 + t * (bw - 8) / 4, 6.5, z1 - 2.9, chrome(), { rz: 0.4 });
        textPlane([{ t: label, c: css(lighten(color, 0.3)), s: '#141a2e', px: 90 }], bw - 3, 1024, new V3(bx, 15.5, z0 + 0.4), new V3(bx, 15.5, z0 - 10), zoneGroup(Z));
        const sp = billboard([{ t: label, c: '#ffffff', s: '#141a2e', px: 60 }, { t: 'Drive in to upgrade', c: '#ffd028', s: '#141a2e', px: 40 }], 10, 512, new V3(bx, 9, cz), zoneGroup(Z));
        void sp;
        const tr = aabb(bx, 2, cz, bw - 3, 4, z1 - z0 - 8); tr.zone = Z;
        tr.enter = () => actions.openGarage(key);
        triggers.push(tr);
    });
}

// Labels on the kart pads, rollers and trails, redrawn only when what they show changes
export function refreshShop() {
    for (const it of shopItems) {
        let sig;
        if (it.kind === 'kart') sig = S.kart + (S.karts[it.def.id] ? 1 : 0) + (S.wins >= it.def.cost ? 'w' : '') + '|' + Math.min(S.rebirths, it.def.reb);
        else if (it.kind === 'tread') sig = (treadOwned(it.def) ? 'o' : '') + (S.wins >= it.def.cost ? 'w' : '');
        else sig = S.trail + '|' + S.rebirths + '|' + (S.trails[it.def.id] ? 1 : 0);
        if (sig === it.sig) continue;
        it.sig = sig;
        it.sp.userData.set(it.kind === 'kart' ? kartLines(it.def) : it.kind === 'tread' ? treadLines(it.def) : trailLines(it.def));
    }
    refreshSpeedSigns();
}
export function updateLobbySigns() { drawEventBoard(); }

// =====================================================================================
// Hazards. Everything moves on the server clock, so every player sees the same thing.
// =====================================================================================
const hazards = [];   // { zone, update(t, dt) }
function hz(zone, update) { hazards.push({ zone, update }); }
function killBox(zone, cause) {
    const k = { min: new V3(), max: new V3(), active: false, cause, zone };
    kills.push(k);
    return k;
}
function killTest(zone, cause, test) {
    const k = { test, active: true, cause, zone };
    kills.push(k);
    return k;
}
const cyc = (t, period, phase) => ((((t + (phase || 0)) % period) + period) % period) / period;
const KH = 2.4, KTOP = 4.2;   // kart half-size and the height of kart + driver for hit tests
const hitBox = (p, x0, y0, z0, x1, y1, z1) => p.x + KH > x0 && p.x - KH < x1 && p.z + KH > z0 && p.z - KH < z1 && p.y + KTOP > y0 && p.y < y1;

// ----- road pieces -----
function road(c, z0, z1, x0, x1, o) {
    if (z1 - z0 < 0.05) return null;
    o = o || {};
    x0 = x0 ?? -HW; x1 = x1 ?? HW;
    const th = c.th, cx = (x0 + x1) / 2, w = x1 - x0, cz = (z0 + z1) / 2, d = z1 - z0;
    if (th.checker && !o.plain) {
        // Big checker tiles in two colours, one solid underneath
        const tile = 10;
        for (let z = z0; z < z1 - 0.01; z += tile) for (let x = x0; x < x1 - 0.01; x += tile) {
            const tz = Math.min(tile, z1 - z), tx = Math.min(tile, x1 - x);
            const k = (Math.floor((x - x0) / tile) + Math.floor((z - c.s.zS) / tile)) % 2;
            studBox(c.Z, tx, 2, tz, x + tx / 2, -1, z + tz / 2, k ? th.floor2 : th.floor, { solid: false });
        }
        if (!o.bare) trackLines(c, z0, z1, x0, x1);
        return solid(c.Z, cx, -1, cz, w, 2, d, o.extra);
    }
    if (th.rainbow && !o.plain) {
        const cols = [0xff6a8a, 0xffb84a, 0xffe85a, 0x6aff8a, 0x5ac8ff, 0xb88aff];
        const lane = w / 6;
        for (let k = 0; k < 6; k++) studBox(c.Z, lane, 2, d, x0 + lane * (k + 0.5), -1, cz, lighten(cols[k], 0.25), { solid: false });
        if (!o.bare) trackLines(c, z0, z1, x0, x1);
        return solid(c.Z, cx, -1, cz, w, 2, d, o.extra);
    }
    const top = studBox(c.Z, w, 2, d, cx, -1, cz, o.color ?? th.floor, { extra: o.extra, emissive: o.emissive });
    if (!o.bare) trackLines(c, z0, z1, x0, x1);
    return top;
}
// Race-track paint: red & white curbs along the edges, a dashed centre line on wide roads
let curbMat = null;
function trackLines(c, z0, z1, x0, x1) {
    const d = z1 - z0;
    if (d < 4) return;
    curbMat = curbMat || new T.MeshStandardMaterial({ map: checkerTexture(0xe8283a, 0xffffff, 2), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const x of [x0 + 1.2, x1 - 1.2]) plainBox(c.Z, 2.4, 0.06, d, x, 0.03, (z0 + z1) / 2, curbMat, { uvScale: [1, d / 4] });
    if (x1 - x0 > 40) for (let z = Math.ceil(z0 / 16) * 16; z < z1 - 6; z += 16) plainBox(c.Z, 0.7, 0.04, 7, (x0 + x1) / 2, 0.03, z + 3.5, gloss(0xffffff, { rough: 0.6 }));
}
// A ramp wedge rising along +z from z0 to z0 + RAMP.len, full width by default
const rampGeoCache = new Map();
function rampMesh(w, len, h) {
    const key = w + '|' + len + '|' + h;
    if (rampGeoCache.has(key)) return rampGeoCache.get(key);
    // Triangular prism: slope on top, vertical back face at z = len (counter-clockwise from outside)
    const g = new T.BufferGeometry();
    const hw = w / 2;
    const A = [-hw, 0, 0], B = [hw, 0, 0], C = [hw, h, len], D = [-hw, h, len], E = [-hw, 0, len], F = [hw, 0, len];
    const sl = Math.hypot(len, h), us = w / 8, vs = sl / 6;
    const tris = [
        [A, C, B, [0, 0], [us, vs], [us, 0]], [A, D, C, [0, 0], [0, vs], [us, vs]],          // slope
        [E, F, C, [0, 0], [us, 0], [us, 0.4]], [E, C, D, [0, 0], [us, 0.4], [0, 0.4]],       // back
        [A, E, D, [0, 0], [1, 0], [1, 0.4]], [B, C, F, [0, 0], [1, 0.4], [1, 0]],            // sides
    ];
    const v = [], uv = [];
    for (const [p, q, r, a, b, c] of tris) { v.push(...p, ...q, ...r); uv.push(...a, ...b, ...c); }
    g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    rampGeoCache.set(key, g);
    return g;
}
let rampMat = null;
const RAMP_MAT = () => rampMat || (rampMat = new T.MeshStandardMaterial({ map: chevronTexture(0xffd028, 0x141a2e), roughness: 0.45 }));
function ramp(c, z0, x0, x1, need) {
    x0 = x0 ?? -HW; x1 = x1 ?? HW;
    const w = x1 - x0, cx = (x0 + x1) / 2;
    const m = new T.Mesh(rampMesh(w, RAMP.len, RAMP.h), RAMP_MAT());
    m.position.set(cx, 0, z0); m.castShadow = true; m.receiveShadow = true;
    zoneGroup(c.Z).add(m);
    // Glowing lip
    glowBox(c.Z, w, 0.25, 0.3, cx, RAMP.h + 0.05, z0 + RAMP.len - 0.15, c.th.accent, 1.6);
    return solid(c.Z, cx, RAMP.h / 2, z0 + RAMP.len / 2, w, RAMP.h, RAMP.len, { ramp: { z0, z1: z0 + RAMP.len, h: RAMP.h, need: need || 0 } });
}
// The pit under a gap: walls down into the abyss, glowing edges, a dark floor far below
function pit(c, z0, z1, x0, x1, o) {
    x0 = x0 ?? -HW; x1 = x1 ?? HW;
    const w = x1 - x0, cx = (x0 + x1) / 2;
    if (w < 0.5 || z1 - z0 < 0.5) return;
    plainBox(c.Z, w, 0.3, z1 - z0, cx, PIT, (z0 + z1) / 2, mat(shade(c.th.accent, 0.35), { neon: true, boost: 0.6 }));
    if (o && o.edges === false) return;
    for (const z of [z0, z1]) {
        studBox(c.Z, w, -PIT - 2, 1, cx, (PIT - 2) / 2, z + (z === z0 ? -0.5 : 0.5), shade(c.th.wall, 0.6), { solid: false });
        glowBox(c.Z, w, 0.18, 0.4, cx, 0.06, z + (z === z0 ? -0.2 : 0.2), 0xff3a3a, 1.4);
    }
}
// Boost pad on the road: scrolling arrows, a trigger that kicks you forward
const boostPads = [];
function boostPad(c, x, z, w, d) {
    const tex = boostTexture().clone(); tex.needsUpdate = true; tex.repeat.set(w / 6, d / 6);
    const m = new T.Mesh(new T.PlaneGeometry(w, d), new T.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, opacity: 0.95 }));
    m.material.color.multiplyScalar(1.3);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.06, z); zoneGroup(c.Z).add(m);
    scrolling.push({ tex, u: 0, v: 1.6 });
    const tr = aabb(x, 1.5, z, w, 3, d); tr.zone = c.Z; tr.enter = () => actions.boostPad();
    triggers.push(tr);
    boostPads.push(tr);
}

// ----- static barriers (bumping one stops you; it doesn't crash you) -----
let barrierMat = null;
const BARRIER_MAT = () => barrierMat || (barrierMat = new T.MeshStandardMaterial({ map: stripeTexture(0x2a7cff, 0xffffff, 2), roughness: 0.45 }));
function barrier(c, x0, x1, z, h, kind) {
    const w = x1 - x0;
    if (w < 0.5) return;
    if (kind === 'blocks') {
        const n = Math.max(1, Math.round(w / 4));
        for (let i = 0; i < n; i++) roundBox(c.Z, w / n - 0.2, h || 2.6, 2.2, x0 + (i + 0.5) * w / n, (h || 2.6) / 2, z, gloss(i % 2 ? 0xffffff : 0x2a7cff, { rough: 0.35 }), 0.3, { cast: true });
        solid(c.Z, (x0 + x1) / 2, (h || 2.6) / 2, z, w, h || 2.6, 2.2);
        return;
    }
    const m = BARRIER_MAT();
    plainBox(c.Z, w, h || 2.6, 2, (x0 + x1) / 2, (h || 2.6) / 2, z, m, { cast: true, solid: true, uvScale: [w / 6, 1] });
}

// ----- laser gates and hop lasers -----
const beamGeo = new T.PlaneGeometry(1, 1);
function laserBeam(Z, color, scaleY) {
    const grp = new T.Group();
    const m = new T.MeshBasicMaterial({ map: beamTexture(), color, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false });
    m.color.multiplyScalar(3);
    const a = new T.Mesh(beamGeo, m), b = new T.Mesh(beamGeo, m);
    b.rotation.x = Math.PI / 2;
    grp.add(a, b);
    const core = new T.Mesh(new T.CylinderGeometry(0.16, 0.16, 1, 6), glowMat(color, 2.4));
    core.rotation.z = Math.PI / 2;
    grp.add(core);
    grp.scale.y = scaleY || 1;
    zoneGroup(Z).add(grp);
    return grp;
}
// A gate of laser beams across the road, on for part of each cycle (flickering before it comes on)
function laserGate(c, z, period, onFrac, phase, x0, x1, color) {
    x0 = x0 ?? -HW; x1 = x1 ?? HW;
    const beams = [];
    for (let k = 0; k < 4; k++) {
        const b = laserBeam(c.Z, color || 0xff2a3a);
        b.scale.set(x1 - x0, 1.4, 1);
        b.position.set((x0 + x1) / 2, 0.8 + k * 1.8, z);
        beams.push(b);
    }
    for (const x of [x0, x1]) {
        roundBox(c.Z, 1.6, 9, 1.6, x + (x === x0 ? 0.6 : -0.6), 4.5, z, gloss(0x22283a, { rough: 0.3 }), 0.3);
        glowBox(c.Z, 1.7, 8.2, 0.4, x + (x === x0 ? 0.6 : -0.6), 4.5, z - 0.85, color || 0xff2a3a, 1.2);
    }
    glowBox(c.Z, x1 - x0, 0.06, 0.5, (x0 + x1) / 2, 0.05, z, color || 0xff2a3a, 0.9);
    const kb = killBox(c.Z, 'laser');
    kb.min.set(x0, 0, z - 0.5); kb.max.set(x1, 7.5, z + 0.5);
    hz(c.Z, (t) => {
        const cc = cyc(t, period, phase);
        const on = cc < onFrac, warn = !on && cc > 1 - 0.16;
        kb.active = on;
        for (const b of beams) { b.visible = on || (warn && Math.floor(t * 14) % 2 === 0); b.scale.y = on ? 0.9 : 0.25; }
    });
}
// A low laser across the road: always on, HOP over it (Space)
function hopLaser(c, z, x0, x1) {
    x0 = x0 ?? -HW; x1 = x1 ?? HW;
    const b = laserBeam(c.Z, 0xff2ad0);
    b.scale.set(x1 - x0, 0.7, 1); b.position.set((x0 + x1) / 2, 0.6, z);
    for (const x of [x0, x1]) roundBox(c.Z, 1.4, 1.8, 1.4, x + (x === x0 ? 0.5 : -0.5), 0.9, z, gloss(0xff2ad0, { rough: 0.3, emissive: 0xff2ad0, emissiveIntensity: 0.4 }), 0.3);
    textPlane([{ t: 'HOP! ⤴', c: '#ff8ae6', s: '#141a2e', px: 120 }], 10, 512, new V3((x0 + x1) / 2, 0.08, z - 10), new V3((x0 + x1) / 2, 50, z - 10), zoneGroup(c.Z)).rotation.x = -Math.PI / 2;
    const kb = killBox(c.Z, 'laser');
    kb.min.set(x0, 0.3, z - 0.35); kb.max.set(x1, 0.9, z + 0.35); kb.active = true;
    hz(c.Z, (t) => { b.children[0].material.opacity = 0.8 + Math.sin(t * 20) * 0.2; });
}
// A laser fence with a gap that slides left and right
function slidingGap(c, z, gapW, period, phase) {
    const L = laserBeam(c.Z, 0xffd028), R = laserBeam(c.Z, 0xffd028);
    const L2 = laserBeam(c.Z, 0xffd028), R2 = laserBeam(c.Z, 0xffd028);
    const kl = killBox(c.Z, 'laser'), kr = killBox(c.Z, 'laser');
    kl.active = kr.active = true;
    for (const x of [-HW, HW]) roundBox(c.Z, 1.6, 6, 1.6, x + (x < 0 ? 0.6 : -0.6), 3, z, gloss(0x22283a, { rough: 0.3 }), 0.3);
    const amp = HW - gapW / 2 - 3;
    hz(c.Z, (t) => {
        const gx = Math.sin(2 * Math.PI * cyc(t, period, phase)) * amp;
        const a = gx - gapW / 2, b = gx + gapW / 2;
        for (const [bm, y] of [[L, 1.2], [L2, 3.2]]) { bm.scale.set(a + HW, 0.9, 1); bm.position.set((a - HW) / 2, y, z); }
        for (const [bm, y] of [[R, 1.2], [R2, 3.2]]) { bm.scale.set(HW - b, 0.9, 1); bm.position.set((b + HW) / 2, y, z); }
        kl.min.set(-HW, 0, z - 0.5); kl.max.set(a, 5, z + 0.5);
        kr.min.set(b, 0, z - 0.5); kr.max.set(HW, 5, z + 0.5);
    });
}

// ----- cops: blocky police officers walking across the road -----
function copModel() {
    const rig = buildRig({ shirt: 0x2a4aa8, shorts: 0x1a1e30, socks: 0x1a1e30, skin: 0xe1af87, hair: 0x3a2618 });
    // Cap with a badge, a belt
    const cap = new T.Mesh(UNIT_BOX, mat(0x1a2450)); cap.scale.set(1.4, 0.45, 1.4); cap.position.set(0, 5.4, 0); rig.userData.head.add(cap);
    const brim = new T.Mesh(UNIT_BOX, mat(0x1a1a24)); brim.scale.set(1.4, 0.12, 0.6); brim.position.set(0, 5.18, 0.8); rig.userData.head.add(brim);
    const badge = new T.Mesh(UNIT_BOX, chrome(0xffd028)); badge.scale.set(0.35, 0.35, 0.06); badge.position.set(0.5, 3.6, 0.52); rig.add(badge);
    rig.scale.setScalar(1.25);
    return mergeRig(rig);
}
const UNIT_BOX = new T.BoxGeometry(1, 1, 1);
function cops(c, list) {
    const models = list.map((p) => { const m = copModel(); zoneGroup(c.Z).add(m); return m; });
    killTest(c.Z, 'cop', (p) => {
        for (const m of models) {
            if (!m.visible) continue;
            if (Math.abs(p.x - m.position.x) < KH + 1.4 && Math.abs(p.z - m.position.z) < KH + 1.0 && p.y < 6.5) return true;
        }
        return false;
    });
    hz(c.Z, (t) => {
        list.forEach((p, i) => {
            const m = models[i];
            // Ping-pong across the road: walk, turn, walk back
            const k = cyc(t, p.period, p.phase), out = k < 0.5, f = out ? k * 2 : (1 - k) * 2;
            const e = f * f * (3 - 2 * f);
            const x = p.x0 + (p.x1 - p.x0) * e;
            m.position.set(x, 0, p.z);
            m.rotation.y = out ? Math.PI / 2 * Math.sign(p.x1 - p.x0) : -Math.PI / 2 * Math.sign(p.x1 - p.x0);
            const sw = Math.sin(t * 10 + i) * 0.7;
            const u = m.userData;
            u.legs[0].rotation.x = sw; u.legs[1].rotation.x = -sw;
            u.arms[0].rotation.x = -sw * 0.8; u.arms[1].rotation.set(-1.4, 0, 0.2);
        });
    });
}
// A parked police car (static obstacle) with flashing lights
function policeCar(c, x, z, ry) {
    const grp = new T.Group(); grp.position.set(x, 0, z); grp.rotation.y = ry || 0; zoneGroup(c.Z).add(grp);
    const add = (sx, sy, sz, px, py, pz, m) => { const o = new T.Mesh(UNIT_BOX, m); o.scale.set(sx, sy, sz); o.position.set(px, py, pz); o.castShadow = true; grp.add(o); return o; };
    add(5.2, 1.6, 10, 0, 1.6, 0, paint(0xffffff, { metal: 0.2 }));
    add(5.25, 0.9, 3.2, 0, 1.6, 0, paint(0x14141e, { metal: 0.2 }));
    add(4.6, 1.5, 5, 0, 3.1, -0.5, paint(0x14141e, { metal: 0.2 }));
    add(4.4, 1.2, 4.6, 0, 3.15, -0.5, mat(0x5a7ab8, { rough: 0.1 }));
    const red = add(1.6, 0.5, 0.8, -1, 4.1, -0.5, mat(0xff1a2a, { neon: true })), blue = add(1.6, 0.5, 0.8, 1, 4.1, -0.5, mat(0x1a5aff, { neon: true }));
    for (const sx of [-2.4, 2.4]) for (const sz of [-3.4, 3.4]) { const w = new T.Mesh(new T.CylinderGeometry(1, 1, 0.8, 16), mat(0x1c1c22)); w.rotation.z = Math.PI / 2; w.position.set(sx, 1, sz); grp.add(w); }
    red.userData.dyn = blue.userData.dyn = true;
    mergeChildren(grp);
    const s = Math.abs(Math.sin(ry || 0)) > 0.5;
    solids.push(Object.assign(aabb(x, 2, z, s ? 10 : 5.2, 4, s ? 5.2 : 10), { zone: c.Z }));
    hz(c.Z, (t) => { const k = Math.floor(t * 6) % 2; red.visible = !!k; blue.visible = !k; });
}

// ----- spinning bars at kart height around a post -----
function spinner(c, x, z, len, speed, phase, color, double) {
    const grp = new T.Group(); grp.position.set(x, 0, z); zoneGroup(c.Z).add(grp);
    const post = new T.Mesh(new T.CylinderGeometry(1.4, 1.7, 5, 16), gloss(0x22283a, { rough: 0.3 })); post.position.y = 2.5; post.castShadow = true; grp.add(post);
    const cap = new T.Mesh(new T.SphereGeometry(1.5, 16, 10), glowMat(color, 1.2)); cap.position.y = 5.2; grp.add(cap);
    const bars = new T.Group(); grp.add(bars);
    const arms = double ? 2 : 1;
    for (let a = 0; a < arms; a++) {
        const bar = new T.Mesh(new T.BoxGeometry(len, 1.2, 1.2), new T.MeshStandardMaterial({ map: stripeTexture(color, 0x141a2e, 3), roughness: 0.4 }));
        bar.material.map.repeat.set(len / 6, 1);
        bar.rotation.y = a * Math.PI / 2; bar.position.y = 1.6; bar.castShadow = true; bars.add(bar);
    }
    solids.push(Object.assign(aabb(x, 2.5, z, 3, 5, 3), { zone: c.Z }));
    let ang = 0;
    killTest(c.Z, 'spinner', (p) => {
        if (p.y > 2.4) return false;
        const dx = p.x - x, dz = p.z - z, r = Math.hypot(dx, dz);
        if (r > len / 2 + KH || r < 1.5) return false;
        for (let a = 0; a < arms; a++) {
            const ba = ang + a * Math.PI / 2, ux = Math.cos(ba), uz = -Math.sin(ba);
            if (Math.abs(dx * uz - dz * ux) < 0.6 + KH * 0.75) return true;
        }
        return false;
    });
    hz(c.Z, (t) => { ang = t * speed + phase; bars.rotation.y = ang; });
}
// ----- pendulum hammers swinging across the road -----
function hammer(c, z, period, phase, color) {
    const pivotY = WALL_H - 2, armL = pivotY - 4;
    const grp = new T.Group(); grp.position.set(0, pivotY, z); zoneGroup(c.Z).add(grp);
    studBox(c.Z, STAGE_W, 2.4, 3, 0, pivotY + 1, z, c.th.pillar, { solid: false });
    const arm = new T.Mesh(new T.BoxGeometry(0.9, armL, 0.9), chrome(0x9aa0b4)); arm.position.y = -armL / 2; arm.castShadow = true; grp.add(arm);
    const head = new T.Group(); head.position.y = -armL; grp.add(head);
    const hm = new T.Mesh(new RoundedBoxGeometry(11, 6, 6, 2, 0.8), gloss(color, { rough: 0.3, clear: true })); hm.castShadow = true; head.add(hm);
    for (const s of [-1, 1]) { const cap = new T.Mesh(new T.CylinderGeometry(3.2, 3.2, 1, 20), gloss(0x22283a, { rough: 0.35 })); cap.rotation.z = Math.PI / 2; cap.position.x = s * 5.8; head.add(cap); }
    const shadow = new T.Mesh(new T.CircleGeometry(5.5, 28), new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.07, z); zoneGroup(c.Z).add(shadow);
    const AMP = 1.0;
    const hp = new V3();
    killTest(c.Z, 'hammer', (p) => Math.abs(p.x - hp.x) < 5.5 + KH && Math.abs(p.z - z) < 3 + KH && p.y + KTOP > hp.y - 3 && p.y < hp.y + 3);
    hz(c.Z, (t) => {
        const a = Math.sin(2 * Math.PI * cyc(t, period, phase)) * AMP;
        grp.rotation.z = a;
        hp.set(Math.sin(a) * armL, pivotY - Math.cos(a) * armL, z);
        shadow.position.x = hp.x;
        shadow.material.opacity = 0.35 - Math.min(0.25, (hp.y - 3) * 0.02);
    });
}
// ----- giant tyres rolling at you down lanes -----
function rollingTires(c, lanes, z0, z1) {
    const items = [];
    for (const L of lanes) for (let k = 0; k < L.count; k++) {
        const r = L.r;
        const g = new T.Group(); zoneGroup(c.Z).add(g);
        const tyre = new T.Mesh(new T.TorusGeometry(r * 0.72, r * 0.36, 14, 28), gloss(0x1c1c22, { rough: 0.85 }));
        tyre.rotation.y = Math.PI / 2; tyre.castShadow = true; g.add(tyre);
        const rim = new T.Mesh(new T.CylinderGeometry(r * 0.5, r * 0.5, r * 0.5, 20), chrome(L.color)); rim.rotation.z = Math.PI / 2; g.add(rim);
        items.push({ L, k, r, g });
    }
    killTest(c.Z, 'tire', (p) => {
        for (const it of items) {
            if (!it.g.visible) continue;
            if (Math.abs(p.x - it.g.position.x) < it.r * 0.4 + KH && Math.abs(p.z - it.g.position.z) < it.r * 0.85 + KH && p.y < it.r * 1.6) return true;
        }
        return false;
    });
    hz(c.Z, (t) => {
        for (const it of items) {
            // they appear inside the section, so they never reach the checkpoint past its end
            const top = z1 - it.r * 0.85 - KH - 1, travel = (top - z0) / it.L.speed;
            const cc = cyc(t, it.L.every * it.L.count, it.L.phase + it.k * it.L.every);
            const tt = cc * it.L.every * it.L.count;
            it.g.visible = tt < travel;
            if (!it.g.visible) continue;
            const z = top - tt * it.L.speed;
            const hop = Math.abs(Math.sin(tt * 3 + it.k)) * (it.L.bounce || 0);
            it.g.position.set(it.L.x + Math.sin(tt * 1.6 + it.k) * (it.L.wobble || 0), it.r + hop, z);
            it.g.rotation.x = -tt * it.L.speed / it.r;
        }
    });
}
// ----- crushers slamming down onto the road -----
function crusher(c, x, z, w, d, period, phase) {
    const grp = new T.Group(); zoneGroup(c.Z).add(grp);
    const body = new T.Mesh(new RoundedBoxGeometry(w, 5, d, 2, 0.6), new T.MeshStandardMaterial({ map: stripeTexture(0xffc414, 0x22222a, 3), roughness: 0.4 }));
    body.material.map.repeat.set(w / 8, 1);
    body.castShadow = true; grp.add(body);
    const piston = new T.Mesh(new T.CylinderGeometry(1.2, 1.2, 40, 12), chrome(0x9aa0b4)); piston.position.y = 22; grp.add(piston);
    const warn = new T.Mesh(new T.PlaneGeometry(w, d), new T.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
    warn.rotation.x = -Math.PI / 2; warn.position.set(x, 0.08, z); zoneGroup(c.Z).add(warn);
    const k = killBox(c.Z, 'crusher');
    const UP = 16;
    hz(c.Z, (t) => {
        const cc = cyc(t, period, phase) * period;
        const slam = period * 0.55, hold = 0.45;
        let y;
        if (cc < slam - 0.6) y = UP;
        else if (cc < slam) y = UP + Math.sin(cc * 40) * 0.2;
        else if (cc < slam + 0.12) y = UP * (1 - (cc - slam) / 0.12);
        else if (cc < slam + 0.12 + hold) y = 0;
        else y = Math.min(UP, UP * (cc - slam - 0.12 - hold) / Math.max(0.2, period - slam - 0.12 - hold));
        grp.position.set(x, y + 2.5, z);
        warn.visible = cc >= slam - 0.9 && cc < slam + 0.12 + hold;
        warn.material.opacity = 0.3 + 0.3 * Math.sin(cc * 25);
        k.active = y < 4.5;
        k.min.set(x - w / 2 + 0.3, 0, z - d / 2 + 0.3); k.max.set(x + w / 2 - 0.3, y + 5, z + d / 2 - 0.3);
    });
}
// ----- traffic: cars crossing the road out of tunnels in the walls -----
function carModel(color) {
    const g = new T.Group();
    const add = (sx, sy, sz, px, py, pz, m) => { const o = new T.Mesh(UNIT_BOX, m); o.scale.set(sx, sy, sz); o.position.set(px, py, pz); o.castShadow = true; g.add(o); return o; };
    add(5, 1.8, 10, 0, 1.6, 0, paint(color, { metal: 0.35 }));
    add(4.4, 1.6, 5.2, 0, 3.2, -0.6, paint(color, { metal: 0.35 }));
    add(4.5, 1.3, 4.8, 0, 3.25, -0.6, mat(0x2a3a5a, { rough: 0.1 }));
    for (const sx of [-1.6, 1.6]) { add(1, 0.6, 0.2, sx, 1.9, 5.05, mat(0xfff4c8, { neon: true })); add(1, 0.5, 0.2, sx, 1.9, -5.05, mat(0xff2a2a, { neon: true })); }
    for (const sx of [-2.3, 2.3]) for (const sz of [-3.2, 3.2]) { const w = new T.Mesh(new T.CylinderGeometry(1, 1, 0.9, 14), mat(0x1c1c22)); w.rotation.z = Math.PI / 2; w.position.set(sx, 1, sz); g.add(w); }
    mergeChildren(g);
    return g;
}
const CAR_COLORS = [0xe8283a, 0x2a8cff, 0xffc414, 0x2ad87a, 0xffffff, 0x9a4aff, 0xff8a14, 0x14141e];
// A police cruiser for the chases: white with black doors, a flashing light bar and POLICE on the
// bonnet. userData.red / blue are the light bar halves (main.js flashes them).
export function makeCopCar() {
    const g = carModel(0xf4f4f8);
    const add = (sx, sy, sz, px, py, pz, m) => { const o = new T.Mesh(UNIT_BOX, m); o.scale.set(sx, sy, sz); o.position.set(px, py, pz); g.add(o); return o; };
    for (const sx of [-1, 1]) add(0.1, 1.0, 4.2, sx * 2.52, 1.7, 0.3, mat(0x14141e, { rough: 0.4 }));
    add(3.4, 0.35, 0.9, 0, 4.1, -0.6, mat(0x22222a, { rough: 0.4 }));
    const red = add(1.5, 0.45, 0.85, -0.85, 4.45, -0.6, mat(0xff1a2a, { neon: true, boost: 2 }));
    const blue = add(1.5, 0.45, 0.85, 0.85, 4.45, -0.6, mat(0x1a5aff, { neon: true, boost: 2 }));
    const txt = textPlane([{ t: 'POLICE', c: '#14141e', px: 120 }], 3.6, 512, new V3(0, 2.52, 3.2), new V3(0, 50, 3.2), g);
    txt.rotation.z = Math.PI;
    g.userData.red = red; g.userData.blue = blue;
    return g;
}
// Fills [x0, x1] across the road at z with police cars parked sideways, topped up with barriers
function roadblock(c, x0, x1, z) {
    let x = x0;
    while (x1 - x >= 10.6) { policeCar(c, x + 5.3, z, Math.PI / 2); x += 10.6; }
    if (x1 - x > 0.6) barrier(c, x, x1, z, 3.2, 'blocks');
}
// Police chase zones: main.js sets a cruiser on you when you drive into one
export const chases = [];
function crossTraffic(c, lanes) {
    const cars = lanes.map((L, i) => { const m = carModel(CAR_COLORS[(i * 3 + c.s.i) % CAR_COLORS.length]); zoneGroup(c.Z).add(m); return m; });
    lanes.forEach((L) => {
        // Tunnel mouths in both walls with warning lights
        for (const s of [-1, 1]) {
            studBox(c.Z, 1, 9, 14, s * (HW + 0.2), 4.5, L.z, 0x0a0a12, { solid: false });
            L['w' + s] = new T.Mesh(new T.SphereGeometry(0.8, 12, 8), mat(0xffa014, { neon: true }));
            L['w' + s].position.set(s * (HW - 0.6), 10.5, L.z); zoneGroup(c.Z).add(L['w' + s]);
        }
    });
    killTest(c.Z, 'car', (p) => {
        for (const m of cars) if (m.visible && Math.abs(p.x - m.position.x) < 5 + KH && Math.abs(p.z - m.position.z) < 2.6 + KH && p.y < 5) return true;
        return false;
    });
    hz(c.Z, (t) => {
        lanes.forEach((L, i) => {
            const m = cars[i];
            const cc = cyc(t, L.period, L.phase) * L.period;
            const cross = L.cross, dir = L.dir;
            const warnT = 0.8;
            m.visible = cc < cross;
            L.w1.visible = L['w-1'].visible = cc > L.period - warnT && Math.floor(t * 10) % 2 === 0;
            if (!m.visible) return;
            const k = cc / cross;
            const x = dir * (-HW - 8 + (STAGE_W + 16) * k);
            m.position.set(x, 0, L.z);
            m.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        });
    });
}
// Oncoming cars driving down lanes toward you
function oncoming(c, lanes, z0, z1) {
    const cars = [];
    for (const L of lanes) for (let k = 0; k < L.count; k++) { const m = carModel(CAR_COLORS[(cars.length * 5 + 2) % CAR_COLORS.length]); m.rotation.y = Math.PI; zoneGroup(c.Z).add(m); cars.push({ L, k, m }); }
    killTest(c.Z, 'car', (p) => {
        for (const it of cars) if (it.m.visible && Math.abs(p.x - it.m.position.x) < 2.5 + KH && Math.abs(p.z - it.m.position.z) < 5 + KH && p.y < 5) return true;
        return false;
    });
    const len = z1 - z0;
    hz(c.Z, (t) => {
        for (const it of cars) {
            const travel = len / it.L.speed;
            const tt = cyc(t, it.L.every * it.L.count, it.L.phase + it.k * it.L.every) * it.L.every * it.L.count;
            it.m.visible = tt < travel;
            if (it.m.visible) it.m.position.set(it.L.x, 0, z1 - tt * it.L.speed);
        }
    });
}
// ----- meteors falling onto lava bridges (red target first) -----
function meteors(c, spots, period) {
    const items = spots.map((s) => {
        const rock = new T.Mesh(new T.DodecahedronGeometry(3.2, 0), gloss(0x3a1a10, { rough: 0.8, emissive: 0xff5a14, emissiveIntensity: 0.5 }));
        rock.castShadow = true; zoneGroup(c.Z).add(rock);
        const warn = new T.Mesh(new T.RingGeometry(3.6, 5.2, 28), new T.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: T.DoubleSide }));
        warn.rotation.x = -Math.PI / 2; warn.position.set(s.x, 0.1, s.z); zoneGroup(c.Z).add(warn);
        return { ...s, rock, warn, k: killBox(c.Z, 'meteor') };
    });
    hz(c.Z, (t) => {
        for (const it of items) {
            const cc = cyc(t, period, it.phase) * period;
            let y = 80, vis = false;
            if (cc < 1.0) { /* warning */ } else if (cc < 1.4) { vis = true; y = 80 - 80 * ((cc - 1.0) / 0.4) ** 2 + 3; } else if (cc < 1.9) { vis = true; y = 3 - (cc - 1.4) * 10; }
            it.warn.visible = cc < 1.4;
            it.warn.scale.setScalar(cc < 1.0 ? 1.4 - 0.4 * cc : 1);
            it.rock.visible = vis; it.rock.position.set(it.x, y, it.z); it.rock.rotation.set(t * 3, t * 2, 0);
            it.k.active = vis && cc < 1.55;
            it.k.min.set(it.x - 4, y - 3.5, it.z - 4); it.k.max.set(it.x + 4, y + 3.5, it.z + 4);
        }
    });
}
// ----- mines: one instanced mesh for the bodies, one for the blinking lights -----
function mineField(c, list) {
    if (!list.length) return;
    const bodyGeo = new T.SphereGeometry(1.35, 18, 12), lightGeo = new T.SphereGeometry(0.42, 10, 8);
    const bodies = new T.InstancedMesh(bodyGeo, gloss(0x2a2e22, { rough: 0.35 }), list.length);
    const bandGeo = new T.TorusGeometry(1.38, 0.16, 8, 24); bandGeo.rotateX(Math.PI / 2);
    const bands = new T.InstancedMesh(bandGeo, mat(0xff2a1a, { neon: true, boost: 1.4 }), list.length);
    const lightM = new T.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
    const lights = new T.InstancedMesh(lightGeo, lightM, list.length);
    const m4 = new T.Matrix4();
    list.forEach((p, i) => {
        bodies.setMatrixAt(i, m4.makeTranslation(p.x, 1.2, p.z));
        bands.setMatrixAt(i, m4.makeTranslation(p.x, 1.2, p.z));
        lights.setMatrixAt(i, m4.makeTranslation(p.x, 2.6, p.z));
        floorRing(c, p.x, p.z, 2.6, 3.0, 0xff2a1a);
    });
    bodies.castShadow = true;
    zoneGroup(c.Z).add(bodies, bands, lights);
    // rows sorted by z: the hit test only looks at the mines near the kart
    const byZ = list.slice().sort((p, q) => p.z - q.z);
    killTest(c.Z, 'mine', (p) => {
        for (const m of byZ) {
            if (m.z < p.z - 4) continue;
            if (m.z > p.z + 4) break;
            if ((p.x - m.x) ** 2 + (p.z - m.z) ** 2 < 3.3 * 3.3 && p.y < 2.5) return true;
        }
        return false;
    });
    hz(c.Z, (t) => { lightM.color.setRGB(Math.floor(t * 3) % 2 ? 3 : 0.6, 0.15, 0.1); });
}
// ----- a steel wall across the road with a gap that slides side to side -----
const WALL_GEO = new T.BoxGeometry(1, 1, 1);
function movingWall(c, z, gapW, period, phase) {
    const wallM = gloss(0xe0302a, { rough: 0.4, metal: 0.2 }), edgeM = bandMat(0xff8a14, 0x14141e), stripeM = mat(0xffd028, { neon: true, boost: 0.6 });
    const L = new T.Mesh(WALL_GEO, wallM), R = new T.Mesh(WALL_GEO, wallM);
    const eL = new T.Mesh(WALL_GEO, edgeM), eR = new T.Mesh(WALL_GEO, edgeM);
    const sL = new T.Mesh(WALL_GEO, stripeM), sR = new T.Mesh(WALL_GEO, stripeM);
    for (const m of [L, R, eL, eR]) { m.castShadow = true; zoneGroup(c.Z).add(m); }
    zoneGroup(c.Z).add(sL, sR);
    const lampL = new T.Mesh(WALL_GEO, mat(0xff8a14, { neon: true })), lampR = new T.Mesh(WALL_GEO, mat(0xff8a14, { neon: true }));
    zoneGroup(c.Z).add(lampL, lampR);
    const kl = killBox(c.Z, 'wall'), kr = killBox(c.Z, 'wall');
    kl.active = kr.active = true;
    const amp = HW - gapW / 2 - 3, H = 6;
    hz(c.Z, (t) => {
        const gx = Math.sin(2 * Math.PI * cyc(t, period, phase)) * amp;
        const a = gx - gapW / 2, b = gx + gapW / 2;
        L.scale.set(a + HW - 1, H, 3); L.position.set((a - HW - 1) / 2, H / 2, z);
        R.scale.set(HW - b - 1, H, 3); R.position.set((b + HW + 1) / 2, H / 2, z);
        sL.scale.set(a + HW - 1, 0.9, 3.1); sL.position.set((a - HW - 1) / 2, H * 0.62, z);
        sR.scale.set(HW - b - 1, 0.9, 3.1); sR.position.set((b + HW + 1) / 2, H * 0.62, z);
        eL.scale.set(1, H + 0.2, 3.2); eL.position.set(a - 0.5, H / 2, z);
        eR.scale.set(1, H + 0.2, 3.2); eR.position.set(b + 0.5, H / 2, z);
        lampL.scale.set(0.5, 0.5, 3.3); lampL.position.set(a - 0.5, H + 0.5, z);
        lampR.scale.set(0.5, 0.5, 3.3); lampR.position.set(b + 0.5, H + 0.5, z);
        kl.min.set(-HW, 0, z - 1.5); kl.max.set(a, H, z + 1.5);
        kr.min.set(b, 0, z - 1.5); kr.max.set(HW, H, z + 1.5);
    });
}
// ----- glitch tiles: floor panels that flicker out (fall through) in a pattern -----
// Each row is a strip of lanes with a block of W lit lanes on it. Row by row the block is offset a
// little (row.phase), so the lit tiles form a winding path; over time the whole path sways side to
// side, slowly (ping-pong, so it never jumps from one edge to the other). What you see ahead is
// about what you'll find when you get there. Tiles about to go dark flicker.
function glitchTiles(c, rows, cols, W, P) {
    const pp = (x) => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);
    const blockAt = (row, t) => pp((t + row.phase) / P) * (cols - W);
    const litAt = (row, k, t) => { const u = blockAt(row, t); return k + 0.5 > u && k + 0.5 < u + W; };
    for (const row of rows) {
        row.tiles = row.lanes.map((p) => {
            const m = new T.Mesh(new T.BoxGeometry(p.w - 0.4, 1.2, row.d - 0.4), new T.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.55, roughness: 0.3 }));
            m.position.set(p.x, -0.6, row.z); m.receiveShadow = true; zoneGroup(c.Z).add(m);
            return { m, c: solid(c.Z, p.x, -0.6, row.z, p.w, 1.2, row.d) };
        });
    }
    hz(c.Z, (t) => {
        for (const row of rows) row.tiles.forEach((tile, k) => {
            const on = litAt(row, k, t), soon = on && !litAt(row, k, t + 0.7);
            tile.c.off = !on;
            tile.m.visible = on && !(soon && Math.floor(t * 16) % 2 === 0);
            tile.m.material.emissiveIntensity = soon ? 1.3 : 0.55;
        });
    });
}
// ----- wind gusts pushing sideways (arrows warn first) -----
export const winds = [];
function windZone(c, z0, z1, period, phase, strength) {
    const w = { z0, z1, push: 0 };
    winds.push(w);
    const arrows = [];
    for (let k = 0; k < 5; k++) {
        const a = textPlane([{ t: '⇨', c: '#e8f4ff', s: '#141a2e', px: 220 }], 8, 256, new V3(0, 8 + (k % 2) * 7, z0 + (k + 0.5) * (z1 - z0) / 5), new V3(0, 8, z0 - 200), zoneGroup(c.Z));
        arrows.push(a);
    }
    hz(c.Z, (t) => {
        const cc = cyc(t, period, phase);
        const dir = cc < 0.5 ? 1 : -1, local = (cc % 0.5) / 0.5;
        const gust = local > 0.45 ? Math.sin((local - 0.45) / 0.55 * Math.PI) : 0;
        w.push = -dir * gust * strength;
        const warn = local > 0.2;
        for (const a of arrows) {
            a.visible = warn && (gust > 0.1 || Math.floor(t * 6) % 2 === 0);
            a.rotation.z = dir > 0 ? Math.PI : 0;
            a.material.opacity = 0.4 + 0.6 * gust;
        }
    });
}
// ----- lightning strikes on the storm road (target ring, then the bolt) -----
function lightning(c, spots, period) {
    const items = spots.map((s) => {
        const bolt = new T.Mesh(new T.CylinderGeometry(0.8, 1.6, 60, 6, 1, true), mat(0xfff6a0, { neon: true, boost: 2 }));
        bolt.position.set(s.x, 30, s.z); zoneGroup(c.Z).add(bolt);
        const warn = new T.Mesh(new T.RingGeometry(3.4, 5, 28), new T.MeshBasicMaterial({ color: 0xffe05a, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: T.DoubleSide }));
        warn.rotation.x = -Math.PI / 2; warn.position.set(s.x, 0.1, s.z); zoneGroup(c.Z).add(warn);
        const k = killBox(c.Z, 'lightning'); k.min.set(s.x - 4.5, -1, s.z - 4.5); k.max.set(s.x + 4.5, 40, s.z + 4.5);
        return { ...s, bolt, warn, k };
    });
    hz(c.Z, (t) => {
        for (const it of items) {
            const cc = cyc(t, period, it.phase) * period;
            const strike = cc > 1.1 && cc < 1.35;
            it.warn.visible = cc < 1.35;
            it.warn.scale.setScalar(cc < 1.1 ? 1.3 - 0.3 * (cc / 1.1) : 1);
            it.bolt.visible = strike && Math.floor(t * 30) % 2 === 0;
            it.bolt.rotation.y = t * 9;
            it.k.active = strike;
        }
    });
}

// =====================================================================================
// Stage sections. c = { s, Z, th, rng, a, b, d, vs } (vs = the stage's speed: spacing scales with
// it, so a stage feels about as hard at the speed it asks for). Each section lays its own floor.
// =====================================================================================
export const checkpoints = STAGES.map(() => []);
// What each kind of section is and what to do about it: shown on the board over the checkpoint
// arch before it and as a card on the HUD when you drive under that arch
export const SEC_INFO = {
    cones: { icon: '🚧', title: 'BARRIERS', tip: 'Steer through the gaps - grab the boost arrows!', color: 0x3a8cff },
    ramps: { icon: '🛫', title: 'JUMPS', tip: 'Hit the ramps at full speed', color: 0xffd028 },
    lasers: { icon: '⚡', title: 'LASERS', tip: 'Wait for red gates to switch OFF - HOP low lasers', color: 0xff3a3a },
    cops: { icon: '🚓', title: 'COPS CROSSING', tip: 'Drive around the cops', color: 0x3a8cff },
    spinners: { icon: '🌀', title: 'SPINNERS', tip: 'Wait for the bar to swing away, then go', color: 0xffd028 },
    hammers: { icon: '🔨', title: 'HAMMERS', tip: 'Go when the hammer swings away', color: 0xff5a1e },
    tires: { icon: '🛞', title: 'ROLLING TYRES', tip: 'Steer left or right to dodge them', color: 0xff8a14 },
    crushers: { icon: '⬇️', title: 'CRUSHERS', tip: 'Go under them while they lift up', color: 0xff3a3a },
    ice: { icon: '🧊', title: 'ICE BRIDGES', tip: 'Slippery! Small steering, stay on the bridge', color: 0x5ae0ff },
    traffic: { icon: '🚗', title: 'TRAFFIC', tip: 'Flashing tunnel light = a car is coming!', color: 0xffa014 },
    lava: { icon: '🌋', title: 'LAVA BRIDGES', tip: 'Stay on the bridges - dodge the red circles', color: 0xff6a14 },
    glitch: { icon: '🟪', title: 'GLITCH GRID', tip: 'Follow the lit path - flickering tiles vanish', color: 0x3affd8 },
    chase: { icon: '🚓', title: 'POLICE CHASE', tip: "Don't slow down! Dodge the roadblocks", color: 0x3a8cff },
    mines: { icon: '💣', title: 'MINE FIELD', tip: 'Drive through the gap between the mines', color: 0xff3a1e },
    walls: { icon: '🧱', title: 'CLOSING WALLS', tip: 'Drive through the moving gap', color: 0xff8a14 },
    wind: { icon: '🌪️', title: 'STORM', tip: 'Steer against the wind - dodge yellow circles', color: 0xffe05a },
    jump: { icon: '🛫', title: 'BIG JUMP', tip: 'Full speed off the ramp!', color: 0xffd028 },
    finish: { icon: '🏆', title: 'WINS AHEAD', tip: 'Right: Wins - Left jump: x2 Wins - Middle: next stage', color: 0x7dff6b },
};
// A sign board for a section: icon, title and what to do, framed in the section's colour
const boardTex = new Map();
function infoTexture(info, extra) {
    const key = info.title + '|' + (extra || '');
    if (boardTex.has(key)) return boardTex.get(key);
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
    const x = cv.getContext('2d'), col = css(info.color);
    x.fillStyle = '#0e1426'; x.fillRect(0, 0, 1024, 256);
    x.fillStyle = col; x.fillRect(0, 0, 1024, 14); x.fillRect(0, 242, 1024, 14);
    // hazard chevrons down the sides
    for (let k = 0; k < 4; k++) for (const sx of [0, 1]) { const bx = sx ? 1024 - 44 : 14; x.beginPath(); x.moveTo(bx, 40 + k * 50); x.lineTo(bx + 28, 60 + k * 50); x.lineTo(bx, 80 + k * 50); x.lineTo(bx + 12, 60 + k * 50); x.closePath(); x.fill(); }
    x.textBaseline = 'middle';
    x.font = '120px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif'; x.textAlign = 'center';
    x.fillText(info.icon, 170, 128);
    x.textAlign = 'left'; x.lineJoin = 'round';
    let px = 96; x.font = '700 ' + px + 'px Fredoka, sans-serif';
    const title = info.title + (extra ? ' ' + extra : '');
    while (x.measureText(title).width > 680 && px > 40) { px -= 4; x.font = '700 ' + px + 'px Fredoka, sans-serif'; }
    x.lineWidth = 12; x.strokeStyle = '#000'; x.strokeText(title, 260, 92); x.fillStyle = col; x.fillText(title, 260, 92);
    let tp = 44; x.font = '600 ' + tp + 'px Fredoka, sans-serif';
    while (x.measureText(info.tip).width > 680 && tp > 22) { tp -= 2; x.font = '600 ' + tp + 'px Fredoka, sans-serif'; }
    x.fillStyle = '#ffffff'; x.fillText(info.tip, 262, 182);
    const t = texFrom(cv);
    boardTex.set(key, t);
    return t;
}
// Floor markings: a band of diagonal stripes across [x0, x1] at z (depth along z)
const bandMats = new Map();
function bandMat(c1, c2) {
    const k = c1 + '|' + c2;
    if (!bandMats.has(k)) bandMats.set(k, new T.MeshStandardMaterial({ map: stripeTexture(c1, c2, 2), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    return bandMats.get(k);
}
function band(c, z, depth, x0, x1, c1, c2) {
    x0 = x0 ?? -HW; x1 = x1 ?? HW;
    plainBox(c.Z, x1 - x0, 0.04, depth, (x0 + x1) / 2, 0.03, z, bandMat(c1 ?? 0xe8283a, c2 ?? 0xffffff), { uvScale: [(x1 - x0) / 6, depth / 6] });
}
// Zebra crossing: white blocks across the road
function zebra(c, z, depth) {
    for (let x = -HW + 2; x < HW - 2; x += 5) plainBox(c.Z, 2.6, 0.04, depth, x + 1.3, 0.03, z, gloss(0xffffff, { rough: 0.6 }));
}
// A red ring painted on the floor (spinner reach)
function floorRing(c, x, z, r0, r1, color) {
    const g = new T.RingGeometry(r0, r1, 40); g.rotateX(-Math.PI / 2); g.translate(x, 0.04, z);
    addGeo(c.Z, g, mat(color, { neon: true, boost: 0.9, side: true }));
}
const lerp = (a, b, k) => a + (b - a) * k;
const SEC = {
    // Barrier slaloms: a wall across the road with one opening, alternating sides; cones and a boost
    cones(c) {
        const { a, b, d, vs, rng } = c;
        road(c, a, b);
        const step = Math.max(26, vs * (1.5 - 0.5 * d)), open = 24 - 10 * d;
        let i = 0;
        for (let z = a + step * 0.7; z < b - 12; z += step, i++) {
            const side = i % 2 ? 1 : -1;
            const gx = side * (8 + 8 * d) + (rng() - 0.5) * 6 * d;
            barrier(c, -HW, gx - open / 2, z, 3.2, i % 3 === 2 ? 'blocks' : 'tape');
            barrier(c, gx + open / 2, HW, z, 3.2, i % 3 === 2 ? 'blocks' : 'tape');
            // green stripes on the floor lead into the gap
            band(c, z - 6, 6, gx - open / 2 + 1, gx + open / 2 - 1, 0x46ec50, 0xffffff);
            cone(c.Z, gx - open / 2 - 1.2, z - 2.5); cone(c.Z, gx + open / 2 + 1.2, z - 2.5);
            if (i % 2 === 0) boostPad(c, gx, z + Math.min(14, step * 0.3), Math.min(10, open - 4), 8);
        }
    },
    // Practice jumps: ramps over gaps that need a little less speed than the stage's big jump
    ramps(c) {
        const { a, b, s } = c;
        const v0 = Math.max(20, s.entry || 20);
        let z = a;
        const needs = [Math.round(lerp(v0, s.need, 0.35)), Math.round(lerp(v0, s.need, 0.7))];
        for (const need of needs) {
            const gap = gapFor(need), run = Math.min(40, runupFor(need) * 0.5);
            if (z + run + RAMP.len + gap + 30 > b) break;
            road(c, z, z + run + 0.01);
            speedSign(c.Z, need, new V3(0, 12, z + run * 0.4), 14, 'HOP THE GAP:');
            ramp(c, z + run, -HW, HW, need);
            pit(c, z + run + RAMP.len, z + run + RAMP.len + gap);
            z = z + run + RAMP.len + gap;
            road(c, z, z + 30); z += 30;
        }
        road(c, z, b);
        if (b - z > 30) boostPad(c, 0, (z + b) / 2, 10, 8);
    },
    // Laser gates (time them), hop lasers (jump them), and sliding gaps
    lasers(c) {
        const { a, b, d, vs } = c;
        road(c, a, b);
        const step = Math.max(30, vs * (1.35 - 0.35 * d)) + 6;
        let i = 0;
        for (let z = a + step * 0.6; z < b - 10; z += step, i++) {
            const kind = d < 0.2 ? (i % 3 === 2 ? 'hop' : 'gate') : ['gate', 'hop', 'slide', 'gate', 'double'][i % 5];
            band(c, z, 3, -HW, HW, 0xe8283a, 0x14141e);
            if (kind === 'gate') laserGate(c, z, 2.4 - 0.8 * d, 0.4 + 0.2 * d, i * 0.83);
            else if (kind === 'hop') hopLaser(c, z);
            else if (kind === 'slide') slidingGap(c, z, 18 - 6 * d, 3.2 - d, i * 0.6);
            else { laserGate(c, z, 2.4 - 0.8 * d, 0.45, i * 0.83, -HW, 0); laserGate(c, z, 2.4 - 0.8 * d, 0.45, i * 0.83 + 1.2, 0, HW, 0x3affd8); }
        }
    },
    // Police officers walking across the road; parked police cars on the harder sections
    cops(c) {
        const { a, b, d, vs, rng } = c;
        road(c, a, b);
        const step = Math.max(22, vs * (1.1 - 0.3 * d)) + 8, list = [];
        let i = 0;
        for (let z = a + step * 0.6; z < b - 10; z += step, i++) {
            const n = d > 0.4 && i % 2 ? 2 : 1;
            for (let k = 0; k < n; k++) {
                const dir = (i + k) % 2 ? 1 : -1;
                list.push({ z: z + k * 5, x0: -dir * (HW - 4), x1: dir * (HW - 4), period: (6.4 - 2.2 * d) + rng() * 0.8, phase: rng() * 6 });
                zebra(c, z + k * 5, 5);
            }
            if (d > 0.3 && i % 3 === 1) policeCar(c, (i % 2 ? 1 : -1) * 18, z + step * 0.5, 0.4 * (i % 2 ? 1 : -1));
        }
        cops(c, list);
        for (let z = a + 20; z < b; z += 60) { cone(c.Z, -HW + 3, z); cone(c.Z, HW - 3, z); }
    },
    // Spinning bars: one in the middle, then pairs, then double bars
    spinners(c) {
        const { a, b, d, vs } = c;
        road(c, a, b);
        const step = Math.max(34, vs * 1.2) + 10;
        let i = 0;
        for (let z = a + step * 0.6; z < b - 14; z += step, i++) {
            const dbl = d > 0.45 && i % 2 === 1;
            if (i % 2 === 0) { spinner(c, 0, z, 26 + 6 * d, (i % 4 ? -1 : 1) * (1.2 + 1.1 * d), i, 0xffd028, dbl); floorRing(c, 0, z, (26 + 6 * d) / 2 - 0.4, (26 + 6 * d) / 2 + 0.4, 0xff3a3a); }
            else { spinner(c, -15, z, 24, 1.3 + d, i, 0xff5a5a, dbl); spinner(c, 15, z, 24, -(1.3 + d), i + 1.6, 0x5ad8ff, dbl); floorRing(c, -15, z, 11.6, 12.4, 0xff3a3a); floorRing(c, 15, z, 11.6, 12.4, 0xff3a3a); }
        }
    },
    // Pendulum hammers swinging across the road
    hammers(c) {
        const { a, b, d, vs } = c;
        road(c, a, b);
        const step = Math.max(28, vs * (1.15 - 0.3 * d)) + 8;
        let i = 0;
        for (let z = a + step * 0.6; z < b - 10; z += step, i++) { hammer(c, z, 2.8 - 0.9 * d + (i % 3) * 0.15, i * 0.37, 0xe8283a); band(c, z, 8, -HW, HW, 0xe8283a, 0xffffff); }
    },
    // Giant tyres rolling at you: dodge sideways
    tires(c) {
        const { a, b, d, vs } = c;
        road(c, a, b);
        const xs = d > 0.5 ? [-21, -7, 7, 21] : [-18, 0, 18];
        rollingTires(c, xs.map((x, k) => ({ x, r: 5 + 1.2 * d, speed: 20 + vs * 0.25, every: 2.4 - 0.8 * d, count: 3, phase: k * 0.9, wobble: 1 + 2 * d, bounce: d > 0.6 ? 1.2 : 0, color: [0xffc414, 0xff5a1e, 0x5ad8ff, 0xe8283a][k] })), a, b);
        for (let z = a + 30; z < b; z += 70) { tireStack(c.Z, -HW + 3, z, 4); tireStack(c.Z, HW - 3, z + 35, 4); }
    },
    // Crushers slamming down in rows; time your run between them
    crushers(c) {
        const { a, b, d, vs } = c;
        road(c, a, b);
        const step = Math.max(30, vs * (1.0 - 0.25 * d)) + 12;
        let j = 0;
        for (let z = a + step * 0.6; z < b - 10; z += step, j++) {
            const cols = j % 2 ? [-15, 15] : [-20, 0, 20];
            const w = cols.length === 2 ? 30 : 20;
            cols.forEach((x, k) => { crusher(c, x, z, w, 12, 2.6 - 0.7 * d + (j % 3) * 0.15, j * 0.7 + k * (0.9 - 0.3 * d)); band(c, z, 13, x - w / 2 + 0.2, x + w / 2 - 0.2, 0xffc414, 0x14141e); });
        }
    },
    // Ice: slippery zig-zag bridges over the void
    ice(c) {
        const { a, b, d, vs, rng } = c;
        const w = 30 - 12 * d, seg = Math.max(40, vs * 0.9);
        let z = a, x = 0, i = 0;
        const iceX = { ice: true };
        road(c, a, a + 12, -HW, HW, { extra: iceX });
        z = a + 12;
        while (z + seg < b - 12) {
            const nx = (i % 2 ? 1 : -1) * (HW - w / 2 - 1) * (0.5 + 0.5 * d) * (0.7 + rng() * 0.3);
            // Overlap the turn so you can slide across
            road(c, z, z + seg, nx - w / 2, nx + w / 2, { extra: iceX });
            for (const sx of [-1, 1]) glowBox(c.Z, 0.35, 0.2, seg, nx + sx * w / 2, 0.08, z + seg / 2, 0x5ae0ff, 1.3);
            const ov = Math.min(Math.abs(nx - x) + w, STAGE_W);
            road(c, z - 4, z + 4, Math.min(x, nx) - w / 2, Math.min(x, nx) - w / 2 + ov, { extra: iceX });
            pit(c, z, z + seg, -HW, nx - w / 2, { edges: false });
            pit(c, z, z + seg, nx + w / 2, HW, { edges: false });
            x = nx; z += seg; i++;
        }
        road(c, z, b, -HW, HW, { extra: iceX });
        for (let q = a + 20; q < b; q += 50) {
            const crystal = new T.Mesh(new T.OctahedronGeometry(2.4, 0), gloss(0x9ae8ff, { rough: 0.05, clear: true, emissive: 0x5ae0ff, emissiveIntensity: 0.3 }));
            crystal.position.set((q % 100 < 50 ? -1 : 1) * (HW - 2), 6, q); crystal.scale.y = 2; zoneGroup(c.Z).add(crystal);
        }
    },
    // Rush hour: cars cross the road out of tunnels; oncoming cars down the lanes on harder sections
    traffic(c) {
        const { a, b, d, vs, rng } = c;
        road(c, a, b);
        const step = Math.max(26, vs * (1.0 - 0.25 * d)) + 10, lanes = [];
        let i = 0;
        for (let z = a + step * 0.6; z < b - 12; z += step, i++) { lanes.push({ z, dir: i % 2 ? 1 : -1, cross: 1.8 - 0.6 * d, period: 3.4 - 1.0 * d + rng() * 0.6, phase: rng() * 4 }); band(c, z, 11, -HW, HW, 0xffc414, 0x14141e); }
        crossTraffic(c, lanes);
        if (d >= 0.5) oncoming(c, [{ x: -18, speed: 26, every: 3.2 - d, count: 3, phase: 0 }, { x: 18, speed: 30, every: 3.0 - d, count: 3, phase: 1.3 }], a, b);
        // Lane markings
        for (let z = a + 4; z < b; z += 14) plainBox(c.Z, 0.6, 0.05, 6, 0, 0.04, z, gloss(0xffffff, { rough: 0.6 }));
        for (const s of [-1, 1]) plainBox(c.Z, 0.5, 0.05, b - a, s * (HW - 2), 0.04, (a + b) / 2, gloss(0xffd028, { rough: 0.6 }));
    },
    // Lava: narrow stone bridges over a lava lake, meteors falling on them
    lava(c) {
        const { a, b, d, vs, rng } = c;
        const tex = lavaTexture().clone(); tex.needsUpdate = true; tex.repeat.set(3, (b - a) / 40);
        const lake = new T.Mesh(new T.PlaneGeometry(STAGE_W, b - a), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
        lake.material.color.setScalar(1.3);
        lake.rotation.x = -Math.PI / 2; lake.position.set(0, -6, (a + b) / 2); zoneGroup(c.Z).add(lake);
        scrolling.push({ tex, u: 0.02, v: -0.05 });
        const kb = killBox(c.Z, 'lava'); kb.min.set(-HW, -40, a); kb.max.set(HW, -4.5, b); kb.active = true;
        const w = 22 - 9 * d, seg = Math.max(36, vs * 0.8);
        let z = a, x = 0, i = 0;
        const spots = [];
        const stone = 0x5a4a48;
        road(c, a, a + 10, -HW, HW, { color: stone });
        z = a + 10;
        while (z + seg < b - 10) {
            const nx = (i % 2 ? 1 : -1) * (HW - w / 2 - 2) * (0.45 + 0.55 * d) * (0.6 + rng() * 0.4);
            road(c, z, z + seg, nx - w / 2, nx + w / 2, { color: stone });
            const lo = Math.min(x, nx) - w / 2, hi = Math.max(x, nx) + w / 2;
            road(c, z - 3, z + 3, lo, hi, { color: stone });
            for (const s of [-1, 1]) glowBox(c.Z, 0.3, 0.2, seg, nx + s * w / 2, 0.05, z + seg / 2, 0xff6a14, 1.3);
            if (d > 0.3) spots.push({ x: nx, z: z + seg * 0.5, phase: i * 0.9 });
            x = nx; z += seg; i++;
        }
        road(c, z, b, -HW, HW, { color: stone });
        if (spots.length) meteors(c, spots, 3.4 - 0.8 * d);
    },
    // Glitch grid: lanes of neon tiles that blink out; ride the ones that stay lit
    glitch(c) {
        const { a, b, d, vs } = c;
        const cols = 4, w = STAGE_W / cols, len = Math.max(16, vs * 0.38), rows = [];
        const colors = [0x3affd8, 0xff3ad8, 0x8a5aff, 0x3a8cff];
        // A solid run-in, so you can read the grid before you're on it
        const lead = 24;
        road(c, a, a + lead);
        const P = 9.5 - 2.5 * d, bend = (0.05 + 0.04 * d) * P, W = d < 0.55 ? 2.6 : 2;
        let r = 0;
        for (let z = a + lead; z + len <= b - 4; z += len, r++) {
            rows.push({ z: z + len / 2, d: len, phase: r * bend, lanes: Array.from({ length: cols }, (_, k) => ({ x: -HW + w * (k + 0.5), w, color: colors[(k + r) % 4] })) });
        }
        const zEnd = a + lead + r * len;
        road(c, zEnd, b);
        glitchTiles(c, rows, cols, W, P);
        // A deep neon pit under the grid
        plainBox(c.Z, STAGE_W, 0.3, zEnd - a - lead, 0, PIT, (a + lead + zEnd) / 2, mat(0x3a1a6a, { neon: true, boost: 0.5 }));
        if (d > 0.6) for (let k = 1; k <= 2; k++) laserGate(c, a + lead + Math.round(r * k / 3) * len, 3.0, 0.3, k * 1.1, -HW, HW, 0x3affd8);
    },
    // Police chase: a cruiser chases you down the road (main.js); police roadblocks with one gap,
    // boost pads to help you get away
    chase(c) {
        const { a, b, d, vs, rng, s } = c;
        road(c, a, b);
        const prev = chases[chases.length - 1];
        if (prev && prev.stage === s.i && a - prev.b < 40) { prev.b = b; prev.d = d; prev.cops = d >= 0.5 ? 2 : 1; }
        else chases.push({ stage: s.i, a, b, d, vs, cops: d >= 0.5 ? 2 : 1 });
        const step = Math.max(46, vs * (1.6 - 0.45 * d)), open = 28 - 10 * d;
        let i = 0;
        for (let z = a + step * 0.9; z < b - 30; z += step, i++) {
            const gx = (i % 2 ? 1 : -1) * (6 + 9 * d) + (rng() - 0.5) * 5 * d;
            const x0 = gx - open / 2, x1 = gx + open / 2;
            // roadblock: police cars nose to tail across the road, the gap marked in green
            roadblock(c, -HW, x0, z); roadblock(c, x1, HW, z);
            band(c, z - 8, 8, x0 + 1, x1 - 1, 0x46ec50, 0xffffff);
            if (i % 2 === 0) boostPad(c, gx, z + 16, 8, 8);
        }
        // the end of the chase: blue & white line, the cops give up here
        band(c, b - 3, 4, -HW, HW, 0x3a8cff, 0xffffff);
    },
    // Mine field: rows of mines across the road with one gap that zig-zags; red rings show the reach
    mines(c) {
        const { a, b, d, vs, rng } = c;
        road(c, a, b);
        const step = Math.max(28, vs * (1.0 - 0.3 * d)), open = 22 - 9 * d, list = [];
        let i = 0;
        for (let z = a + step * 0.7; z < b - 10; z += step, i++) {
            const gx = (i % 2 ? 1 : -1) * (5 + 10 * d) * (0.6 + rng() * 0.4);
            for (let x = -HW + 3.5; x < HW - 3; x += 6.5) {
                if (Math.abs(x - gx) < open / 2 + 1.5) continue;
                list.push({ x, z });
            }
            band(c, z - 7, 5, gx - open / 2 + 2, gx + open / 2 - 2, 0x46ec50, 0xffffff);
        }
        mineField(c, list);
    },
    // Closing walls: steel walls across the road with a gap that slides from side to side
    walls(c) {
        const { a, b, d, vs } = c;
        road(c, a, b);
        const step = Math.max(34, vs * (1.15 - 0.3 * d)) + 6;
        let i = 0;
        for (let z = a + step * 0.7; z < b - 10; z += step, i++) {
            movingWall(c, z, 20 - 7 * d, 3.8 - 1.2 * d, i * 0.9);
            band(c, z, 5, -HW, HW, 0xff8a14, 0x14141e);
        }
    },
    // Thunder storm: a narrow causeway over the void, wind gusts and lightning strikes
    wind(c) {
        const { a, b, d, vs } = c;
        const w = 26 - 8 * d;
        road(c, a, b, -w / 2, w / 2);
        pit(c, a, b, -HW, -w / 2); pit(c, a, b, w / 2, HW);
        for (const s of [-1, 1]) glowBox(c.Z, 0.35, 0.25, b - a, s * w / 2, 0.08, (a + b) / 2, 0xffe05a, 1.3);
        const seg = Math.max(60, vs * 1.4);
        let i = 0;
        for (let z = a; z + seg <= b; z += seg, i++) windZone(c, z, z + seg, 6.5 - 2 * d, i * 1.7, 14 + 18 * d);
        if (d >= 0.5) {
            const spots = [];
            for (let z = a + seg * 0.5, k = 0; z < b; z += seg * 0.5, k++) spots.push({ x: (k % 2 ? 1 : -1) * w * 0.25, z, phase: k * 0.8 });
            lightning(c, spots, 3.0 - 0.6 * d);
        }
    },
};

// ----- trackside adverts: a handful of shared textures, merged per zone -----
const AD_TEXTS = [['+1 SPEED', '#ffd028', '#e8283a'], ['NITRO', '#ffffff', '#2a7cff'], ['DRIFT!', '#14141e', '#ffd028'], ['TURBO', '#ffffff', '#ff6a14'], ['GO GO GO', '#ffffff', '#1aa84a'], ['ESCAPE', '#ffffff', '#8a3aff']];
const adMats = [];
function adMat(i) {
    if (adMats[i]) return adMats[i];
    const [t, fg, bg] = AD_TEXTS[i];
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 102;
    const x = cv.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 512, 102);
    x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(0, 0, 512, 10);
    x.font = 'italic 700 70px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = fg; x.fillText(t, 256, 56);
    const tex = texFrom(cv);
    adMats[i] = new T.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 });
    return adMats[i];
}
// ----- stage shell: walls with pillars and beams, the entry gate, decoration -----
function stageShell(s) {
    const Z = s.i, th = s.theme, len = s.zE - s.zS, cz = (s.zS + s.zE) / 2;
    const bottom = PIT - 2;
    for (const side of [-1, 1]) {
        studBox(Z, 2, WALL_H - bottom, len, side * (HW + 1), (WALL_H + bottom) / 2, cz, th.wall);
        roundBox(Z, 2.8, 1.2, len, side * (HW + 1), WALL_H + 0.6, cz, th.rainbow ? gloss(0xffffff, { rough: 0.3 }) : gloss(th.trim, { rough: 0.3 }), 0.4);
        glowBox(Z, 0.3, 0.4, len, side * (HW - 0.05), 5.2, cz, th.accent, 1.1);
    }
    // Pillars and overhead beams (the reference's corridor look)
    const step = 32;
    for (let z = s.zS + 16; z < s.zE - 4; z += step) {
        for (const side of [-1, 1]) studBox(Z, 3.2, WALL_H - bottom, 4, side * (HW - 0.4), (WALL_H + bottom) / 2, z, th.pillar, { solid: false });
        if (((z - s.zS) / step | 0) % 2 === 0) studBox(Z, STAGE_W + 4, 2.4, 3, 0, WALL_H - 1.2, z, th.pillar, { solid: false });
    }
    // Trackside boards low on the walls, like a racing circuit
    let n = 0;
    for (let z = s.zS + 30; z < s.zE - 20; z += 46, n++) {
        for (const side of [-1, 1]) {
            const g = new T.PlaneGeometry(18, 3.6); g.rotateY(-side * Math.PI / 2); g.translate(side * (HW - 0.12), 3.2, z);
            addGeo(Z, g, adMat((n + (side > 0 ? 2 : 0)) % AD_TEXTS.length));
        }
    }
    stageGate(s);
}
// Entry gate: the reference's pink see-through wall with "STAGE N" written on it
function stageGate(s) {
    const Z = s.i, th = s.theme, z = s.zS + 3;
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 512);
    const col = new T.Color(th.gate);
    g.addColorStop(0, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0.55)`); g.addColorStop(1, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0.25)`);
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    x.strokeStyle = 'rgba(255,255,255,0.18)'; x.lineWidth = 3;
    for (let i = 0; i < 1024; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); }
    for (let j = 0; j < 512; j += 64) { x.beginPath(); x.moveTo(0, j); x.lineTo(1024, j); x.stroke(); }
    x.font = '700 150px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = 16; x.strokeStyle = 'rgba(20,26,46,0.85)'; x.strokeText(s.name.toUpperCase(), 512, 200);
    x.fillStyle = '#ffffff'; x.fillText(s.name.toUpperCase(), 512, 200);
    x.font = '700 64px Fredoka, sans-serif'; x.lineWidth = 10; x.strokeText(s.sub, 512, 320); x.fillStyle = '#ffd028'; x.fillText(s.sub, 512, 320);
    if (s.entry) { x.font = '700 50px Fredoka, sans-serif'; x.lineWidth = 9; x.strokeText('Recommended ⚡ ' + s.need + ' Speed', 512, 410); x.fillStyle = '#7dff6b'; x.fillText('Recommended ⚡ ' + s.need + ' Speed', 512, 410); }
    const m = new T.Mesh(new T.PlaneGeometry(STAGE_W, 24), new T.MeshBasicMaterial({ map: texFrom(cv), transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    m.position.set(0, 12, z); m.rotation.y = Math.PI; zoneGroup(Z).add(m);
    roundBox(Z, STAGE_W + 4, 2.4, 3, 0, 25, z, gloss(th.gate, { rough: 0.3 }), 0.6);
    for (const sx of [-1, 1]) roundBox(Z, 2.4, 25, 3, sx * (HW - 0.2), 12.5, z, gloss(th.gate, { rough: 0.3 }), 0.6);
    // Checkered start line on the floor
    const chk = checkerTexture(0xffffff, 0x14141e, 8).clone(); chk.needsUpdate = true; chk.repeat.set(STAGE_W / 8, 0.5);
    const line = new T.Mesh(new T.PlaneGeometry(STAGE_W, 4), new T.MeshStandardMaterial({ map: chk, roughness: 0.5 }));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.05, z + 4); zoneGroup(Z).add(line);
    const tr = aabb(0, 4, z + 4, STAGE_W, 10, 3); tr.zone = Z; tr.enter = () => actions.stageGate(s.i); triggers.push(tr);
}
// Checkpoint arch across the road
function checkpoint(Z, s, k, z, info, extra) {
    checkpoints[s.i][k] = { pos: new V3(0, 0.5, z), yaw: 0, info, extra };
    const th = s.theme;
    if (info) {
        const board = new T.Mesh(new T.PlaneGeometry(36, 9), new T.MeshBasicMaterial({ map: infoTexture(info, extra), toneMapped: false, side: T.DoubleSide }));
        board.position.set(0, 17.6, z); board.rotation.y = Math.PI; zoneGroup(Z).add(board);
        roundBox(Z, 37.4, 10.4, 0.8, 0, 17.6, z + 0.5, gloss(0x14141e, { rough: 0.4 }), 0.3);
        glowBox(Z, 37.6, 0.35, 0.9, 0, 12.3, z, info.color, 1.4);
        for (const sx of [-1, 1]) plainBox(Z, 0.6, 9, 0.6, sx * 17, 17.6, z + 0.6, gloss(0x22283a, { rough: 0.4 }));
    }
    for (const sx of [-1, 1]) {
        const p = new T.Mesh(new T.CylinderGeometry(0.5, 0.6, 12, 10), gloss(0xffffff, { rough: 0.3 }));
        p.position.set(sx * (HW - 2.5), 6, z); p.castShadow = true; zoneGroup(Z).add(p);
        if (info) { const p2 = p.clone(); p2.position.y = 17.6; zoneGroup(Z).add(p2); plainBox(Z, HW - 19.5, 0.6, 0.6, sx * (HW - 2.5 + 17) / 2, 21.8, z, gloss(0xffffff, { rough: 0.3 })); }
    }
    const chk = checkerTexture(0xffffff, 0x14141e, 8).clone(); chk.needsUpdate = true; chk.repeat.set(10, 1);
    const flag = new T.Mesh(new T.PlaneGeometry(STAGE_W - 5, 2.2), new T.MeshBasicMaterial({ map: chk, side: T.DoubleSide, toneMapped: false }));
    flag.position.set(0, 10.6, z); zoneGroup(Z).add(flag);
    glowBox(Z, STAGE_W - 5, 0.25, 0.3, 0, 9.4, z, th.accent, 1.5);
    const tr = aabb(0, 4, z, STAGE_W, 10, 4); tr.zone = Z;
    tr.enter = () => actions.checkpoint(s.i, k);
    triggers.push(tr);
}

// ----- the end zone: three lanes, the bonus jump, the Wins pads and the end wall -----
const beamTex = (() => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 64;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0.8)');
    x.fillStyle = g; x.fillRect(0, 0, 4, 64);
    return texFrom(c);
})();
const TROPHY = (() => {
    const pts = [[0, 0], [1.2, 0], [1.2, 0.25], [0.5, 0.4], [0.35, 1.1], [0.5, 1.3], [1.15, 1.6], [1.25, 2.6], [1.1, 2.62], [0, 2.62]].map(([x, y]) => new T.Vector2(x, y));
    return new T.LatheGeometry(pts, 24);
})();
const GOLD = new T.MeshStandardMaterial({ color: 0xffc828, metalness: 1, roughness: 0.22 });
function winsPad(c, p, color, lines) {
    const Z = c.Z;
    roundBox(Z, PAD.w, 0.6, PAD.d, p.x, 0.3, p.z, gloss(color, { rough: 0.25, clear: true }), 0.3);
    glowBox(Z, PAD.w - 0.8, 0.08, PAD.d - 0.8, p.x, 0.63, p.z, color, 1.3);
    const bm = new T.MeshBasicMaterial({ map: beamTex, color, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false });
    bm.color.multiplyScalar(1.6);
    const beam = new T.Mesh(new T.CylinderGeometry(5, 6, 26, 24, 1, true), bm);
    beam.position.set(p.x, 13, p.z); zoneGroup(Z).add(beam);
    const cup = new T.Mesh(TROPHY, GOLD); cup.position.set(p.x, 1, p.z); cup.scale.setScalar(1.3); cup.castShadow = true; zoneGroup(Z).add(cup);
    tickers.push((dt, t) => { if (zoneGroup(Z).visible) { cup.rotation.y = t * 1.5 + p.k; cup.position.y = 1 + Math.sin(t * 2 + p.k) * 0.3; } });
    billboard(lines, 11, 512, new V3(p.x, 9, p.z - 1), zoneGroup(Z));
    const tr = aabb(p.x, 6, (p.z - PAD.d / 2 + c.s.zE) / 2, PAD.w, 12, c.s.zE - (p.z - PAD.d / 2)); tr.zone = Z;
    tr.enter = () => actions.pad(c.s.i, p.k);
    triggers.push(tr);
}
function endZone(c) {
    const { s, Z, th } = c;
    const e0 = s.e0, zE = s.zE, last = s.i === STAGES.length - 1;
    // Lane dividers
    for (const sx of [-1, 1]) {
        roundBox(Z, 1.6, 3.2, zE - e0, sx * LANE_X, 1.6, (e0 + zE) / 2, gloss(th.trim === 0xffffff ? th.accent : th.trim, { rough: 0.35 }), 0.4, { solid: true });
        glowBox(Z, 1.7, 0.25, zE - e0, sx * LANE_X, 3.3, (e0 + zE) / 2, th.accent, 1.4);
    }
    // Lane paint before the split: yellow = Wins (right), green = next stage (middle), purple = x2 Wins (left)
    band(c, e0 - 14, 26, -HW + 2.4, -LANE_X - 1, 0xffd028, 0x14141e);
    band(c, e0 - 14, 26, -LANE_X + 1, LANE_X - 1, 0x46ec50, 0xffffff);
    band(c, e0 - 14, 26, LANE_X + 1, HW - 2.4, 0xb85aff, 0xffffff);
    // Striped noses on the lane dividers
    for (const sx of [-1, 1]) roundBox(Z, 2.4, 4, 1.2, sx * LANE_X, 2, e0 - 0.4, bandMat(0xffc414, 0x14141e), 0.3, { solid: true });
    // Middle and right lanes (-x is on your right): flat road to the end
    road(c, e0, zE, -HW, LANE_X);
    // Left lane (+x): run-up, the bonus ramp, the gap, the island with the purple pad
    road(c, e0, s.bRamp0, LANE_X, HW);
    ramp(c, s.bRamp0, LANE_X, HW, s.bonus);
    pit(c, s.bLip, s.bLand, LANE_X, HW);
    road(c, s.bLand, zE, LANE_X, HW);
    speedSign(Z, s.bonus, new V3((HW + LANE_X) / 2, 12, s.bRamp0 - 10), 14, 'x2 WINS JUMP:');
    // Lane signs
    billboard([{ t: '🏆 WINS', c: '#ffd028', s: '#141a2e', px: 80 }, { t: '+' + fmt(s.wins) + ' Wins', c: '#ffffff', s: '#141a2e', px: 54 }], 12, 512, new V3(-(HW + LANE_X) / 2, 11, e0 + 6), zoneGroup(Z));
    billboard([{ t: last ? '👑 ESCAPE ➜' : (STAGES[s.i + 1].name.toUpperCase() + ' ➜'), c: '#7dff6b', s: '#141a2e', px: 70 }, { t: last ? 'The finish!' : 'Keep driving!', c: '#ffffff', s: '#141a2e', px: 44 }], 12, 512, new V3(0, 11, e0 + 6), zoneGroup(Z));
    // End wall across the side lanes (the middle lane goes on)
    for (const sx of [-1, 1]) {
        studBox(Z, HW - LANE_X, WALL_H, 2, sx * (LANE_X + (HW - LANE_X) / 2), WALL_H / 2, zE + 1, th.wall);
        roundBox(Z, HW - LANE_X, 1.2, 2.6, sx * (LANE_X + (HW - LANE_X) / 2), WALL_H + 0.6, zE + 1, gloss(th.trim, { rough: 0.3 }), 0.4);
    }
    // Pads: yellow +1x on the right lane, purple x2 on the left (as in the reference)
    const [p1, p2] = s.pads;
    winsPad(c, p1, 0xffd028, [{ t: '+' + fmt(p1.wins) + ' Win' + (p1.wins > 1 ? 's' : ''), c: '#ffd028', s: '#141a2e', px: 84 }, { t: 'Drive in!', c: '#ffffff', s: '#141a2e', px: 44 }]);
    winsPad(c, p2, 0xb85aff, [{ t: 'x2 WINS', c: '#e0a8ff', s: '#141a2e', px: 84 }, { t: '+' + fmt(p2.wins) + ' Wins', c: '#ffffff', s: '#141a2e', px: 52 }]);
}
// The finish plaza after the last stage: a golden trophy and the ESCAPE pad
function buildSummit(s) {
    const Z = s.i, th = s.theme, z0 = s.zE, z1 = z0 + SUMMIT.len;
    const c = { s, Z, th };
    road(c, z0, z1, -HW, HW, { plain: true, color: 0xffe68a });
    for (const sx of [-1, 1]) studBox(Z, 2, WALL_H, SUMMIT.len, sx * (HW + 1), WALL_H / 2, (z0 + z1) / 2, 0xffc828);
    studBox(Z, STAGE_W + 4, WALL_H, 2, 0, WALL_H / 2, z1 + 1, 0xffc828);
    const trophy = new T.Mesh(TROPHY, GOLD);
    trophy.scale.setScalar(7); trophy.position.set(0, 0, z1 - 14); trophy.castShadow = true; zoneGroup(Z).add(trophy);
    tickers.push((dt, t) => { trophy.rotation.y = Math.sin(t * 0.5) * 0.4; });
    banner(Z, '👑 YOU ESCAPED! 👑', ['#ffffff', '#ffd028'], 44, new V3(0, 28, z1 - 3), new V3(0, 0, -1), 'You beat all 12 stages of the speedway!');
    roundBox(Z, 16, 0.6, 12, SUMMIT.x, 0.3, SUMMIT.z, gloss(0xffd028, { rough: 0.2, clear: true }), 0.4);
    glowBox(Z, 15.4, 0.1, 11.4, SUMMIT.x, 0.62, SUMMIT.z, 0xffe06a, 1.5);
    billboard([{ t: 'ESCAPE!', c: '#ffd028', s: '#141a2e', px: 90 }, { t: '+' + fmt(SUMMIT.wins) + ' Wins', c: '#ffffff', s: '#141a2e', px: 56 }], 12, 512, new V3(SUMMIT.x, 8, SUMMIT.z), zoneGroup(Z));
    const tr = aabb(SUMMIT.x, 2, SUMMIT.z, 16, 5, 12); tr.zone = Z; tr.enter = () => actions.summit(); triggers.push(tr);
}
function buildStage(s) {
    const rng = rngFrom(100 + s.i * 37), Z = s.i, th = s.theme;
    // vs: the stage's speed in world studs per second (hazards are spaced for it)
    const c0 = { s, Z, th, rng, vs: worldSpeed(s.need) };
    stageShell(s);
    // Entry straight with the first checkpoint
    road(c0, s.zS, s.secs[0].a);
    checkpoint(Z, s, 0, s.zS + ENTRY - 10, SEC_INFO[s.secs[0].type]);
    s.secs.forEach((sec, k) => {
        SEC[sec.type]({ ...c0, a: sec.a, b: sec.b, d: sec.d });
        if (k < s.secs.length - 1) {
            road(c0, sec.b, sec.b + REST);
            checkpoint(Z, s, k + 1, sec.b + REST / 2, SEC_INFO[s.secs[k + 1].type]);
        }
    });
    // Run-up, the big jump, the landing
    const n = s.secs.length;
    road(c0, s.runup0, s.ramp0);
    checkpoint(Z, s, n, s.runup0 + 6, SEC_INFO.jump, '⚡' + s.need);
    speedSign(Z, s.need, new V3(0, 13, s.runup0 + Math.min(30, (s.ramp0 - s.runup0) * 0.5)), 18, (s.i === STAGES.length - 1 ? 'FINAL' : 'BIG') + ' JUMP NEEDS');
    for (let z = s.runup0 + 14; z < s.ramp0 - 4; z += 14) for (const sx of [-1, 1]) glowBox(Z, 3, 0.06, 6, sx * 8, 0.05, z, th.accent, 1.2);
    // Distance boards to the ramp, like braking markers on a circuit
    for (const dz of [150, 100, 50]) {
        const z = s.ramp0 - dz;
        if (z < s.runup0 + 16) continue;
        for (const sx of [-1, 1]) {
            textPlane([{ t: String(dz), c: '#14141e', px: 150 }], 5, 256, new V3(sx * (HW - 1.5), 4, z - 0.3), new V3(sx * (HW - 1.5), 4, z - 10), zoneGroup(Z));
            roundBox(Z, 5.6, 3.6, 0.5, sx * (HW - 1.5), 4, z, gloss(0xffffff, { rough: 0.4 }), 0.2);
            plainBox(Z, 0.4, 2.2, 0.4, sx * (HW - 1.5), 1.1, z, gloss(0x22283a, { rough: 0.5 }));
        }
    }
    ramp(c0, s.ramp0, -HW, HW, s.need);
    pit(c0, s.lip, s.land);
    road(c0, s.land, s.e0);
    checkpoint(Z, s, n + 1, s.land + 18, SEC_INFO.finish);
    endZone(c0);
    if (s.i === STAGES.length - 1) buildSummit(s);
}

// =====================================================================================
// Per frame: hazards near the player
// =====================================================================================
export function updateWorld(dt, stage) {
    const t = net.now() / 1000;
    for (const h of hazards) if (Math.abs(h.zone - Math.max(0, stage)) <= 1) h.update(t, dt);
}
export function windAt(p) {
    for (const w of winds) if (p.z >= w.z0 && p.z <= w.z1) return w.push;
    return 0;
}
export function buildWorld() {
    buildLobby();
    STAGES.forEach((s) => buildStage(s));
    flushGeo();
    refreshShop();
    drawEventBoard();
    cullZones(-1);
}
export function stageStart(i) {
    const cp = checkpoints[i][0];
    return { pos: cp ? cp.pos.clone() : new V3(0, 0.5, STAGES[i].zS + 20), yaw: 0 };
}
// Remote players' karts and the showroom share the kart builder
export { buildKart, animateKart, kartById, CFG };
