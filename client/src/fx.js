import { T, V3, $, renderer, scene, camera, sun } from './engine.js';

// =====================================================================================
// Rendering quality. The scene is drawn straight to the screen with MSAA (no bloom or grading
// passes): sharp at the screen's own resolution, like the original, and far cheaper.
//   low: 1x, no shadows - medium: up to 1.5x, shadows - high: up to 2x, finer shadows
// The game picks the preset by frame rate (adaptQuality), never above the one chosen in the
// settings (the cap).
// =====================================================================================
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const QUALITIES = {
    low: { label: 'Low', ratio: 1, shadows: false, shadowMap: 512 },
    medium: { label: 'Medium', ratio: 1.5, shadows: true, shadowMap: 1024 },
    high: { label: 'High', ratio: 2, shadows: true, shadowMap: 2048 },
};
const ORDER = ['low', 'medium', 'high'], rank = (q) => ORDER.indexOf(q);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private mode */ } return null; };
let cap = QUALITIES[store('gke_qcap')] ? store('gke_qcap') : 'high';
let quality = QUALITIES[store('gke_qauto')] ? store('gke_qauto') : isTouch ? 'low' : 'medium';
if (rank(quality) > rank(cap)) quality = cap;

renderer.toneMapping = T.NeutralToneMapping;
renderer.toneMappingExposure = 1.06;

// Resolution scale: only below 1 as a last resort on Low
let resScale = 1, shadowsOn = null;
function applyRatio() {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, QUALITIES[quality].ratio) * resScale);
    resizeFx();
}
function applyQuality() {
    const q = QUALITIES[quality];
    applyRatio();
    sun.castShadow = q.shadows;
    if (sun.shadow.mapSize.x !== q.shadowMap) {
        sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    // Turning shadows on or off changes every lit shader; a size change doesn't
    if (shadowsOn !== q.shadows) {
        shadowsOn = q.shadows;
        renderer.shadowMap.enabled = q.shadows;
        scene.traverse((o) => { if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => { x.needsUpdate = true; }); } });
    }
}
export function getQuality() { return quality; }
// From the settings: the highest preset to use. fromPlatform: the Bloxity setting (not saved here).
export function setQuality(q, fromPlatform) {
    if (!QUALITIES[q]) return;
    cap = q;
    if (!fromPlatform) { quality = q; store('gke_qcap', q); } else if (rank(quality) > rank(q)) quality = q;
    failed.clear(); resScale = 1; warm = 0;
    applyQuality();
}
// ----- adaptive quality -----
// Under ~45 FPS for 2 s: one preset down (and that one isn't tried again this visit); at Low it
// lowers the resolution a little (75% at most). Steady 60 FPS for 6 s: one preset up, up to the cap.
// The preset it settles on is where the next visit starts.
let fpsAvg = 60, slowT = 0, fastT = 0, warm = 0;
const failed = new Set();
export function adaptQuality(dt) {
    if (document.hidden || dt <= 0) return;
    warm += dt;
    if (warm < 3) { fpsAvg = 60; slowT = fastT = 0; return; }
    fpsAvg += (1 / dt - fpsAvg) * Math.min(1, dt * 2);
    if (fpsAvg < 45) { slowT += dt; fastT = 0; } else if (fpsAvg > 56) { fastT += dt; slowT = 0; } else { slowT = 0; fastT = 0; }
    if (slowT > 2) {
        slowT = 0; warm = 0;
        if (quality !== 'low') { failed.add(quality); quality = ORDER[rank(quality) - 1]; resScale = 1; applyQuality(); store('gke_qauto', quality); }
        else if (resScale > 0.76) { resScale = Math.max(0.75, resScale - 0.125); applyRatio(); }
    } else if (fastT > 6) {
        fastT = 0;
        const up = ORDER[rank(quality) + 1];
        if (resScale < 1) { resScale = Math.min(1, resScale + 0.125); applyRatio(); warm = 0; }
        else if (up && rank(up) <= rank(cap) && !failed.has(up)) { quality = up; applyQuality(); store('gke_qauto', quality); warm = 0; }
    }
}
export const qualityState = () => ({ quality, cap, resScale: +resScale.toFixed(2), ratio: renderer.getPixelRatio(), fps: Math.round(fpsAvg) });
function resizeFx() {
    lines.width = Math.round(innerWidth * Math.min(devicePixelRatio || 1, 1.5));
    lines.height = Math.round(innerHeight * Math.min(devicePixelRatio || 1, 1.5));
}
addEventListener('resize', resizeFx);

