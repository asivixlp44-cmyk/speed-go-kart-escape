import { T, texFrom } from './engine.js';

// Canvas-generated textures: wood planks for the starter kart, checker and hazard stripes, ramp
// chevrons, tyre tread, lava, a starry galaxy, carbon fibre, laser beams. Drawn once and cached.
const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const css = (h) => '#' + h.toString(16).padStart(6, '0');
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const repeat = (t) => { t.wrapS = t.wrapT = T.RepeatWrapping; return t; };

// Wooden planks (the reference's starter kart): warm brown boards with grain and dark seams
export function plankTexture(base) {
    return once('plank|' + base, () => {
        const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(5 + (base & 255));
        const b = new T.Color(base);
        for (let i = 0; i < 4; i++) {
            const k = 0.86 + rnd() * 0.22;
            x.fillStyle = '#' + b.clone().multiplyScalar(k).getHexString();
            x.fillRect(0, i * 64, N, 64);
            for (let g = 0; g < 18; g++) {
                x.strokeStyle = `rgba(40,20,8,${0.06 + rnd() * 0.12})`; x.lineWidth = 1 + rnd() * 2;
                const y = i * 64 + 4 + rnd() * 56;
                x.beginPath(); x.moveTo(0, y);
                x.bezierCurveTo(N * 0.3, y + (rnd() - 0.5) * 6, N * 0.7, y + (rnd() - 0.5) * 6, N, y + (rnd() - 0.5) * 3);
                x.stroke();
            }
            x.fillStyle = 'rgba(30,14,4,0.55)'; x.fillRect(0, i * 64, N, 3);
            // nail heads
            x.fillStyle = 'rgba(60,60,70,0.8)';
            for (const nx of [14, N - 14]) { x.beginPath(); x.arc(nx, i * 64 + 32, 3.5, 0, Math.PI * 2); x.fill(); }
        }
        return repeat(texFrom(c));
    });
}
// Two-colour checker (finish lines, the laser stage floor)
export function checkerTexture(a, b, n) {
    return once('checker|' + a + b + n, () => {
        const N = 128, c = canvas(N), x = c.getContext('2d'), s = N / (n || 2);
        for (let i = 0; i < (n || 2); i++) for (let j = 0; j < (n || 2); j++) { x.fillStyle = css((i + j) % 2 ? b : a); x.fillRect(i * s, j * s, s, s); }
        const t = repeat(texFrom(c)); t.magFilter = T.NearestFilter;
        return t;
    });
}
// Diagonal hazard stripes
export function stripeTexture(c1, c2, n) {
    return once('stripe|' + c1 + c2 + n, () => {
        const N = 128, c = canvas(N), x = c.getContext('2d');
        x.fillStyle = css(c1); x.fillRect(0, 0, N, N);
        x.fillStyle = css(c2);
        const w = N / (n * 2);
        for (let k = -n * 2; k < n * 4; k++) {
            if (k % 2) continue;
            x.beginPath(); x.moveTo(k * w, 0); x.lineTo(k * w + w, 0); x.lineTo(k * w + w + N, N); x.lineTo(k * w + N, N); x.fill();
        }
        return repeat(texFrom(c));
    });
}
// Ramp face: bright chevrons pointing up the ramp (+v)
export function chevronTexture(base, arrow) {
    return once('chev|' + base + arrow, () => {
        const N = 128, c = canvas(N), x = c.getContext('2d');
        x.fillStyle = css(base); x.fillRect(0, 0, N, N);
        x.strokeStyle = css(arrow); x.lineWidth = 16; x.lineJoin = 'miter';
        for (const y of [N * 0.36, N * 0.86]) { x.beginPath(); x.moveTo(N * 0.12, y); x.lineTo(N * 0.5, y - N * 0.3); x.lineTo(N * 0.88, y); x.stroke(); }
        return repeat(texFrom(c));
    });
}
// Boost pad: glowing arrows (scrolled by world.js)
export function boostTexture() {
    return once('boost', () => {
        const N = 128, c = canvas(N), x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, 0, N); g.addColorStop(0, '#ff7a14'); g.addColorStop(1, '#ffd028');
        x.fillStyle = g; x.fillRect(0, 0, N, N);
        x.fillStyle = '#ffffff';
        for (const y of [N * 0.1, N * 0.6]) { x.beginPath(); x.moveTo(N * 0.5, y); x.lineTo(N * 0.9, y + N * 0.3); x.lineTo(N * 0.7, y + N * 0.3); x.lineTo(N * 0.5, y + N * 0.15); x.lineTo(N * 0.3, y + N * 0.3); x.lineTo(N * 0.1, y + N * 0.3); x.closePath(); x.fill(); }
        return repeat(texFrom(c));
    });
}
// Tyre tread around the tyre (u wraps the circumference)
export function treadTexture() {
    return once('tread', () => {
        const c = canvas(128, 32), x = c.getContext('2d');
        x.fillStyle = '#1c1c22'; x.fillRect(0, 0, 128, 32);
        x.fillStyle = '#2c2c34';
        for (let i = 0; i < 16; i++) { x.beginPath(); x.moveTo(i * 8, 2); x.lineTo(i * 8 + 5, 16); x.lineTo(i * 8, 30); x.lineTo(i * 8 + 3, 30); x.lineTo(i * 8 + 8, 16); x.lineTo(i * 8 + 3, 2); x.fill(); }
        return repeat(texFrom(c));
    });
}
// Lava: glowing cracks over dark crust (scrolled slowly)
export function lavaTexture() {
    return once('lava', () => {
        const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(31);
        const g = x.createLinearGradient(0, 0, N, N); g.addColorStop(0, '#ff5a0a'); g.addColorStop(0.5, '#ffb01e'); g.addColorStop(1, '#ff3a0a');
        x.fillStyle = g; x.fillRect(0, 0, N, N);
        for (let k = 0; k < 26; k++) {
            const px = rnd() * N, py = rnd() * N, r = 12 + rnd() * 34;
            for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
                const gg = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r);
                gg.addColorStop(0, 'rgba(60,10,0,0.85)'); gg.addColorStop(0.7, 'rgba(90,20,0,0.5)'); gg.addColorStop(1, 'rgba(90,20,0,0)');
                x.fillStyle = gg; x.beginPath(); x.arc(px + ox, py + oy, r, 0, Math.PI * 2); x.fill();
            }
        }
        return repeat(texFrom(c));
    });
}
// Galaxy paint: deep purple nebula with stars
export function galaxyTexture() {
    return once('galaxy', () => {
        const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(77);
        x.fillStyle = '#12052e'; x.fillRect(0, 0, N, N);
        for (let k = 0; k < 14; k++) {
            const px = rnd() * N, py = rnd() * N, r = 30 + rnd() * 70;
            const g = x.createRadialGradient(px, py, 0, px, py, r);
            const col = ['rgba(180,60,255,0.35)', 'rgba(60,180,255,0.3)', 'rgba(255,80,200,0.28)'][k % 3];
            g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
            x.fillStyle = g; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
        }
        for (let k = 0; k < 160; k++) { x.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.6})`; x.fillRect(rnd() * N, rnd() * N, rnd() < 0.1 ? 2 : 1, rnd() < 0.1 ? 2 : 1); }
        return repeat(texFrom(c));
    });
}
// Carbon fibre weave
export function carbonTexture() {
    return once('carbon', () => {
        const N = 64, c = canvas(N), x = c.getContext('2d');
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
            const g = x.createLinearGradient(i * 8, j * 8, i * 8 + 8, j * 8 + 8);
            const a = (i + j) % 2 ? ['#2a2a32', '#121216'] : ['#121216', '#2a2a32'];
            g.addColorStop(0, a[0]); g.addColorStop(1, a[1]);
            x.fillStyle = g; x.fillRect(i * 8, j * 8, 8, 8);
        }
        return repeat(texFrom(c));
    });
}
// Laser beam: bright core fading to the edges across v
export function beamTexture() {
    return once('beam', () => {
        const c = canvas(4, 64), x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, 0, 64);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.4, 'rgba(255,255,255,0.7)'); g.addColorStop(0.5, 'rgba(255,255,255,1)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 4, 64);
        return texFrom(c);
    });
}
// Rainbow (finale floors, trims)
export function rainbowTexture() {
    return once('rainbow', () => {
        const N = 256, c = canvas(N, 16), x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, N, 0);
        ['#ff5a7a', '#ffb84a', '#ffe85a', '#6aff8a', '#5ac8ff', '#b88aff', '#ff5a7a'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
        x.fillStyle = g; x.fillRect(0, 0, N, 16);
        const t = texFrom(c); t.wrapS = T.RepeatWrapping;
        return t;
    });
}
// Soft round puff (smoke, glows)
export function puffTexture() {
    return once('puff', () => {
        const N = 128, c = canvas(N), x = c.getContext('2d');
        const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, N, N);
        return texFrom(c);
    });
}
// Speed roller belt: dark rubber with ribs (scrolled)
export function rollerTexture() {
    return once('roller', () => {
        const c = canvas(64), x = c.getContext('2d');
        x.fillStyle = '#26262e'; x.fillRect(0, 0, 64, 64);
        x.fillStyle = '#44444f'; for (let i = 0; i < 4; i++) x.fillRect(0, i * 16, 64, 5);
        return repeat(texFrom(c));
    });
}
// A racing number / text decal on a transparent background
export function decalTexture(text, color, stroke) {
    return once('decal|' + text + color + stroke, () => {
        const c = canvas(256, 256), x = c.getContext('2d');
        x.font = '700 170px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.lineJoin = 'round'; x.lineWidth = 22; x.strokeStyle = stroke || '#14141e'; x.strokeText(text, 128, 138);
        x.fillStyle = color || '#ffffff'; x.fillText(text, 128, 138);
        return texFrom(c);
    });
}

// Animated textures (offsets scrolled every frame)
export const scrolling = [];
export function updateMaterials(dt) {
    for (const s of scrolling) { s.tex.offset.x = (s.tex.offset.x + s.u * dt) % 1; s.tex.offset.y = (s.tex.offset.y + s.v * dt) % 1; }
}
