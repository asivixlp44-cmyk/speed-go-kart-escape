import { T, UNIT, mat, paint, chrome, glass, gloss, mergeChildren } from './engine.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { plankTexture, treadTexture, galaxyTexture, carbonTexture, decalTexture, stripeTexture } from './textures.js';

// Procedural go-karts, facing +z with the wheels on y = 0. A shared chassis (floor pan, bumpers,
// axles, bucket seat, steering wheel, engine and exhaust) and per-style bodywork: plank crates for
// the starter kart, fibreglass pods, F1 noses and wings, the police light bar, the excavator's
// bucket, the energy core, the rocket booster. userData: inner (rolls and pitches), wheels,
// steerWheel, exhausts (flame tips), seatY / seatZ (where the driver sits), lights (police).

const RUBBER = 0x1c1c22, DARK = 0x2a2c34, SEAT = 0x18181e;
const TUBE = new T.CylinderGeometry(0.5, 0.5, 1, 12);
const CYL = new T.CylinderGeometry(1, 1, 1, 24);
const texMats = new Map();
function texMat(key, make) { if (!texMats.has(key)) texMats.set(key, make()); return texMats.get(key); }

// Brushed steel: metallic but rough enough not to throw mirror glints at the camera
let steelMat = null;
const steel = () => steelMat || (steelMat = new T.MeshStandardMaterial({ color: 0xa8aebc, metalness: 0.7, roughness: 0.42 }));
function maker(root) {
    return (sx, sy, sz, x, y, z, m, o) => {
        o = o || {};
        const geo = o.round ? new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(o.round, sx / 2 - 0.01, sy / 2 - 0.01, sz / 2 - 0.01)) : UNIT;
        const mesh = new T.Mesh(geo, m);
        if (!o.round) mesh.scale.set(sx, sy, sz);
        mesh.position.set(x, y, z);
        if (o.rx) mesh.rotation.x = o.rx;
        if (o.ry) mesh.rotation.y = o.ry;
        if (o.rz) mesh.rotation.z = o.rz;
        mesh.castShadow = !m.isMeshBasicMaterial;
        (o.parent || root).add(mesh);
        return mesh;
    };
}
function tube(parent, a, b, r, m) {
    const va = new T.Vector3(...a), vb = new T.Vector3(...b);
    const mesh = new T.Mesh(TUBE, m);
    mesh.position.copy(va).add(vb).multiplyScalar(0.5);
    mesh.scale.set(r * 2, va.distanceTo(vb), r * 2);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
}
// Disc with its axis along x
function disc(parent, r, w, x, y, z, m) {
    const mesh = new T.Mesh(CYL, m);
    mesh.scale.set(r, w, r); mesh.rotation.z = Math.PI / 2; mesh.position.set(x, y, z);
    mesh.castShadow = !m.isMeshBasicMaterial;
    parent.add(mesh);
    return mesh;
}

// Wheel: a steering pivot (front wheels yaw) holding a spinning group: treaded tyre, painted rim,
// chrome hub and five spokes on the outside face
function wheel(parent, r, w, x, z, rimM, front) {
    const pivot = new T.Group(); pivot.position.set(x, r, z); pivot.userData.dyn = true; parent.add(pivot);
    const spin = new T.Group(); pivot.add(spin);
    const tireM = texMat('tire', () => { const m = new T.MeshStandardMaterial({ color: 0xffffff, map: treadTexture().clone(), roughness: 0.85 }); m.map.repeat.set(5, 1); m.map.needsUpdate = true; return m; });
    const tyre = new T.Mesh(new T.CylinderGeometry(r, r, w, 28, 1), tireM);
    tyre.rotation.z = Math.PI / 2; tyre.castShadow = true; spin.add(tyre);
    const out = Math.sign(x) || 1;
    disc(spin, r * 0.6, w + 0.05, 0, 0, 0, rimM);
    disc(spin, r * 0.22, w + 0.16, 0, 0, 0, steel());
    for (let i = 0; i < 5; i++) {
        const s = new T.Mesh(UNIT, rimM);
        s.scale.set(0.06, r * 1.08, 0.13); s.position.x = out * (w / 2 + 0.03); s.rotation.x = i / 5 * Math.PI;
        spin.add(s);
    }
    return { pivot, spin, r, front };
}

// Style switches: pods, nose, wing, rims, seat colour, extras
const STYLE = {
    wooden: { pods: 'plank', nose: 'crate', rims: 0x24345a, seat: 'crate', engine: 'plain' },
    diy: { pods: 'plank', nose: 'crate', rims: 0x24345a, seat: 'box', tape: true, engine: 'plain', odd: true },
    classic: { pods: 'round', nose: 'round', rims: 0xffffff, stripe: true, num: '1' },
    sport: { pods: 'round', nose: 'sleek', rims: 0x1a1a24, stripe: true, num: '7', wing: 'small' },
    street: { pods: 'wide', nose: 'sleek', rims: 0x1a1a24, low: true, fenders: true },
    excavator: { pods: 'round', nose: 'bucket', rims: 0x22222a, hazard: true, beacon: true },
    racer: { pods: 'slim', nose: 'f1', rims: 0xffffff, num: '9', wing: 'big' },
    hyper: { pods: 'wedge', nose: 'wedge', rims: 0x1a1a24, fins: true, wing: 'big' },
    police: { pods: 'round', nose: 'round', rims: 0xd8d8e0, lightbar: true, num: '12' },
    flame: { pods: 'wedge', nose: 'sleek', rims: 0x1a1a24, flames: true, pipes: 2 },
    pro: { pods: 'slim', nose: 'f1', rims: 0xe8102a, halo: true, num: '1', wing: 'big' },
    ninja: { pods: 'wedge', nose: 'wedge', rims: 0x16141e, blades: true },
    energy: { pods: 'round', nose: 'sleek', rims: 0x2a0a5a, core: true },
    lightning: { pods: 'wedge', nose: 'sleek', rims: 0x1a1a24, bolts: true, wing: 'small' },
    golden: { pods: 'round', nose: 'sleek', rims: 0xffe68a, trophy: true, wing: 'big' },
    galaxy: { pods: 'wedge', nose: 'f1', rims: 0x1a1030, wing: 'big' },
    rocket: { pods: 'round', nose: 'sleek', rims: 0xffffff, rocket: true },
};