export function render() { renderer.render(scene, camera); }

// ----- speed lines (2D overlay) -----
const lines = $('#speedLines');
const lctx = lines.getContext('2d');
const streaks = Array.from({ length: 80 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), l: 0.1 + Math.random() * 0.25, w: 1 + Math.random() * 2.5 }));
let lineAmt = 0, lineColor = '255,255,255', linesDrawn = false;
export function setSpeedLines(target, dt, nitro) {
    lineAmt += (target - lineAmt) * Math.min(1, dt * 6);
    lineColor = nitro ? '150,230,255' : '255,255,255';
    const w = lines.width, h = lines.height;
    if (lineAmt < 0.02) { if (linesDrawn) { lctx.clearRect(0, 0, w, h); linesDrawn = false; } return; }
    lctx.clearRect(0, 0, w, h);
    linesDrawn = true;
    const cx = w / 2, cy = h * 0.46, R = Math.hypot(w, h) / 2;
    lctx.lineCap = 'round';
    for (const s of streaks) {
        s.r += dt * (1.8 + s.l * 5);
        if (s.r > 1) { s.r = 0.4 + Math.random() * 0.2; s.a = Math.random() * Math.PI * 2; }
        const r0 = R * s.r, r1 = R * Math.min(1.1, s.r + s.l);
        lctx.strokeStyle = `rgba(${lineColor},${(0.7 * lineAmt * s.r).toFixed(3)})`;
        lctx.lineWidth = s.w;
        lctx.beginPath();
        lctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
        lctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
        lctx.stroke();
    }
}

