import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const T = THREE;
export const V3 = THREE.Vector3;
export const $ = (s) => document.querySelector(s);
export const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');

// ----- renderer, scene, camera, lights -----
export const canvas = $('#view');
export const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;

export const scene = new T.Scene();
export const FOG = 0xbfe0ff;
scene.fog = new T.Fog(FOG, 320, 1700);
scene.background = new T.Color(FOG);

// ----- sky: a bright Roblox-blue dome that follows the camera -----
// Light haze at the horizon (pulled toward the colour of the stage you are in), deep blue overhead,
// a warm sun with a soft halo and drifting cloud bands. Night stages (city, lava, glitch) fade it
// to a starry indigo.
const SUN_DIR = new T.Vector3(0.38, 0.62, -0.68).normalize();
const skyMat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    uniforms: { uNight: { value: 0 }, uSun: { value: SUN_DIR }, uTime: { value: 0 }, uTint: { value: new T.Color(FOG) } },
    vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform float uNight; uniform vec3 uSun; uniform float uTime; uniform vec3 uTint; varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1, 0), 1.0)), c = hash(vec3(i + vec2(0, 1), 1.0)), d = hash(vec3(i + vec2(1, 1), 1.0));
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
        void main() {
            vec3 d = normalize(vDir);
            float n = clamp(uNight, 0.0, 1.0);
            vec3 zen = mix(vec3(0.16, 0.42, 0.95), vec3(0.03, 0.03, 0.14), n);
            vec3 hor = mix(mix(vec3(0.78, 0.9, 1.0), uTint, 0.35), mix(vec3(0.2, 0.12, 0.36), uTint * 0.5, 0.5), n);
            vec3 low = mix(vec3(0.62, 0.72, 0.86), vec3(0.05, 0.04, 0.12), n);
            float h = d.y;
            vec3 col = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor, low, pow(-h, 0.4));
            // Cloud bands: two layers of soft noise drifting across the upper sky
            if (h > 0.02) {
                vec2 uv = d.xz / (h + 0.25);
                float c = vnoise(uv * 2.2 + vec2(uTime * 0.012, 0.0)) * 0.6 + vnoise(uv * 5.0 - vec2(uTime * 0.02, uTime * 0.006)) * 0.4;
                c = smoothstep(0.55, 0.85, c) * smoothstep(0.02, 0.25, h) * (1.0 - n * 0.7);
                col = mix(col, mix(vec3(1.0), vec3(0.4, 0.35, 0.6), n), c * 0.75);
            }
            float s = max(dot(d, uSun), 0.0);
            col += vec3(1.0, 0.94, 0.8) * (pow(s, 800.0) * 4.0 + pow(s, 50.0) * 0.35 + pow(s, 6.0) * 0.12) * (1.0 - n);
            vec3 q = floor(d * 360.0);
            float st = step(0.996, hash(q)) * n * smoothstep(-0.05, 0.3, h);
            col += vec3(1.0, 0.95, 1.0) * st * (0.6 + 0.4 * sin(uTime * 2.0 + hash(q + 3.1) * 40.0));
            gl_FragColor = vec4(col, 1.0);
        }`,
});
const skyDome = new T.Mesh(new T.SphereGeometry(3000, 32, 16), skyMat);
skyDome.renderOrder = -10;
skyDome.frustumCulled = false;
scene.add(skyDome);
const fogDay = new T.Color(FOG), fogNight = new T.Color(0x1a1438), fogTmp = new T.Color();
let nightNow = 0;
// tint: the haze colour of the stage the camera is in; night: 0 day .. 1 night
export function updateSky(pos, t, tint, night, dt) {
    nightNow += ((night || 0) - nightNow) * Math.min(1, dt * 1.2);
    skyMat.uniforms.uNight.value = nightNow;
    skyMat.uniforms.uTime.value = t;
    skyMat.uniforms.uTint.value.lerp(tint, Math.min(1, dt * 1.5));
    skyDome.position.copy(pos);
    fogTmp.copy(fogDay).lerp(skyMat.uniforms.uTint.value, 0.35).lerp(fogNight.clone().lerp(skyMat.uniforms.uTint.value, 0.25), nightNow * 0.9);
    scene.fog.color.copy(fogTmp);
    scene.background.copy(fogTmp);
    hemi.intensity = 0.95 - nightNow * 0.35;
    sun.intensity = 1.55 - nightNow * 0.75;
}
export const SUN_DIRECTION = SUN_DIR;

export const camera = new T.PerspectiveCamera(70, 1, 0.3, 2600);
function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 85 : 70;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Image-based light from a soft studio room, so the glossy karts get reflections on every side;
// the sun adds direction and soft shadows on top
{
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.6;
    pm.dispose();
}
const hemi = new T.HemisphereLight(0xeaf4ff, 0x7a7090, 0.95);
scene.add(hemi);
export const sun = new T.DirectionalLight(0xfff2e0, 1.55);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 380 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

// ----- materials & textures -----
export const UNIT = new T.BoxGeometry(1, 1, 1);
// Neon is pushed well above 1.0 so only it crosses the bloom threshold (fx.js)
export const NEON_BOOST = 3.0;
const matCache = new Map();
// Plastic-like PBR (Roblox "SmoothPlastic"): a little sheen from the environment, no metal
export function mat(color, o) {
    o = o || {};
    const key = color + '|' + (o.neon ? 1 : 0) + '|' + (o.opacity || 1) + '|' + (o.rough ?? '') + '|' + (o.side || 0) + '|' + (o.boost || 0);
    let m = matCache.get(key);
    if (!m) {
        m = o.neon ? new T.MeshBasicMaterial({ color }) : new T.MeshStandardMaterial({ color, roughness: o.rough ?? 0.55, metalness: 0 });
        if (o.neon) m.color.multiplyScalar(NEON_BOOST * (o.boost ? o.boost / 1.4 : 1));
        if (o.opacity && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
        if (o.side) m.side = T.DoubleSide;
        matCache.set(key, m);
    }
    return m;
}
// Glossy plastic (cones, barriers, lobby furniture); clear = lacquered, emissive = glows a little
export function gloss(color, o) {
    o = o || {};
    const key = 'gloss|' + color + '|' + (o.rough ?? 0.25) + '|' + (o.clear ? 1 : 0) + '|' + (o.emissive || 0) + '|' + (o.emissiveIntensity || 0) + '|' + (o.metal || 0);
    let m = matCache.get(key);
    if (!m) {
        m = o.clear
            ? new T.MeshPhysicalMaterial({ color, roughness: o.rough ?? 0.18, metalness: o.metal || 0, clearcoat: 1, clearcoatRoughness: 0.1 })
            : new T.MeshStandardMaterial({ color, roughness: o.rough ?? 0.25, metalness: o.metal || 0 });
        if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 0.6; }
        matCache.set(key, m);
    }
    return m;
}
// Car paint: clear-coated, a little metallic
export function paint(color, o) {
    o = o || {};
    const key = 'paint|' + color + '|' + (o.metal ?? 0.3) + '|' + (o.rough ?? 0.32);
    let m = matCache.get(key);
    if (!m) {
        m = new T.MeshPhysicalMaterial({ color, metalness: o.metal ?? 0.3, roughness: o.rough ?? 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
        matCache.set(key, m);
    }
    return m;
}
export function chrome(color) {
    const key = 'chrome|' + (color || 0);
    let m = matCache.get(key);
    if (!m) {
        m = new T.MeshStandardMaterial({ color: color || 0xe2e6ee, metalness: 1, roughness: 0.16 });
        matCache.set(key, m);
    }
    return m;
}
export function glass(color, opacity) {
    const key = 'glass|' + color + '|' + opacity;
    let m = matCache.get(key);
    if (!m) {
        m = new T.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.05, transparent: true, opacity: opacity ?? 0.45, depthWrite: false });
        matCache.set(key, m);
    }
    return m;
}
export function texFrom(cv) {
    const t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

// ----- Roblox studs -----
// One texture tile is 8 x 8 studs. Each stud is a raised square with bevelled edges: a height field
// turned into a normal map, so the studs catch the sun from any angle, plus a soft albedo.
const STUD_TEX = (() => {
    const N = 256, C = 32, INSET = 4, BEVEL = 5;
    const h = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const lx = x % C + 0.5, ly = y % C + 0.5;
        const d = Math.min(lx - INSET, C - INSET - lx, ly - INSET, C - INSET - ly);
        h[y * N + x] = d <= 0 ? 0 : Math.min(1, d / BEVEL) ** 0.8;
    }
    const albedo = document.createElement('canvas'); albedo.width = albedo.height = N;
    const normal = document.createElement('canvas'); normal.width = normal.height = N;
    const ai = albedo.getContext('2d').createImageData(N, N), ni = normal.getContext('2d').createImageData(N, N);
    const at = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4, v = at(x, y);
        const lx = x % C, ly = y % C, edge = lx < 1 || ly < 1;
        const g = edge ? 205 : v === 0 ? 226 : 236 + v * 19;
        ai.data[i] = ai.data[i + 1] = ai.data[i + 2] = g; ai.data[i + 3] = 255;
        const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2, dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
        const len = Math.hypot(dx, dy, 1);
        ni.data[i] = Math.round((-dx / len * 0.5 + 0.5) * 255);
        ni.data[i + 1] = Math.round((dy / len * 0.5 + 0.5) * 255);
        ni.data[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
        ni.data[i + 3] = 255;
    }
    albedo.getContext('2d').putImageData(ai, 0, 0);
    normal.getContext('2d').putImageData(ni, 0, 0);
    const map = texFrom(albedo), nrm = new T.CanvasTexture(normal);
    nrm.colorSpace = T.NoColorSpace;
    for (const t of [map, nrm]) { t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); }
    return { map, nrm };
})();
// Studded plastic in a colour, with UVs in world units / 8 (one tile = 8 x 8 studs)
export function studMaterial(color, o) {
    o = o || {};
    const key = 'studpbr|' + color + '|' + (o.rough ?? 0.5) + '|' + (o.emissive || 0);
    let m = matCache.get(key);
    if (!m) {
        m = new T.MeshStandardMaterial({ color, map: STUD_TEX.map, normalMap: STUD_TEX.nrm, normalScale: new T.Vector2(0.9, 0.9), roughness: o.rough ?? 0.5, metalness: 0 });
        if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = 0.35; }
        matCache.set(key, m);
    }
    return m;
}

// ----- world collections -----
export const solids = [];   // {min,max, belt, tread, ice, boost, ramp, mover, zone}
export const kills = [];    // {min,max,active,cause} or {test(pos) -> bool, active, cause}
export const triggers = []; // {min,max,enter,inside}
export const prompts = [];  // {pos,r,label(),act()}
export const tickers = [];  // per-frame callbacks (dt, t)

export function aabb(x, y, z, sx, sy, sz) {
    return { min: new V3(x - sx / 2, y - sy / 2, z - sz / 2), max: new V3(x + sx / 2, y + sy / 2, z + sz / 2) };
}

// ----- text -----
export function textCanvas(lines, W) {
    const pad = 10;
    let H = pad * 2;
    for (const l of lines) H += l.px * 1.2;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = Math.ceil(H);
    const x = cv.getContext('2d');
    let y = pad;
    for (const l of lines) {
        let px = l.px;
        const font = (p) => `${l.w || 700} ${p}px Fredoka, "Arial Rounded MT Bold", sans-serif`;
        x.font = font(px);
        while (x.measureText(l.t).width > W - 24 && px > 8) { px -= 2; x.font = font(px); }
        x.textAlign = 'center'; x.textBaseline = 'middle';
        const cy = y + l.px * 0.62;
        if (l.s) { x.lineJoin = 'round'; x.lineWidth = Math.max(4, px * 0.22); x.strokeStyle = l.s; x.strokeText(l.t, W / 2, cy); }
        if (l.g) {
            const g = x.createLinearGradient(0, cy - px / 2, 0, cy + px / 2);
            g.addColorStop(0, l.g[0]); g.addColorStop(1, l.g[1]);
            x.fillStyle = g;
        } else x.fillStyle = l.c || '#fff';
        x.fillText(l.t, W / 2, cy);
        y += l.px * 1.2;
    }
    return cv;
}
export function billboard(lines, worldW, W, pos, parent) {
    W = W || 512;
    const cv = textCanvas(lines, W);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: texFrom(cv), transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.set(worldW, worldW * cv.height / cv.width, 1);
    if (pos) sp.position.copy(pos);
    sp.userData.set = (nl) => {
        const c2 = textCanvas(nl, W);
        sp.material.map.dispose();
        sp.material.map = texFrom(c2);
        sp.material.needsUpdate = true;
        sp.scale.set(worldW, worldW * c2.height / c2.width, 1);
    };
    (parent || scene).add(sp);
    return sp;
}
export function textPlane(lines, worldW, W, pos, look, parent) {
    const cv = textCanvas(lines, W || 512);
    const h = worldW * cv.height / cv.width;
    const m = new T.Mesh(new T.PlaneGeometry(worldW, h), new T.MeshBasicMaterial({ map: texFrom(cv), transparent: true, depthWrite: false, toneMapped: false }));
    m.position.copy(pos);
    m.lookAt(look);
    (parent || scene).add(m);
    return m;
}

// ----- blocky fallback driver (used until / unless the Bloxity avatar loads) -----
// Built standing with the hips about 2 studs up; kartPose() folds it into the seat.
function buildHair(part, c) {
    part(1.3, 0.35, 1.3, 0, 5.33, -0.02, c);
    part(1.3, 0.75, 0.3, 0, 4.95, -0.5, c);
    part(1.3, 0.16, 0.2, 0, 5.16, 0.56, c);
}
export function buildRig(d) {
    const g = new T.Group();
    const part = (sx, sy, sz, x, y, z, c, parent) => {
        const m = new T.Mesh(UNIT, mat(c)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; (parent || g).add(m); return m;
    };
    part(2, 2, 1, 0, 3, 0, d.shirt);
    part(2.02, 0.12, 1.02, 0, 2.06, 0, d.shorts);
    const head = new T.Group(); g.add(head);
    part(1.2, 1.2, 1.2, 0, 4.6, 0, d.skin, head);
    for (const sx of [-0.26, 0.26]) {
        part(0.26, 0.24, 0.04, sx, 4.72, 0.605, 0xffffff, head);
        part(0.13, 0.18, 0.04, sx + (sx > 0 ? -0.04 : 0.04), 4.71, 0.625, 0x1a1420, head);
    }
    part(0.36, 0.07, 0.04, 0, 4.34, 0.64, 0x6b2a2a, head);
    buildHair((sx, sy, sz, x, y, z, c) => part(sx, sy, sz, x, y, z, c, head), d.hair);
    const legs = [], arms = [];
    for (const side of [-0.5, 0.5]) {
        const p = new T.Group(); p.position.set(side, 2, 0); g.add(p);
        part(1, 0.9, 1, 0, -0.45, 0, d.shorts, p);
        part(0.98, 1.1, 0.98, 0, -1.45, 0, d.socks, p);
        part(1.05, 0.42, 1.34, 0, -1.84, 0.12, 0x141418, p);
        legs.push(p);
    }
    for (const side of [-1.5, 1.5]) {
        const p = new T.Group(); p.position.set(side, 3.9, 0); g.add(p);
        part(1, 0.8, 1, 0, -0.4, 0, d.shirt, p);
        part(0.98, 1.2, 0.98, 0, -1.4, 0, d.skin, p);
        arms.push(p);
    }
    g.userData.legs = legs; g.userData.arms = arms; g.userData.head = head;
    return g;
}
// Merges a blocky rig into a few meshes: the body, the head and each limb (they still animate)
export function mergeRig(g) {
    const u = g.userData, parts = [...u.legs, ...u.arms, u.head];
    for (const p of parts) p.userData.dyn = true;
    mergeChildren(g);
    for (const p of parts) mergeChildren(p);
    return g;
}
// Sitting in a go-kart: legs straight out to the pedals, hands on the wheel, leaning into turns
export function kartPose(g, steer, t, moving) {
    const u = g.userData;
    u.legs[0].rotation.set(-1.5, 0, -0.08); u.legs[1].rotation.set(-1.5, 0, 0.08);
    const sway = Math.sin(t * (moving ? 16 : 2)) * (moving ? 0.025 : 0.015);
    u.arms[0].rotation.set(-1.15 + sway - steer * 0.25, 0, -0.32); u.arms[1].rotation.set(-1.15 - sway + steer * 0.25, 0, 0.32);
    u.head.rotation.y = -steer * 0.25;
}

// ----- particles & floating text -----
const particles = [];
export function burst(pos, color, size, count) {
    for (let i = 0; i < (count || 26); i++) {
        const m = new T.Mesh(UNIT, mat(i % 3 ? color : 0xffffff));
        m.scale.setScalar((size || 1) * (0.5 + Math.random() * 0.5));
        m.position.copy(pos);
        scene.add(m);
        particles.push({ m, v: new V3((Math.random() * 2 - 1) * 25, Math.random() * 30 + 5, (Math.random() * 2 - 1) * 25), t: 1.2 });
    }
}
export function confettiAt(pos) {
    for (const c of [0xffd028, 0x46ec50, 0x28c8ff, 0xff5ab8, 0xc428ff]) burst(pos, c, 0.4, 12);
}
const floaters = [];
export function floatText(text, color, pos, size, parent) {
    const sp = billboard([{ t: text, c: color, s: '#141a2e', px: 70 }], size || 5, 512, pos, parent);
    floaters.push({ sp, t: 1.1 });
}
export function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.t -= dt; p.v.y -= 80 * dt;
        p.m.position.addScaledVector(p.v, dt);
        p.m.rotation.x += dt * 5; p.m.rotation.y += dt * 4;
        if (p.t <= 0) { scene.remove(p.m); particles.splice(i, 1); }
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.t -= dt; f.sp.position.y += dt * 4; f.sp.material.opacity = Math.min(1, f.t * 2);
        if (f.t <= 0) { f.sp.parent && f.sp.parent.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); floaters.splice(i, 1); }
    }
}

export function lerpAngle(a, b, k) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
}
export const angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

// Merges every mesh under root into one mesh per material, so a kart or a car that is built from
// dozens of boxes draws in a handful of calls. Subtrees marked userData.dyn (wheels, the steering
// wheel, flashing lights) are left alone so they can still move on their own.
export function mergeChildren(root) {
    root.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(root.matrixWorld).invert(), m4 = new T.Matrix4();
    const buckets = new Map(), done = [];
    const visit = (o, fn) => { fn(o); for (const c of o.children) if (!c.userData.dyn) visit(c, fn); };
    visit(root, (o) => {
        if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.userData.keep) return;
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.uv) return;
        g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
        if (!buckets.has(o.material)) buckets.set(o.material, { list: [], shadow: false });
        const b = buckets.get(o.material);
        b.list.push(g); b.shadow = b.shadow || o.castShadow;
        done.push(o);
    });
    for (const o of done) o.parent.remove(o);
    for (const [material, b] of buckets) {
        const mesh = new T.Mesh(mergeGeometries(b.list), material);
        mesh.castShadow = b.shadow;
        root.add(mesh);
        for (const g of b.list) g.dispose();
    }
}