// o.static: a display kart (showroom) that never moves its parts: it merges into a few meshes
export function buildKart(d, o) {
    o = o || {};
    if (d.super) return buildSuper(d, o);
    const g = new T.Group();
    const inner = new T.Group(); g.add(inner);
    const part = maker(inner);
    const st = STYLE[d.style] || STYLE.classic;
    // Body material: planks, galaxy paint, gold chrome or clear-coated paint
    let body;
    if (st.pods === 'plank') body = texMat('plank|' + d.body, () => new T.MeshStandardMaterial({ color: 0xffffff, map: plankTexture(d.body), roughness: 0.75 }));
    else if (d.galaxy) body = texMat('galaxy', () => new T.MeshPhysicalMaterial({ color: 0xffffff, map: galaxyTexture(), roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }));
    else if (d.gold) body = chrome(0xffc828);
    else body = paint(d.body, { metal: d.body === 0xffffff ? 0.1 : 0.35 });
    const accent = d.glow ? mat(d.glow, { neon: true }) : paint(d.accent, { metal: 0.2 });
    const accentPaint = paint(d.accent, { metal: 0.2 });
    const dark = mat(DARK, { rough: 0.6 }), metal = steel();
    const carbon = texMat('carbon', () => { const t = carbonTexture().clone(); t.repeat.set(3, 6); t.needsUpdate = true; return new T.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.35, metalness: 0.3 }); });
    const low = st.low ? -0.12 : 0;

    // ----- chassis -----
    part(3.1, 0.22, 5.8, 0, 0.42 + low, 0, st.pods === 'plank' ? dark : carbon);
    tube(inner, [-1.9, 0.55 + low, 3.15], [1.9, 0.55 + low, 3.15], 0.13, st.pods === 'plank' ? dark : metal);   // front bumper
    for (const s of [-1, 1]) tube(inner, [s * 1.9, 0.55 + low, 3.15], [s * 1.55, 0.5 + low, 2.4], 0.11, st.pods === 'plank' ? dark : metal);
    part(3.6, 0.45, 0.4, 0, 0.62 + low, -3.05, dark, { round: 0.15 });                                        // rear bumper
    tube(inner, [-2.05, 0.72, -2.0], [2.05, 0.72, -2.0], 0.1, dark);                                          // rear axle
    // Wheels: fat at the back, narrower up front
    const rimM = d.gold ? chrome(0xffe68a) : st.rims === 0xffffff ? chrome(0xf4f4f8) : paint(st.rims, { metal: 0.5, rough: 0.3 });
    const wheels = [
        wheel(inner, 0.62, 0.72, -1.95, 2.25, rimM, true), wheel(inner, 0.62, 0.72, 1.95, 2.25, st.odd ? paint(0xe8283a) : rimM, true),
        wheel(inner, 0.74, 1.0, -2.05, -2.0, rimM, false), wheel(inner, 0.74, 1.0, 2.05, -2.0, rimM, false),
    ];

    // ----- seat -----
    const seatY = 1.02 + low, seatZ = -0.85;
    if (st.seat === 'crate') {
        part(1.8, 0.6, 1.6, 0, 0.75 + low, -0.9, body);
        part(1.8, 1.6, 0.35, 0, 1.5 + low, -1.75, body, { rx: -0.12 });
    } else if (st.seat === 'box') {
        part(1.8, 0.6, 1.6, 0, 0.75 + low, -0.9, gloss(0xc8964a, { rough: 0.85 }));
        part(1.8, 1.6, 0.3, 0, 1.5 + low, -1.75, gloss(0xc8964a, { rough: 0.85 }), { rx: -0.12 });
    } else {
        const seatM = gloss(SEAT, { rough: 0.5 });
        part(1.7, 0.4, 1.5, 0, 0.78 + low, -0.9, seatM, { round: 0.18 });
        part(1.7, 1.8, 0.35, 0, 1.6 + low, -1.72, seatM, { round: 0.16, rx: -0.15 });
        for (const s of [-1, 1]) part(0.25, 1.1, 1.3, s * 0.92, 1.15 + low, -1.1, seatM, { round: 0.1 });
    }

    // ----- steering -----
    tube(inner, [0, 0.8 + low, 1.75], [0, 1.85 + low, 0.92], 0.08, dark);
    const steerWheel = new T.Group(); steerWheel.position.set(0, 1.9 + low, 0.88); steerWheel.rotation.x = -0.75; steerWheel.userData.dyn = true; inner.add(steerWheel);
    const ring = new T.Mesh(new T.TorusGeometry(0.42, 0.07, 8, 24), gloss(0x16161c, { rough: 0.4 }));
    ring.castShadow = true; steerWheel.add(ring);
    for (const a of [0, 2.1, 4.2]) { const sp = new T.Mesh(UNIT, dark); sp.scale.set(0.06, 0.42, 0.05); sp.position.set(Math.sin(a) * 0.2, Math.cos(a) * 0.2, 0); sp.rotation.z = -a; steerWheel.add(sp); }
    const hub = new T.Mesh(UNIT, st.pods === 'plank' ? dark : accentPaint); hub.scale.set(0.2, 0.2, 0.08); steerWheel.add(hub);

    // ----- engine and exhausts -----
    part(1.0, 0.9, 1.1, 0.95, 1.0 + low, -2.25, mat(0x3a3c46, { rough: 0.5 }), { round: 0.12 });
    for (let i = 0; i < 3; i++) part(1.12, 0.07, 1.0, 0.95, 1.18 + low + i * 0.2, -2.25, metal);
    const exhausts = [];
    const pipes = st.pipes || 1;
    for (let k = 0; k < pipes; k++) {
        const x = pipes === 2 ? (k ? 0.95 : -0.95) : 0.55;
        tube(inner, [x, 1.1 + low, -2.3], [x, 1.3 + low, -3.35], 0.15, metal);
        const tip = new T.Object3D(); tip.position.set(x, 1.32 + low, -3.45); inner.add(tip); exhausts.push(tip);
    }

    // ----- bodywork -----
    if (st.pods === 'plank') {
        for (const s of [-1, 1]) part(0.36, 0.95, 3.6, s * 1.72, 0.98 + low, 0.05, body);
        part(2.9, 0.95, 1.3, 0, 0.98 + low, 2.45, body);
        part(2.7, 1.0, 1.0, -0.3, 1.0 + low, -2.35, body);
        part(0.6, 0.6, 0.6, 0, 1.75 + low, 2.5, body, { ry: 0.3 });            // the little crate on the nose
        if (st.tape) {
            const tape = gloss(0xffd028, { rough: 0.5 });
            for (const s of [-1, 1]) part(0.4, 0.2, 3.62, s * 1.72, 1.25 + low, 0.05, tape);
            part(2.92, 0.2, 0.5, 0, 1.25 + low, 2.45, tape);
        }
    } else {
        const podW = st.pods === 'wide' ? 1.25 : st.pods === 'slim' ? 0.75 : 0.95;
        const podH = st.pods === 'slim' ? 0.6 : 0.8;
        for (const s of [-1, 1]) {
            const x = s * (st.pods === 'wide' ? 1.85 : 1.72);
            if (st.pods === 'wedge') {
                part(podW, podH, 3.4, x, 0.92 + low, 0, body, { round: 0.12 });
                part(podW * 0.98, 0.5, 1.4, x, 1.25 + low, -0.9, body, { round: 0.1, rx: 0.3 });
            } else part(podW, podH, 3.4, x, 0.9 + low, 0, body, { round: 0.3 });
            // trim line along the pod
            part(podW + 0.04, 0.1, 3.0, x, 0.98 + low + (st.pods === 'slim' ? 0.1 : 0.2), 0, d.glow ? accent : accentPaint);
            if (st.stripe) part(0.3, 0.06, 3.42, x, 0.9 + low + podH / 2 + 0.01, 0, paint(0xffffff, { metal: 0.1 }));
        }
        // Nose
        if (st.nose === 'round') {
            part(2.7, 0.75, 1.6, 0, 0.88 + low, 2.4, body, { round: 0.3 });
            if (st.stripe) part(0.5, 0.05, 1.62, 0, 1.26 + low, 2.4, paint(0xffffff, { metal: 0.1 }));
        } else if (st.nose === 'sleek') {
            part(2.6, 0.55, 1.9, 0, 0.82 + low, 2.4, body, { round: 0.22 });
            part(1.6, 0.45, 1.4, 0, 1.15 + low, 1.75, body, { round: 0.18, rx: -0.25 });
            if (st.stripe) part(0.4, 0.05, 1.92, 0, 1.1 + low, 2.4, paint(0xffffff, { metal: 0.1 }));
        } else if (st.nose === 'f1') {
            part(1.1, 0.55, 3.0, 0, 0.9 + low, 2.0, body, { round: 0.22 });
            part(4.0, 0.12, 0.8, 0, 0.55 + low, 3.35, accentPaint);
            for (const s of [-1, 1]) part(0.1, 0.5, 0.9, s * 2.0, 0.75 + low, 3.35, body);
        } else if (st.nose === 'wedge') {
            part(2.8, 0.5, 2.0, 0, 0.8 + low, 2.35, body, { round: 0.1, rx: 0.12 });
            part(2.2, 0.08, 1.6, 0, 1.08 + low, 2.25, d.glow ? accent : accentPaint, { rx: 0.12 });
        } else if (st.nose === 'bucket') {
            part(2.6, 0.7, 1.5, 0, 0.9 + low, 2.4, body, { round: 0.2 });
            // Boom arm up from the nose, bucket out front
            tube(inner, [0, 1.2 + low, 2.6], [0, 2.6 + low, 3.6], 0.18, body);
            tube(inner, [0, 2.6 + low, 3.6], [0, 1.6 + low, 4.6], 0.15, body);
            part(2.4, 0.9, 0.9, 0, 1.3 + low, 4.7, mat(0x4a4a52, { rough: 0.5 }), { rx: -0.5 });
            for (let i = -2; i <= 2; i++) part(0.18, 0.3, 0.3, i * 0.5, 0.82 + low, 5.05, metal, { rx: 0.4 });
        }
        if (st.num) {
            const plate = new T.Mesh(new T.PlaneGeometry(0.9, 0.9), new T.MeshBasicMaterial({ map: decalTexture(st.num, '#ffffff'), transparent: true, depthWrite: false, toneMapped: false }));
            plate.position.set(0, (st.nose === 'f1' ? 1.19 : st.nose === 'sleek' ? 1.11 : 1.27) + low, 2.6); plate.rotation.x = -Math.PI / 2;
            inner.add(plate);
        }
    }
    if (st.fenders) for (const s of [-1, 1]) for (const z of [2.25, -2.0]) part(1.1, 0.22, 1.7, s * 2.0, (z > 0 ? 1.38 : 1.6) + low, z, body, { round: 0.1 });
    if (st.hazard) {
        const hz = texMat('hazard', () => { const t = stripeTexture(0x22222a, 0xffc414, 3).clone(); t.repeat.set(3, 1); t.needsUpdate = true; return new T.MeshStandardMaterial({ map: t, roughness: 0.5 }); });
        part(3.62, 0.3, 0.42, 0, 0.62 + low, -3.05, hz);
    }

    // ----- extras -----
    const lights = [];
    if (st.wing) {
        const big = st.wing === 'big';
        for (const s of [-1, 1]) tube(inner, [s * 0.8, 1.0 + low, -2.7], [s * 0.8, (big ? 2.7 : 2.0) + low, -3.0], 0.07, dark);
        part(big ? 4.0 : 3.0, 0.14, big ? 1.0 : 0.7, 0, (big ? 2.75 : 2.05) + low, -3.05, accentPaint, { rx: -0.12 });
        for (const s of [-1, 1]) part(0.1, big ? 0.7 : 0.45, big ? 1.1 : 0.8, s * (big ? 2.0 : 1.5), (big ? 2.65 : 1.98) + low, -3.05, body);
    }
    if (st.fins) for (const s of [-1, 1]) part(0.1, 0.9, 1.2, s * 1.72, 1.6 + low, -1.9, accent, { rx: -0.35 });
    if (st.beacon) {
        tube(inner, [-0.9, 0.9 + low, -1.9], [-0.9, 2.9 + low, -1.9], 0.08, dark);
        const bulb = new T.Mesh(new T.CylinderGeometry(0.25, 0.3, 0.4, 12), mat(0xff8a14, { neon: true }));
        bulb.position.set(-0.9, 3.05 + low, -1.9); inner.add(bulb); lights.push({ m: bulb, kind: 'beacon' });
    }
    if (st.lightbar) {
        for (const s of [-1, 1]) tube(inner, [s * 1.0, 1.0 + low, -1.95], [s * 0.9, 3.4 + low, -1.85], 0.08, dark);
        part(2.4, 0.2, 0.5, 0, 3.45 + low, -1.85, dark);
        const red = new T.Mesh(UNIT, mat(0xff1a2a, { neon: true })), blue = new T.Mesh(UNIT, mat(0x1a5aff, { neon: true }));
        red.scale.set(0.9, 0.3, 0.45); red.position.set(-0.6, 3.68 + low, -1.85); blue.scale.copy(red.scale); blue.position.set(0.6, 3.68 + low, -1.85);
        inner.add(red, blue); lights.push({ m: red, kind: 'red' }, { m: blue, kind: 'blue' });
        for (const s of [-1, 1]) part(0.92, 0.5, 2.5, s * 1.72, 0.92 + low, 0.2, mat(0x14141e, { rough: 0.4 }));
    }
    if (st.flames) {
        const fl = mat(0xff8a14, { neon: true, boost: 1.2 });
        for (const s of [-1, 1]) for (let i = 0; i < 3; i++) part(0.06, 0.32, 0.7 - i * 0.15, s * 2.2, 1.0 + low, 1.0 - i * 0.6, fl, { rx: 0.9 });
    }
    if (st.halo) {
        const halo = new T.Mesh(new T.TorusGeometry(0.85, 0.09, 8, 24, Math.PI), chrome(0x2a2a30));
        halo.position.set(0, 2.55 + low, -0.55); halo.rotation.y = Math.PI / 2; halo.castShadow = true; inner.add(halo);
        tube(inner, [0, 0.95 + low, 1.1], [0, 2.4 + low, 0.25], 0.08, chrome(0x2a2a30));
    }
    if (st.blades) {
        const blade = chrome(0xd8dce8);
        for (const s of [-1, 1]) {
            part(0.05, 0.25, 2.6, s * 2.35, 1.0 + low, 0.4, blade);
            part(0.08, 0.12, 2.6, s * 2.32, 1.15 + low, 0.4, mat(0x9a3aff, { neon: true }));
            part(0.35, 0.4, 0.5, s * 2.2, 1.0 + low, -1.0, mat(0x2a1a3a, { rough: 0.4 }));
        }
    }
    if (st.core) {
        const core = new T.Mesh(new T.SphereGeometry(0.6, 20, 14), mat(0xff5aff, { neon: true, boost: 1.3 }));
        core.position.set(-0.85, 1.75 + low, -2.25); inner.add(core); lights.push({ m: core, kind: 'pulse' });
        const dome = new T.Mesh(new T.SphereGeometry(0.85, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass(0xd8a8ff, 0.35));
        dome.position.set(-0.85, 1.25 + low, -2.25); inner.add(dome);
    }
    if (st.bolts) {
        const bolt = mat(0x5ad8ff, { neon: true, boost: 1.4 });
        for (const s of [-1, 1]) {
            part(0.08, 0.9, 0.3, s * 1.74, 1.6 + low, -0.3, bolt, { rx: 0.5 });
            part(0.08, 0.7, 0.3, s * 1.74, 1.45 + low, 0.15, bolt, { rx: -0.5 });
        }
    }
    if (st.trophy) {
        const cup = new T.Group(); cup.position.set(0, 1.25 + low, 2.65); inner.add(cup);
        const gold = chrome(0xffc828);
        const c1 = new T.Mesh(new T.CylinderGeometry(0.32, 0.12, 0.5, 14), gold); c1.position.y = 0.45; c1.castShadow = true; cup.add(c1);
        const c2 = new T.Mesh(new T.CylinderGeometry(0.08, 0.2, 0.25, 10), gold); c2.position.y = 0.12; cup.add(c2);
    }
    if (st.rocket) {
        const rk = new T.Group(); rk.position.set(0, 1.9 + low, -2.4); rk.rotation.x = Math.PI / 2; inner.add(rk);
        const shell = paint(0xffffff, { metal: 0.3 });
        const b1 = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, 2.4, 20), shell); b1.castShadow = true; rk.add(b1);
        const cone = new T.Mesh(new T.ConeGeometry(0.55, 0.9, 20), paint(d.body)); cone.position.y = 1.65; cone.castShadow = true; rk.add(cone);
        const noz = new T.Mesh(new T.CylinderGeometry(0.35, 0.55, 0.5, 16), metal); noz.position.y = -1.45; rk.add(noz);
        for (let i = 0; i < 3; i++) { const fin = new T.Mesh(UNIT, paint(d.body)); fin.scale.set(0.08, 0.8, 0.6); fin.position.set(Math.cos(i * 2.1) * 0.6, -0.8, Math.sin(i * 2.1) * 0.6); fin.rotation.y = -i * 2.1; rk.add(fin); }
        const tip = new T.Object3D(); tip.position.set(0, 1.9 + low, -3.9); inner.add(tip); exhausts.push(tip);
    }
    // Underglow on the neon karts: a strip under the floor pan and a soft ring on the ground
    let glowRing = null;
    if (d.glow) {
        part(2.6, 0.06, 4.8, 0, 0.3 + low, 0, mat(d.glow, { neon: true }));
        glowRing = new T.Mesh(new T.PlaneGeometry(6.5, 8.5), new T.MeshBasicMaterial({ color: d.glow, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, map: glowTex() }));
        glowRing.material.color.multiplyScalar(1.6);
        glowRing.rotation.x = -Math.PI / 2; glowRing.position.y = 0.06; g.add(glowRing);
    }

    upgradeParts(inner, part, wheels, upgOf(o), { nitroX: -0.75, nitroY: 1.45 + low, nitroZ: -2.35, engX: 0.95, engY: 1.45 + low, engZ: -2.25, stripeX: 1.95, stripeY: 1.25 + low, stripeZ: 0, stripeLen: 3.2 });

    // Static parts become one mesh per material; wheels, steering wheel and lights stay separate
    if (o.static) {
        for (const w of wheels) w.pivot.userData.dyn = false;
        steerWheel.userData.dyn = false;
        mergeChildren(inner);
    } else {
        for (const l of lights) l.m.userData.dyn = true;
        mergeChildren(inner);
        for (const w of wheels) mergeChildren(w.spin);
        mergeChildren(steerWheel);
    }
    // A touch bigger than the driver, like the reference's chunky karts
    const SCALE = 1.15;
    inner.scale.setScalar(SCALE);
    if (glowRing) glowRing.scale.setScalar(SCALE);
    Object.assign(g.userData, {
        inner, wheels, steerWheel, exhausts, lights, glowRing, seatY: seatY * SCALE, seatZ: seatZ * SCALE, def: d, scale: SCALE,
        spin: 0, phase: Math.random() * 6, roll: 0, pitch: 0, steer: 0,
    });
    return g;
}
let glowTexCache = null;
function glowTex() {
    if (glowTexCache) return glowTexCache;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    glowTexCache = new T.CanvasTexture(c);
    return glowTexCache;
}