// ----- soft sprite particles -----
const softTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
})();
const starTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? 7 : 31; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    x.closePath(); x.fill();
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
})();
const sprites = [];
const MAX_SPRITES = 1100;
function spawn(pos, vel, color, size, life, opts) {
    if (sprites.length > MAX_SPRITES) return;
    opts = opts || {};
    const m = new T.SpriteMaterial({ map: opts.star ? starTex : softTex, color, transparent: true, depthWrite: false, blending: opts.add ? T.AdditiveBlending : T.NormalBlending, opacity: opts.opacity || 1 });
    if (opts.hdr) m.color.multiplyScalar(opts.hdr);
    const s = new T.Sprite(m);
    s.position.copy(pos); s.scale.setScalar(size);
    scene.add(s);
    sprites.push({ s, v: vel, life, max: life, grow: opts.grow || 0, grav: opts.grav || 0, drag: opts.drag || 0, size, fade0: opts.opacity || 1 });
}
export function dust(pos, n, strength, color) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 4) * strength;
        spawn(new V3(pos.x + Math.cos(a) * 1.5, pos.y + 0.3, pos.z + Math.sin(a) * 1.5), new V3(Math.cos(a) * sp, 1.5 + Math.random() * 2, Math.sin(a) * sp),
            color || 0xe8e8f0, 0.8 + Math.random() * 0.6, 0.45 + Math.random() * 0.25, { grow: 1.8, drag: 3.5, opacity: 0.45 });
    }
}
// Tyre smoke while drifting or burning out: grey puffs that swell and drift up
export function tireSmoke(pos, strength, color) {
    spawn(new V3(pos.x + (Math.random() - 0.5) * 0.6, pos.y + 0.4, pos.z + (Math.random() - 0.5) * 0.6), new V3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3),
        color || 0xd8d8e0, 0.9 + Math.random() * 0.5, 0.7 + Math.random() * 0.4, { grow: 2.6 * strength, drag: 2, opacity: 0.38 * strength });
}
// Drift sparks from the rear wheels in the mini-turbo colour (blue, orange, purple)
export function driftSpark(pos, color, back) {
    const v = new V3(back.x * (6 + Math.random() * 8) + (Math.random() - 0.5) * 6, 3 + Math.random() * 5, back.z * (6 + Math.random() * 8) + (Math.random() - 0.5) * 6);
    spawn(new V3(pos.x, pos.y + 0.2, pos.z), v, color, 0.22 + Math.random() * 0.18, 0.25 + Math.random() * 0.2, { add: true, hdr: 2.6, grav: 30, star: Math.random() < 0.3 });
}
// Nitro / boost flame out of an exhaust tip (dir = backwards), blue-white for nitro, orange for fire
export function exhaustFlame(at, dir, kind, size) {
    const nitro = kind === 'nitro';
    const v = dir.clone().multiplyScalar(10 + Math.random() * 8);
    v.x += (Math.random() - 0.5) * 2; v.y += Math.random() * 2; v.z += (Math.random() - 0.5) * 2;
    const col = nitro ? (Math.random() < 0.5 ? 0x5ad8ff : Math.random() < 0.6 ? 0x9a7aff : 0xffffff) : (Math.random() < 0.45 ? 0xff5a14 : Math.random() < 0.6 ? 0xffb51c : 0xfff0a0);
    spawn(at.clone(), v, col, (size || 1) * (0.5 + Math.random() * 0.4), 0.14 + Math.random() * 0.12, { add: true, hdr: 1.3, grow: -0.6, drag: 2, opacity: 0.85 });
}
// Little exhaust puffs at idle and cruise
export function exhaustPuff(at, dir) {
    spawn(at.clone().addScaledVector(dir, 0.4), dir.clone().multiplyScalar(2.5 + Math.random() * 2).add(new V3(0, 1.4, 0)), 0x5a5a64, 0.22 + Math.random() * 0.12, 0.55, { grow: 2.4, drag: 1.5, opacity: 0.2 });
}
// Sparks when scraping a wall
export function wallSparks(pos, n) {
    for (let i = 0; i < (n || 8); i++) {
        spawn(new V3(pos.x, pos.y + 1 + Math.random(), pos.z), new V3((Math.random() - 0.5) * 16, 4 + Math.random() * 8, (Math.random() - 0.5) * 16),
            Math.random() < 0.5 ? 0xffd028 : 0xffffff, 0.2 + Math.random() * 0.15, 0.3 + Math.random() * 0.2, { add: true, hdr: 2.4, grav: 40 });
    }
}
export function sparkleColumn(pos, color) {
    for (let i = 0; i < 20; i++) {
        const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 1.5;
        spawn(new V3(pos.x + Math.cos(a) * r, pos.y + Math.random() * 2, pos.z + Math.sin(a) * r), new V3(0, 8 + Math.random() * 8, 0),
            color, 0.45 + Math.random() * 0.35, 0.7 + Math.random() * 0.4, { add: true, hdr: 1.6, drag: 0.6, star: true });
    }
}
// Electric sparks around the lightning kart
export function zapSparks(pos, color) {
    spawn(new V3(pos.x + (Math.random() - 0.5) * 4, pos.y + 0.6 + Math.random() * 1.6, pos.z + (Math.random() - 0.5) * 5), new V3((Math.random() - 0.5) * 10, Math.random() * 6, (Math.random() - 0.5) * 10),
        color, 0.18 + Math.random() * 0.14, 0.15 + Math.random() * 0.1, { add: true, hdr: 2.8, star: true });
}
export function flame(at, spread, size, vel) {
    const p = new V3(at.x + (Math.random() - 0.5) * spread, at.y + (Math.random() - 0.5) * spread * 0.5, at.z + (Math.random() - 0.5) * spread);
    const v = vel ? vel.clone().multiplyScalar(0.7 + Math.random() * 0.6) : new V3(0, 0, 0);
    v.x += (Math.random() - 0.5) * 3; v.y += 3 + Math.random() * 5; v.z += (Math.random() - 0.5) * 3;
    spawn(p, v, Math.random() < 0.45 ? 0xff5a14 : Math.random() < 0.6 ? 0xffb51c : 0xfff0a0,
        (size || 1.4) * (0.7 + Math.random() * 0.6), 0.45 + Math.random() * 0.35, { add: true, hdr: 1.3, grow: -0.5, drag: 1.5, opacity: 0.95 });
}
// Speed roller sparkles in the roller's colour; the faster ones fizz harder
export function emitTread(at, mult, len, width, color) {
    const p = new V3(at.x + (Math.random() - 0.5) * width, at.y, at.z + (Math.random() - 0.5) * len);
    if (mult >= 100) {
        const c = mult >= 200 ? new T.Color().setHSL(Math.random(), 1, 0.6).getHex() : color;
        spawn(p, new V3((Math.random() - 0.5) * 3, 6 + Math.random() * 6, (Math.random() - 0.5) * 3), c, 0.5 + Math.random() * 0.5, 0.5 + Math.random() * 0.4, { add: true, hdr: 1.8, grow: -0.4, star: Math.random() < 0.4 });
    } else if (mult >= 12) {
        spawn(p.setY(at.y + Math.random() * 2.5), new V3((Math.random() - 0.5) * 6, (Math.random() - 0.2) * 5, (Math.random() - 0.5) * 6), color, 0.35 + Math.random() * 0.3, 0.25 + Math.random() * 0.15, { add: true, hdr: 1.6 });
    } else {
        spawn(p.setY(at.y + Math.random() * 3), new V3(0, 1 + Math.random() * 2, 0), Math.random() < 0.6 ? 0xffffff : color, 0.3 + Math.random() * 0.35, 0.6 + Math.random() * 0.5, { add: true, hdr: 1.4, star: true });
    }
}

// Trail ribbon streaming from the back of the kart (rainbow trails cycle their colour)
export function makeTrail(color) {
    const N = 30, pts = [];
    const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 3);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    mesh.frustumCulled = false;
    scene.add(mesh);
    const c = new T.Color(color), tmp = new T.Color();
    let acc = 0;
    return {
        color, rainbow: false, width: 0.5,
        setColor(hex, rainbow) { this.color = hex; this.rainbow = !!rainbow; c.set(hex); },
        update(at, on, dt, t) {
            acc += dt;
            if (acc >= 0.025) {
                acc = 0;
                if (on) pts.unshift(at.clone()); else pts.pop();
                if (pts.length > N) pts.length = N;
            }
            if (pts.length && on) pts[0].copy(at);
            for (let i = 0; i < N; i++) {
                const p = pts[Math.min(i, pts.length - 1)];
                const k = pts.length > 1 ? 1 - i / (pts.length - 1) : 0;
                const h = i < pts.length ? this.width * (0.35 + 0.65 * k) : 0;
                if (this.rainbow) tmp.setHSL(((t || 0) * 0.4 + i / N) % 1, 1, 0.6); else tmp.copy(c);
                for (let s = 0; s < 2; s++) {
                    const o = (i * 2 + s) * 3;
                    if (p) { pos[o] = p.x; pos[o + 1] = p.y + (s ? h : -h); pos[o + 2] = p.z; }
                    col[o] = tmp.r * k * 1.3; col[o + 1] = tmp.g * k * 1.3; col[o + 2] = tmp.b * k * 1.3;
                }
            }
            geo.attributes.position.needsUpdate = true;
            geo.attributes.color.needsUpdate = true;
            mesh.visible = pts.length > 1;
        },
        dispose() { scene.remove(mesh); geo.dispose(); mesh.material.dispose(); },
    };
}