// Wheels roll with the ground speed, the front wheels and the steering wheel turn, the body rolls
// into turns, squats under throttle and dives under braking, and the engine shakes it a little
export function animateKart(g, dt, o) {
    const u = g.userData;
    u.phase += dt;
    const speed = o.speed || 0;
    u.spin += (speed * dt);
    u.steer += ((o.steer || 0) - u.steer) * Math.min(1, dt * 12);
    for (const w of u.wheels) {
        w.spin.rotation.x = u.spin / (w.r * u.scale);
        if (w.front) w.pivot.rotation.y = u.steer * 0.42;
    }
    u.steerWheel.rotation.z = -u.steer * 1.4;
    const f = Math.min(1, Math.abs(speed) / 40);
    const rollT = o.air ? 0 : -u.steer * f * 0.07 + (o.drift || 0) * 0.06;
    const pitchT = o.air ? -0.06 : clampN((o.accel || 0) * -0.0016, -0.06, 0.05);
    u.roll += (rollT - u.roll) * Math.min(1, dt * 8);
    u.pitch += (pitchT - u.pitch) * Math.min(1, dt * 6);
    const rumble = u.hover ? 0.35 + Math.sin(u.phase * 2.4) * 0.12 : Math.abs(speed) > 1 ? Math.sin(u.phase * 70) * 0.02 : Math.sin(u.phase * 40) * 0.012;
    u.inner.rotation.z = u.roll;
    u.inner.rotation.x = u.pitch;
    u.inner.position.y = rumble;
    for (const l of u.lights) {
        if (l.kind === 'red') l.m.visible = Math.floor(u.phase * 6) % 2 === 0;
        else if (l.kind === 'blue') l.m.visible = Math.floor(u.phase * 6) % 2 === 1;
        else if (l.kind === 'beacon') l.m.rotation.y = u.phase * 8;
        else if (l.kind === 'pulse') l.m.scale.setScalar(0.85 + Math.sin(u.phase * 5) * 0.15);
        else if (l.kind === 'rainbow') l.m.material.color.setHSL((u.phase * 0.25) % 1, 1, 0.6).multiplyScalar(2.4);
    }
    if (u.glowRing) u.glowRing.material.opacity = 0.28 + Math.sin(u.phase * 3) * 0.06;
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

// =====================================================================================
// Upgrades you can see on a kart or car: nitro bottles, an engine blower, wide tyres with
// glowing rims, neon power stripes and an underglow
// =====================================================================================
function upgradeParts(inner, part, wheels, u, at) {
    if (!u) return;
    const nitroM = paint(0x1a6aff, { metal: 0.5, rough: 0.25 }), cap = steel();
    if (u.nitro >= 1) {
        const n = u.nitro >= 6 ? 3 : 2;
        for (let k = 0; k < n; k++) {
            const x = at.nitroX + (k - (n - 1) / 2) * 0.5;
            const b = new T.Mesh(CYL, nitroM); b.scale.set(0.22, 1.1, 0.22); b.position.set(x, at.nitroY, at.nitroZ); b.castShadow = true; inner.add(b);
            const c = new T.Mesh(CYL, cap); c.scale.set(0.16, 0.18, 0.16); c.position.set(x, at.nitroY + 0.63, at.nitroZ); inner.add(c);
        }
        if (u.nitro >= 6) part(1.5, 0.06, 0.06, at.nitroX, at.nitroY - 0.2, at.nitroZ + 0.24, mat(0x3ad8ff, { neon: true }));
    }
    if (u.engine >= 3) {
        // a chrome supercharger on the engine, glowing at the top tiers
        part(0.9, 0.5, 0.9, at.engX, at.engY + 0.25, at.engZ, cap, { round: 0.12 });
        part(0.55, 0.45, 0.35, at.engX, at.engY + 0.65, at.engZ + 0.1, u.engine >= 8 ? mat(0xff8a14, { neon: true }) : mat(0x22222a, { rough: 0.4 }), { round: 0.08 });
        if (u.engine >= 6) for (const s of [-0.3, 0.3]) part(0.12, 0.6, 0.12, at.engX + s, at.engY + 0.55, at.engZ - 0.35, cap);
    }
    if (u.grip >= 3) for (const w of wheels) {
        // wider rubber; glowing rims from Grip 7
        w.spin.scale.x = w.front ? 1.12 : 1.25;
        if (u.grip >= 7) {
            const ring = new T.Mesh(new T.TorusGeometry(w.r * 0.62, 0.05, 6, 24), mat(0x7aff3a, { neon: true }));
            ring.rotation.y = Math.PI / 2; ring.position.x = (w.pivot.position.x > 0 ? 1 : -1) * 0.42; w.spin.add(ring);
        }
    }
    if (u.power >= 3) {
        const pm = mat(u.power >= 10 ? 0xff3ad8 : 0xffd028, { neon: true });
        for (const s of [-1, 1]) part(0.06, 0.08, at.stripeLen, s * at.stripeX, at.stripeY, at.stripeZ, pm);
    }
}
// Fills in what an upgrade object needs
const upgOf = (o) => (o && o.upg ? o.upg : null);

// =====================================================================================
// SUPER CARS: modern supercars. Low clear-coated bodies with fender flares and side intakes, full
// width LED light bars, a wraparound windscreen and roll hoop (the driver sits in the open, like
// a Roblox car), modern rims with brake calipers, diffusers. Styles: Electro GT, Cyber Wedge
// (flat steel panels), Formula X (open wheels, wings, halo), Hyper Phantom (big wing and shark
// fin), Hover Racer (no wheels: four glowing hover pods and a bubble canopy) and Quantum Prism
// (iridescent chrome). Same userData as the karts.
// =====================================================================================
let prismMat = null;
function modernWheel(parent, r, w, x, z, rimM, calM, front) {
    const pivot = new T.Group(); pivot.position.set(x, r, z); pivot.userData.dyn = true; parent.add(pivot);
    const spin = new T.Group(); pivot.add(spin);
    const tireM = texMat('tire', () => { const m = new T.MeshStandardMaterial({ color: 0xffffff, map: treadTexture().clone(), roughness: 0.85 }); m.map.repeat.set(5, 1); m.map.needsUpdate = true; return m; });
    const tyre = new T.Mesh(new T.CylinderGeometry(r, r, w, 30, 1), tireM);
    tyre.rotation.z = Math.PI / 2; tyre.castShadow = true; spin.add(tyre);
    const out = Math.sign(x) || 1;
    disc(spin, r * 0.74, w + 0.04, 0, 0, 0, mat(0x14141a, { rough: 0.5 }));
    disc(spin, r * 0.2, w + 0.12, 0, 0, 0, rimM);
    // ten thin spokes
    for (let i = 0; i < 10; i++) {
        const s = new T.Mesh(UNIT, rimM);
        s.scale.set(0.05, r * 1.4, 0.09); s.position.x = out * (w / 2 + 0.02); s.rotation.x = i / 10 * Math.PI;
        spin.add(s);
    }
    const lip = new T.Mesh(new T.TorusGeometry(r * 0.73, 0.04, 6, 30), rimM); lip.rotation.y = Math.PI / 2; lip.position.x = out * (w / 2 + 0.02); spin.add(lip);
    // brake caliper (doesn't spin)
    const cal = new T.Mesh(UNIT, calM); cal.scale.set(0.12, r * 0.55, r * 0.35); cal.position.set(out * (w / 2 - 0.05), r * 0.28, -r * 0.25); pivot.add(cal);
    return { pivot, spin, r, front };
}
function buildSuper(d, o) {
    const g = new T.Group();
    const inner = new T.Group(); g.add(inner);
    const part = maker(inner);
    const sty = d.style;
    let body;
    if (d.prism) body = prismMat || (prismMat = new T.MeshPhysicalMaterial({ color: 0xe8e8ff, metalness: 1, roughness: 0.18, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 900], clearcoat: 1 }));
    else if (sty === 'cyber') body = texMat('cybersteel', () => new T.MeshStandardMaterial({ color: d.body, metalness: 0.85, roughness: 0.32 }));
    else body = paint(d.body, { metal: d.body === 0xffffff || d.body === 0xf4f6ff ? 0.15 : 0.45, rough: 0.22 });
    const neon = mat(d.glow || d.accent, { neon: true }), accentP = paint(d.accent, { metal: 0.3 });
    const dark = mat(0x16161c, { rough: 0.45 }), metal = steel();
    const carbon = texMat('carbon', () => { const t = carbonTexture().clone(); t.repeat.set(3, 6); t.needsUpdate = true; return new T.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.35, metalness: 0.3 }); });
    const glassM = glass(0x88aacc, 0.35);
    const ledW = mat(0xf4f8ff, { neon: true, boost: 1.6 }), ledR = mat(0xff1a2a, { neon: true, boost: 1.6 });
    const exhausts = [], lights = [];
    let wheels = [];
    const hover = !!d.hover;
    const calM = paint(d.accent === 0xffffff ? 0xe8102a : d.accent, { metal: 0.3 });
    const rimM = d.prism ? body : sty === 'gt' || sty === 'hover' ? chrome(0xf2f4f8) : metal;

    // ----- body shells -----
    if (sty === 'formula') {
        // Single-seater: narrow tub, sidepods, nose to a wide front wing, airbox, big rear wing, halo
        part(1.5, 0.8, 6.4, 0, 0.95, -0.2, body, { round: 0.35 });
        part(1.0, 0.5, 2.2, 0, 0.85, 3.3, body, { round: 0.22, rx: 0.06 });
        for (const s of [-1, 1]) {
            part(1.0, 0.75, 2.6, s * 1.15, 0.9, -0.6, body, { round: 0.3 });
            part(0.08, 0.5, 1.6, s * 1.66, 0.95, -0.4, dark);                                // intake
            part(0.1, 0.55, 0.9, s * 2.3, 0.55, 3.75, accentP);                               // front wing endplates
            part(0.1, 1.4, 1.3, s * 2.0, 2.3, -3.3, body);                                    // rear wing endplates
        }
        part(4.6, 0.1, 0.9, 0, 0.42, 3.75, accentP);
        part(4.4, 0.08, 0.5, 0, 0.62, 3.55, dark);
        part(4.0, 0.14, 1.0, 0, 2.85, -3.3, accentP, { rx: -0.15 });
        part(4.0, 0.1, 0.6, 0, 2.45, -3.25, body);
        part(3.9, 0.06, 0.06, 0, 2.95, -2.85, neon);
        part(0.9, 1.0, 1.4, 0, 2.15, -1.9, body, { round: 0.3 });                             // airbox
        part(0.5, 0.4, 0.1, 0, 2.35, -1.2, dark);
        const halo = new T.Mesh(new T.TorusGeometry(0.8, 0.08, 8, 24, Math.PI), dark);
        halo.position.set(0, 2.1, -0.3); halo.rotation.y = Math.PI / 2; halo.castShadow = true; inner.add(halo);
        tube(inner, [0, 1.3, 0.75], [0, 2.05, 0.5], 0.08, dark);
        part(1.4, 0.06, 0.06, 0, 1.0, 4.2, ledW);
        part(0.4, 0.3, 0.06, 0, 1.0, -3.45, ledR);
        wheels = [
            modernWheel(inner, 0.75, 0.85, -2.2, 2.6, rimM, calM, true), modernWheel(inner, 0.75, 0.85, 2.2, 2.6, rimM, calM, true),
            modernWheel(inner, 0.82, 1.15, -2.25, -2.3, rimM, calM, false), modernWheel(inner, 0.82, 1.15, 2.25, -2.3, rimM, calM, false),
        ];
        for (const s of [-1, 1]) tube(inner, [s * 0.7, 0.9, 2.4], [s * 1.9, 0.75, 2.6], 0.06, dark);
    } else if (hover) {
        // Hover pod: a smooth capsule body, four hover pods with glowing rings, a bubble canopy
        part(3.8, 1.1, 7.0, 0, 1.6, 0, body, { round: 0.55 });
        part(3.0, 0.5, 2.2, 0, 1.25, 3.3, body, { round: 0.25, rx: 0.12 });
        part(4.0, 0.1, 6.6, 0, 1.55, 0, neon);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const pod = new T.Mesh(new T.CylinderGeometry(0.85, 1.0, 0.7, 20), dark); pod.position.set(sx * 2.0, 0.95, sz * 2.5); pod.castShadow = true; inner.add(pod);
            const ring = new T.Mesh(new T.TorusGeometry(0.85, 0.12, 8, 24), neon); ring.rotation.x = Math.PI / 2; ring.position.set(sx * 2.0, 0.58, sz * 2.5); inner.add(ring);
            const core = new T.Mesh(new T.CircleGeometry(0.7, 20), mat(d.glow, { neon: true, boost: 2.2 })); core.rotation.x = Math.PI / 2; core.position.set(sx * 2.0, 0.57, sz * 2.5); inner.add(core);
            lights.push({ m: ring, kind: 'pulse' });
        }
        const dome = new T.Mesh(new T.SphereGeometry(1.75, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass(0x9ad8ff, 0.3));
        dome.scale.set(1.05, 1.35, 1.35); dome.position.set(0, 2.1, -0.5); inner.add(dome);
        part(2.6, 0.06, 0.06, 0, 1.7, 3.55, ledW);
        part(3.2, 0.1, 0.06, 0, 1.9, -3.52, ledR);
    } else {
        // Coupe body: floor, lower body, nose, flares, side intakes, rear deck, diffuser
        const lowB = sty === 'phantom' ? -0.12 : 0;
        part(4.1, 0.3, 7.2, 0, 0.55 + lowB, 0, carbon);
        if (sty === 'cyber') {
            // Flat steel panels: a low wedge nose rising to the cabin and a sharp sloped tail
            const sh = new T.Shape();
            sh.moveTo(3.7, 0.6); sh.lineTo(3.7, 1.15); sh.lineTo(0.6, 1.95); sh.lineTo(-1.6, 1.95); sh.lineTo(-3.6, 1.45); sh.lineTo(-3.6, 0.6); sh.lineTo(3.7, 0.6);
            const geo = new T.ExtrudeGeometry(sh, { depth: 4.1, bevelEnabled: false });
            geo.translate(0, 0, -2.05); geo.rotateY(-Math.PI / 2);
            const m = new T.Mesh(geo, body); m.castShadow = true; inner.add(m);
            part(4.14, 0.07, 0.07, 0, 1.17, 3.66, mat(d.glow, { neon: true, boost: 1.8 }));        // full-width light bar
            part(4.14, 0.09, 0.07, 0, 1.47, -3.62, ledR);
            for (const s of [-1, 1]) part(0.05, 0.08, 6.6, s * 2.07, 0.95, 0, mat(d.glow, { neon: true }));
        } else {
            part(4.3, 0.95, 6.9, 0, 1.05 + lowB, -0.1, body, { round: 0.42 });
            part(3.9, 0.55, 1.7, 0, 0.98 + lowB, 3.15, body, { round: 0.25, rx: 0.16 });
            part(3.6, 0.75, 2.1, 0, 1.55 + lowB, -2.4, body, { round: 0.3 });                     // engine cover
            for (const s of [-1, 1]) {
                for (const z of [2.4, -2.3]) part(0.55, 0.85, 2.0, s * 2.02, 1.2 + lowB, z, body, { round: 0.25 });   // fender flares
                part(0.12, 0.45, 1.5, s * 2.2, 1.0 + lowB, -0.6, dark);                                                 // side intake
                part(0.06, 0.07, 5.2, s * 2.18, 1.32 + lowB, 0.2, neon);                                                 // accent line
                part(0.35, 0.22, 0.45, s * 1.9, 1.95 + lowB, 0.55, body, { round: 0.08 });                               // mirror
            }
            part(3.3, 0.07, 0.06, 0, 1.17 + lowB, 3.98, ledW);                                    // front LED bar
            for (const s of [-1, 1]) part(0.7, 0.14, 0.06, s * 1.35, 1.08 + lowB, 3.96, ledW);
            part(3.7, 0.12, 0.06, 0, 1.55 + lowB, -3.56, ledR);                                   // rear LED bar
            for (let k = -2; k <= 2; k++) part(0.08, 0.35, 0.8, k * 0.6, 0.62 + lowB, -3.35, dark);   // diffuser fins
            // wraparound windscreen and roll hoop: the driver sits in the open
            const ws = part(3.2, 0.95, 0.08, 0, 1.95 + lowB, 1.0, glassM, { rx: -0.85 }); ws.castShadow = false;
            const hoop = new T.Mesh(new T.TorusGeometry(1.05, 0.12, 8, 20, Math.PI), sty === 'phantom' ? neon : dark);
            hoop.position.set(0, 1.5 + lowB, -1.35); hoop.castShadow = true; inner.add(hoop);
        }
        if (sty === 'phantom') {
            for (const s of [-1, 1]) tube(inner, [s * 0.9, 1.7, -2.9], [s * 0.9, 2.7, -3.3], 0.07, dark);
            part(4.4, 0.12, 1.0, 0, 2.75, -3.35, carbon, { rx: -0.1 });
            part(4.4, 0.06, 0.06, 0, 2.83, -2.86, ledR);
            part(0.08, 0.9, 2.2, 0, 2.05, -2.4, body);                                          // shark fin
            for (const s of [-1, 1]) part(0.06, 0.5, 1.2, s * 2.1, 1.0, 3.2, neon, { rx: 0.3 });
        }
        if (sty === 'gt') part(3.4, 0.06, 0.5, 0, 1.95, -3.2, body, { rx: -0.25 });              // ducktail
        if (d.prism) for (const s of [-1, 1]) { const l = part(0.07, 0.07, 6.6, s * 2.16, 1.62, -0.1, new T.MeshBasicMaterial({ color: 0xffffff })); lights.push({ m: l, kind: 'rainbow' }); }
        const R = sty === 'phantom' ? 0.78 : 0.76;
        wheels = [
            modernWheel(inner, R, 0.8, -1.98, 2.4, rimM, calM, true), modernWheel(inner, R, 0.8, 1.98, 2.4, rimM, calM, true),
            modernWheel(inner, R + 0.04, 0.95, -1.98, -2.3, rimM, calM, false), modernWheel(inner, R + 0.04, 0.95, 1.98, -2.3, rimM, calM, false),
        ];
    }

    // ----- seat and steering -----
    const seatY = hover ? 1.55 : sty === 'formula' ? 0.95 : 1.0, seatZ = hover ? -0.6 : -0.4;
    const seatM = gloss(0x18181e, { rough: 0.5 });
    part(1.6, 0.35, 1.4, 0, seatY - 0.2, seatZ - 0.05, seatM, { round: 0.15 });
    part(1.6, 1.5, 0.3, 0, seatY + 0.55, seatZ - 0.85, seatM, { round: 0.14, rx: -0.18 });
    const steerWheel = new T.Group(); steerWheel.position.set(0, seatY + 0.9, seatZ + 1.7); steerWheel.rotation.x = -0.9; steerWheel.userData.dyn = true; inner.add(steerWheel);
    const wheelRim = new T.Mesh(new T.TorusGeometry(0.38, 0.06, 8, 20, Math.PI * 1.5), dark); wheelRim.rotation.z = Math.PI * 1.25; steerWheel.add(wheelRim);
    const scr = new T.Mesh(UNIT, mat(d.glow || 0x5ad8ff, { neon: true })); scr.scale.set(0.3, 0.16, 0.04); steerWheel.add(scr);
    tube(inner, [0, seatY + 0.2, seatZ + 2.4], [0, seatY + 0.85, seatZ + 1.75], 0.06, dark);

    // ----- exhaust / boost tips (nitro and boost flames come out here) -----
    for (const s of [-0.55, 0.55]) {
        const tip = new T.Object3D(); tip.position.set(s, hover ? 1.4 : 0.75, -3.75); inner.add(tip); exhausts.push(tip);
        if (!hover) part(0.38, 0.38, 0.2, s, 0.75, -3.6, metal, { round: 0.1 });
    }

    upgradeParts(inner, part, wheels, upgOf(o), { nitroX: 0, nitroY: (hover ? 2.2 : 1.95), nitroZ: -2.6, engX: 0, engY: hover ? 2.15 : 1.9, engZ: -2.4, stripeX: 1.9, stripeY: hover ? 1.9 : 1.55, stripeZ: 0.4, stripeLen: 4.6 });

    // Underglow on every super car
    let glowRing = null;
    glowRing = new T.Mesh(new T.PlaneGeometry(7, 9.5), new T.MeshBasicMaterial({ color: d.glow || d.accent, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, map: glowTex() }));
    glowRing.material.color.multiplyScalar(1.6);
    glowRing.rotation.x = -Math.PI / 2; glowRing.position.y = 0.06; g.add(glowRing);

    if (o.static) {
        for (const w of wheels) w.pivot.userData.dyn = false;
        steerWheel.userData.dyn = false;
        for (const l of lights) if (l.kind === 'rainbow') l.m.userData.dyn = true;
        mergeChildren(inner);
    } else {
        for (const l of lights) l.m.userData.dyn = true;
        mergeChildren(inner);
        for (const w of wheels) mergeChildren(w.spin);
        mergeChildren(steerWheel);
    }
    const SCALE = 1.08;
    inner.scale.setScalar(SCALE);
    glowRing.scale.setScalar(SCALE);
    Object.assign(g.userData, {
        inner, wheels, steerWheel, exhausts, lights, glowRing, seatY: seatY * SCALE, seatZ: seatZ * SCALE, def: d, scale: SCALE,
        spin: 0, phase: Math.random() * 6, roll: 0, pitch: 0, steer: 0, hover,
    });
    return g;
}