// ----- skid marks: a ring buffer of dark quads on the road that fade out over 9 seconds -----
const SKID_N = 900;
const skidPos = new Float32Array(SKID_N * 4 * 3), skidBirth = new Float32Array(SKID_N * 4).fill(-99);
const skidGeo = new T.BufferGeometry();
skidGeo.setAttribute('position', new T.BufferAttribute(skidPos, 3));
skidGeo.setAttribute('aBirth', new T.BufferAttribute(skidBirth, 1));
{
    const idx = new Uint32Array(SKID_N * 6);
    for (let i = 0; i < SKID_N; i++) { const a = i * 4; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
    skidGeo.setIndex(new T.BufferAttribute(idx, 1));
}
const skidMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'attribute float aBirth; uniform float uTime; varying float vA; void main() { vA = 0.5 * (1.0 - clamp((uTime - aBirth) / 9.0, 0.0, 1.0)); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying float vA; void main() { gl_FragColor = vec4(0.06, 0.06, 0.08, vA); }',
});
const skids = new T.Mesh(skidGeo, skidMat);
skids.frustumCulled = false;
skids.renderOrder = 1;
scene.add(skids);
let skidI = 0, skidClock = 0;
export function addSkid(a, b, w) {
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    if (l < 0.05 || l > 12) return;
    const nx = -dz / l * w / 2, nz = dx / l * w / 2;
    const o = skidI * 12;
    skidPos.set([a.x + nx, a.y + 0.04, a.z + nz, a.x - nx, a.y + 0.04, a.z - nz, b.x + nx, b.y + 0.04, b.z + nz, b.x - nx, b.y + 0.04, b.z - nz], o);
    skidBirth.fill(skidClock, skidI * 4, skidI * 4 + 4);
    skidGeo.attributes.position.addUpdateRange(o, 12);
    skidGeo.attributes.aBirth.addUpdateRange(skidI * 4, 4);
    skidGeo.attributes.position.needsUpdate = true;
    skidGeo.attributes.aBirth.needsUpdate = true;
    skidI = (skidI + 1) % SKID_N;
}

// Expanding neon ring on the ground (level up, big landings)
const rings = [];
export function ring(pos, color, maxR, life) {
    const m = new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: T.DoubleSide });
    m.color.multiplyScalar(2.2);
    const mesh = new T.Mesh(new T.RingGeometry(0.8, 1, 48), m);
    mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos).setY(pos.y + 0.2);
    scene.add(mesh);
    rings.push({ mesh, t: 0, life: life || 0.7, maxR: maxR || 9 });
}

// Fireworks: a glowing rocket that bursts into coloured sparks
const rockets = [];
const FW_COLORS = [0xffd028, 0x46ec50, 0x28c8ff, 0xff3fa0, 0xc428ff, 0xff6e14];
export function fireworks(center, count, onBurst) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 10;
        rockets.push({
            p: new V3(center.x + Math.cos(a) * r, center.y + 1, center.z + Math.sin(a) * r),
            v: new V3((Math.random() * 2 - 1) * 3, 34 + Math.random() * 10, (Math.random() * 2 - 1) * 3),
            t: 0.7 + Math.random() * 0.3 + i * 0.18, trail: 0, color: FW_COLORS[(Math.random() * FW_COLORS.length) | 0], onBurst,
        });
    }
}
function burstFw(p, color) {
    for (let i = 0; i < 46; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const sp = 16 + Math.random() * 8;
        spawn(p.clone(), new V3(s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp), i % 5 ? color : 0xffffff, 0.9 + Math.random() * 0.5, 1.1 + Math.random() * 0.5, { add: true, hdr: 2.5, grav: 14, drag: 1.4, star: i % 4 === 0 });
    }
}

export function updateFx(dt) {
    skidClock += dt;
    skidMat.uniforms.uTime.value = skidClock;
    for (let i = sprites.length - 1; i >= 0; i--) {
        const p = sprites[i];
        p.life -= dt;
        if (p.life <= 0) { scene.remove(p.s); p.s.material.dispose(); sprites.splice(i, 1); continue; }
        p.v.y -= p.grav * dt;
        if (p.drag) p.v.multiplyScalar(Math.exp(-p.drag * dt));
        p.s.position.addScaledVector(p.v, dt);
        const k = p.life / p.max;
        p.s.material.opacity = p.fade0 * Math.min(1, k * 2);
        if (p.grow) p.s.scale.setScalar(Math.max(0.05, p.size * (1 + p.grow * (1 - k))));
    }
    for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.t += dt;
        const k = r.t / r.life;
        if (k >= 1) { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); rings.splice(i, 1); continue; }
        const e = 1 - Math.pow(1 - k, 3);
        r.mesh.scale.setScalar(1 + e * r.maxR);
        r.mesh.material.opacity = 1 - k;
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.v.y -= 20 * dt;
        r.p.addScaledVector(r.v, dt);
        r.trail -= dt;
        if (r.trail <= 0) { r.trail = 0.03; spawn(r.p.clone(), new V3(0, -2, 0), 0xffe7a8, 0.7, 0.35, { add: true, hdr: 2 }); }
        r.t -= dt;
        if (r.t <= 0) { burstFw(r.p, r.color); if (r.onBurst) r.onBurst(); rockets.splice(i, 1); }
    }
}

// ----- ambient motes: light specks drifting around the camera, tinted by the stage -----
const AMB = 220;
const ambGeo = new T.BufferGeometry();
{
    const pos = new Float32Array(AMB * 3), seed = new Float32Array(AMB);
    for (let i = 0; i < AMB; i++) { pos[i * 3] = Math.random(); pos[i * 3 + 1] = Math.random(); pos[i * 3 + 2] = Math.random(); seed[i] = Math.random(); }
    ambGeo.setAttribute('position', new T.BufferAttribute(pos, 3));
    ambGeo.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
}
const ambMat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new V3() }, uColor: { value: new T.Color(0xffffff) }, uSize: { value: 200 }, uAmt: { value: 0.6 } },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform vec3 uCam; uniform float uSize; varying float vA; varying float vS;
        void main() {
            vec3 box = vec3(90.0, 60.0, 90.0);
            vec3 p = position * box;
            p.y += uTime * (0.8 + aSeed * 1.6);
            p.x += sin(uTime * 0.5 + aSeed * 20.0) * 2.5;
            vec3 rel = mod(p - uCam + box * 0.5, box) - box * 0.5;
            vec4 mv = modelViewMatrix * vec4(uCam + rel, 1.0);
            gl_Position = projectionMatrix * mv;
            float tw = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed * 3.0) + aSeed * 40.0);
            vA = tw * smoothstep(44.0, 14.0, length(rel)) * smoothstep(2.0, 6.0, length(rel));
            vS = aSeed;
            gl_PointSize = uSize * (0.35 + aSeed * 0.65) * (0.6 + tw * 0.4) / max(1.0, -mv.z);
        }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAmt; varying float vA; varying float vS;
        void main() {
            vec2 q = gl_PointCoord - 0.5;
            float core = pow(max(0.0, 1.0 - length(q) * 2.0), 2.0);
            vec3 c = mix(uColor, vec3(1.0), 0.45 + 0.3 * sin(vS * 31.0));
            gl_FragColor = vec4(c * 1.4, core * vA * uAmt);
        }`,
});
const ambient = new T.Points(ambGeo, ambMat);
ambient.frustumCulled = false;
ambient.renderOrder = 5;
scene.add(ambient);
const ambTmp = new T.Color();
export function updateAmbient(camPos, t, color, amt) {
    ambMat.uniforms.uTime.value = t;
    ambMat.uniforms.uCam.value.copy(camPos);
    ambMat.uniforms.uColor.value.lerp(ambTmp.set(color), 0.03);
    ambMat.uniforms.uAmt.value += ((amt ?? 0.6) - ambMat.uniforms.uAmt.value) * 0.03;
}

applyQuality();
