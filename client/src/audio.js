// Procedural soundtrack and sound effects (Web Audio, no asset files).
// "Turbo Bricks": an original 140 BPM racing electro-pop track in A minor. A galloping octave
// bass and driving 16th hats keep it moving, the hook rides Am - F - C - G on a bright lead,
// and the drops add pumping supersaws, a clap + snare and a bell double. 36 bars: intro, verse,
// build, drop, break, build, drop 2, looping. On top of it runs a kart engine that shifts gears
// with your speed, a tyre screech for drifts and a nitro roar.

let ctx = null, master, musicBus, musicOut, duckFilter, sfxBus, reverb, delay, pump;
let noiseBuf = null, meter = null;
let musicOn = false, schedTimer = null, step = 0, nextTime = 0, ducked = false, intensity = 0;
let engine = null, screech = null, roar = null;
const settings = { music: 0.55, sfx: 0.8, master: 1, muted: false, engine: 0.8 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('gke_audio') || '{}')); } catch (e) { /* defaults */ }

const BPM = 140, STEP = 60 / BPM / 4;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
// vi - IV - I - V in C: the "racing anthem" progression
const CHORDS = [
    { root: 45, notes: [57, 60, 64, 69] },   // Am
    { root: 41, notes: [57, 60, 65, 69] },   // F
    { root: 48, notes: [55, 60, 64, 67] },   // C
    { root: 43, notes: [55, 59, 62, 67] },   // G
];
const HOOK_A = [
    [[0, 76, 2], [2, 76, 1], [3, 74, 1], [4, 72, 2], [6, 69, 2], [8, 72, 2], [10, 74, 2], [12, 76, 4]],
    [[0, 77, 2], [2, 76, 2], [4, 74, 2], [6, 72, 2], [8, 74, 3], [11, 72, 1], [12, 69, 4]],
    [[0, 72, 2], [2, 74, 1], [3, 76, 1], [4, 79, 2], [6, 76, 2], [8, 74, 2], [10, 72, 2], [12, 74, 4]],
    [[0, 71, 2], [2, 74, 2], [4, 79, 3], [7, 77, 1], [8, 79, 2], [10, 81, 2], [12, 83, 4]],
];
const HOOK_B = [
    [[0, 81, 3], [3, 79, 1], [4, 76, 2], [6, 79, 2], [8, 81, 2], [10, 84, 2], [12, 83, 2], [14, 81, 2]],
    [[0, 81, 2], [2, 77, 2], [4, 76, 2], [6, 74, 2], [8, 72, 2], [10, 74, 2], [12, 76, 4]],
    [[0, 79, 2], [2, 76, 2], [4, 72, 2], [6, 76, 2], [8, 79, 2], [10, 84, 2], [12, 83, 4]],
    [[0, 83, 3], [3, 81, 1], [4, 79, 2], [6, 77, 2], [8, 74, 4], [12, 79, 4]],
];
const HATS = [0.9, 0.3, 0.55, 0.3, 0.8, 0.3, 0.55, 0.35, 0.9, 0.3, 0.55, 0.3, 0.8, 0.35, 0.6, 0.4];
const SECTION = (bar) => {
    const b = bar % 36;
    if (b < 4) return 'intro';
    if (b < 12) return 'verse';
    if (b < 16) return 'build';
    if (b < 24) return 'drop';
    if (b < 28) return 'break';
    if (b < 30) return 'build';
    return 'drop2';
};

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    master = ctx.createGain(); master.gain.value = 1.0;
    comp.connect(master).connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter);
    musicBus = ctx.createGain();
    duckFilter = ctx.createBiquadFilter(); duckFilter.type = 'lowpass'; duckFilter.frequency.value = 20000; duckFilter.Q.value = 0.5;
    musicOut = ctx.createGain();
    musicBus.connect(duckFilter).connect(musicOut).connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    pump = ctx.createGain(); pump.connect(musicBus);
    applyVolumes();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.4);
    }
    reverb.buffer = ir;
    const revGain = ctx.createGain(); revGain.gain.value = 0.26;
    reverb.connect(revGain).connect(musicBus);
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'highpass'; dlf.frequency.value = 700;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.22;
    delay.connect(dlf).connect(fb).connect(delay);
    dlf.connect(dlGain).connect(musicBus);
    startEngine();

    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}

function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicOut.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 1.6 * m * (ducked ? 0.6 : 1), t, 0.08);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
}
function save() { try { localStorage.setItem('gke_audio', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) {
    settings[kind] = Math.max(0, Math.min(1, v));
    save();
    applyVolumes();
}
export function toggleMusic() { settings.muted = !settings.muted; save(); applyVolumes(); return !settings.muted; }
export const musicMuted = () => !!settings.muted;
export function resumeAudio() { initAudio(); if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (ctx && !musicOn && wantMusic) startMusic(); }
const level = () => { if (!meter) return 0; const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a); let p = 0; for (const v of a) p = Math.max(p, Math.abs(v)); return +p.toFixed(3); };
export const audioDebug = () => ({ peak: level(), state: ctx && ctx.state, musicOn, settings: { ...settings }, music: musicOut && musicOut.gain.value, sfx: sfxBus && sfxBus.gain.value });
export const audioSuspended = () => !ctx || ctx.state !== 'running';
export function setMusicDuck(on) {
    if (!ctx || on === ducked) return;
    ducked = on;
    duckFilter.frequency.setTargetAtTime(on ? 900 : 20000, ctx.currentTime, 0.12);
    applyVolumes();
}
// 0 in the lobby .. 1 on the late stages: an extra bell layer in the drops
export function setMusicIntensity(v) { intensity = v; }

// ----- instruments -----
function env(g, t, a, peak, d, sustain, r, end) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
    if (end) { g.gain.setValueAtTime(Math.max(0.0001, sustain), end); g.gain.exponentialRampToValueAtTime(0.0001, end + r); }
}
function noise(t, dur, type, freq, q, gain, out) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return g;
}
function kick(t, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.09);
    g.gain.setValueAtTime(gain || 0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.38);
    noise(t, 0.012, 'highpass', 3000, 0.7, 0.18, musicBus);
    pump.gain.cancelScheduledValues(t);
    pump.gain.setValueAtTime(0.2, t);
    pump.gain.linearRampToValueAtTime(1, t + STEP * 3.2);
}
function hat(t, gain, open) { noise(t, open ? 0.16 : 0.035, 'highpass', open ? 6500 : 8000, 0.8, gain, musicBus); }
function clap(t, gain) {
    gain = gain || 0.18;
    for (let i = 0; i < 3; i++) noise(t + i * 0.009, 0.08, 'bandpass', 1500, 1.1, gain, musicBus);
    noise(t, 0.3, 'bandpass', 1800, 0.9, gain * 0.5, reverb);
}
function snare(t, gain) {
    noise(t, 0.12, 'bandpass', 2100, 0.8, gain, musicBus);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.06);
    g.gain.setValueAtTime(gain * 0.7, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.1);
}
function crash(t) { noise(t, 1.4, 'highpass', 5000, 0.6, 0.12, musicBus); noise(t, 1.2, 'highpass', 4000, 0.5, 0.06, reverb); }
function bell(t, n, dur, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.4, dur * 2.2));
    g.connect(musicBus); g.connect(reverb); g.connect(delay);
    for (const [k, a] of [[1, 1], [2.01, 0.35], [3.99, 0.18], [6.2, 0.06]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(g); o.start(t); o.stop(t + Math.max(0.45, dur * 2.3));
    }
}
function pluck(t, n, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(midi(n), t);
    f.type = 'lowpass'; f.frequency.setValueAtTime(5200, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.14);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(f).connect(g); g.connect(musicBus); g.connect(delay);
    o.start(t); o.stop(t + 0.18);
}
function supersaw(t, notes, dur, gain, cutoff) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(cutoff * 2.2, t); f.frequency.exponentialRampToValueAtTime(cutoff, t + dur * 0.6);
    env(g, t, 0.006, gain, dur * 0.5, gain * 0.55, 0.08, t + dur);
    f.connect(g); g.connect(pump); g.connect(reverb);
    for (const n of notes) for (const det of [-14, 0, 14]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det + (Math.random() - 0.5) * 4;
        o.connect(f); o.start(t); o.stop(t + dur + 0.12);
    }
}
function pad(t, notes, dur, gain, cutoff) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 0.7; f.frequency.value = cutoff;
    env(g, t, dur * 0.25, gain, dur * 0.2, gain * 0.8, 0.3, t + dur);
    f.connect(g); g.connect(pump); g.connect(reverb);
    for (const n of notes) for (const det of [-8, 8]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + dur + 0.35);
    }
}
// Galloping racing bass: a filtered saw with a sub sine under it
function bass(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(380, t + dur * 0.9);
    env(g, t, 0.004, gain || 0.3, dur * 0.6, (gain || 0.3) * 0.6, 0.04, t + dur);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n);
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = midi(n - 12); const sg = ctx.createGain(); sg.gain.value = 0.7;
    o.connect(f).connect(g); sub.connect(sg).connect(g); g.connect(pump);
    o.start(t); o.stop(t + dur + 0.08); sub.start(t); sub.stop(t + dur + 0.08);
}
function musicBox(t, n, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    g.connect(musicBus); g.connect(reverb);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = midi(n); o.connect(g); o.start(t); o.stop(t + 1);
    const h = ctx.createOscillator(), hg = ctx.createGain(); h.type = 'sine'; h.frequency.value = midi(n) * 3.01; hg.gain.setValueAtTime(0.25, t); hg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    h.connect(hg).connect(g); h.start(t); h.stop(t + 0.15);
}
function riser(t, dur) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + dur * 0.95); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    src.connect(f).connect(g); g.connect(musicBus); g.connect(reverb);
    src.start(t); src.stop(t + dur + 0.1);
}
function impact(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.9);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(g).connect(musicBus); o.start(t); o.stop(t + 1.2);
    crash(t);
}
// The lead: two detuned saws and a square with vibrato, an octave sine on top for shine
function lead(t, n, dur, gain) {
    const g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(6200, t); f.frequency.exponentialRampToValueAtTime(2800, t + Math.min(0.4, dur));
    env(g, t, 0.008, gain, 0.12, gain * 0.75, 0.09, t + dur);
    f.connect(g); g.connect(musicBus); g.connect(delay); g.connect(reverb);
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = 6; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(midi(n) * 0.01, t + Math.min(0.25, dur));
    vib.connect(vg);
    for (const [type, det, k, oct] of [['sawtooth', -9, 0.35, 0], ['sawtooth', 9, 0.35, 0], ['square', 0, 0.22, 0], ['sine', 0, 0.28, 12]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = type; o.detune.value = det; og.gain.value = k;
        o.frequency.setValueAtTime(midi(n + oct), t);
        vg.connect(o.frequency);
        o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.18);
    }
    vib.start(t); vib.stop(t + dur + 0.18);
}

function playStep(s, t) {
    const bar = Math.floor(s / 16), i = s % 16, b = bar % 36, sec = SECTION(bar), chord = CHORDS[bar % 4];
    const arp = chord.notes[[0, 1, 2, 3, 2, 1, 3, 2][(i >> 1) % 8]];
    if (sec === 'intro' || sec === 'break') {
        if (i === 0) pad(t, chord.notes, STEP * 16, 0.045, sec === 'intro' ? 700 + (b % 4) * 400 : 1800);
        if (i === 0) bass(t, chord.root + 12, STEP * 14, 0.12);
        if (i % 2 === 0) pluck(t, arp + 12, 0.025);
        if (sec === 'break') for (const [at, n] of HOOK_A[bar % 4]) if (at === i) musicBox(t, n + 12, 0.1);
        if (sec === 'intro' && i % 4 === 0 && b >= 2) kick(t, 0.5);
        if ((b === 3 || b === 27) && i >= 8) snare(t, 0.04 + (i - 8) * 0.015);
        return;
    }
    if (sec === 'verse') {
        if (i % 4 === 0) kick(t, 0.75);
        if (i === 4 || i === 12) { snare(t, 0.13); clap(t, 0.1); }
        hat(t, 0.045 * HATS[i], i % 4 === 2);
        pluck(t, arp + 12, i % 2 ? 0.02 : 0.03);
        bass(t, chord.root + (i % 2 ? 12 : 0) + 12, STEP * 0.9, i % 4 === 0 ? 0.26 : 0.18);
        if (i === 0) pad(t, chord.notes, STEP * 16, 0.03, 1200);
        if (bar % 4 === 3 && i >= 8) for (const [at, n, l] of HOOK_A[3]) if (at === i) lead(t, n, STEP * l, 0.06);
        return;
    }
    if (sec === 'build') {
        const k = b < 16 ? b - 12 : b - 28 + 2;
        if ((b === 12 || b === 28) && i === 0) riser(t, STEP * (b === 12 ? 64 : 32));
        const every = k < 2 ? 4 : k === 2 ? 2 : 1;
        if (i % every === 0) snare(t, 0.05 + (k * 16 + i) / 64 * 0.12);
        if (k < 3 && i % 4 === 0) kick(t, 0.7);
        if (i === 0) supersaw(t, chord.notes, STEP * 14, 0.03, 800 + k * 900);
        hat(t, 0.04 * HATS[i]);
        if (i % 2 === 0) pluck(t, chord.notes[(i / 2) % 4] + 12, 0.03);
        bass(t, chord.root + 12, STEP * 0.9, 0.16);
        if (k === 3) for (const [at, n, l] of HOOK_A[bar % 4]) if (at === i) lead(t, n, STEP * l, 0.07);
        return;
    }
    // Drops: four on the floor, snare + clap, galloping bass, supersaw stabs, the hook
    if ((b === 16 || b === 30) && i === 0) impact(t);
    if (i === 0 && bar % 4 === 0) crash(t);
    if (i % 4 === 0) kick(t, 0.9);
    if (i === 4 || i === 12) { snare(t, 0.16); clap(t, 0.15); }
    hat(t, 0.06 * HATS[i], i % 4 === 2);
    if (i % 4 === 0) supersaw(t, chord.notes.map((n) => n + 12), STEP * 3.4, 0.04, 3400);
    bass(t, chord.root + ([0, 12, 0, 12, 0, 12, 7, 12][(i >> 1) % 8]) + 12, STEP * 0.9, i % 4 === 0 ? 0.3 : 0.22);
    for (const [at, n, l] of (sec === 'drop2' ? HOOK_B : HOOK_A)[bar % 4]) if (at === i) {
        lead(t, n, STEP * l, 0.1);
        if (sec === 'drop2') bell(t, n + 12, STEP * l, 0.04);
    }
    if (i % 2 === 1) pluck(t, chord.notes[(i >> 1) % 4] + 24, 0.015);
    if (intensity > 0.5 && i % 4 === 2) bell(t, chord.notes[(i >> 2) % 4] + 24, STEP, 0.03);
    if (i === 14 && bar % 4 === 3) { snare(t, 0.1); snare(t + STEP / 2, 0.12); }
}

function scheduler() {
    while (nextTime < ctx.currentTime + 0.15) {
        playStep(step, nextTime);
        nextTime += STEP;
        step++;
    }
}
let wantMusic = false;
export function startMusic() {
    wantMusic = true;
    if (!ctx || musicOn) return;
    musicOn = true;
    step = 0; nextTime = ctx.currentTime + 0.1;
    schedTimer = setInterval(scheduler, 25);
}
export function stopMusic() { musicOn = false; clearInterval(schedTimer); }

// ----- the kart engine, tyre screech and nitro roar (continuous) -----
// A two-stroke buzz: saw + square through a resonant low-pass, an LFO for the piston chug. The
// pitch climbs through 5 gears and drops back a little on every shift, like a real kart.
function startEngine() {
    const out = ctx.createGain(); out.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 4;
    const chug = ctx.createGain(); chug.gain.value = 0.6;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 20; lg.gain.value = 0.35;
    lfo.connect(lg).connect(chug.gain);
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 50;
    const b = ctx.createOscillator(); b.type = 'square'; b.frequency.value = 25; b.detune.value = 6;
    const bg = ctx.createGain(); bg.gain.value = 0.45;
    a.connect(chug); b.connect(bg).connect(chug);
    chug.connect(f).connect(out).connect(sfxBus);
    a.start(); b.start(); lfo.start();
    engine = { out, f, a, b, lfo, gear: 0 };
    // Screech: looping band-passed noise
    const sSrc = ctx.createBufferSource(); sSrc.buffer = noiseBuf; sSrc.loop = true;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 2400; sf.Q.value = 6;
    const sg = ctx.createGain(); sg.gain.value = 0;
    sSrc.connect(sf).connect(sg).connect(sfxBus); sSrc.start();
    screech = { g: sg, f: sf };
    // Nitro roar: low-passed noise + a low sine
    const rSrc = ctx.createBufferSource(); rSrc.buffer = noiseBuf; rSrc.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 900;
    const rg = ctx.createGain(); rg.gain.value = 0;
    rSrc.connect(rf).connect(rg).connect(sfxBus); rSrc.start();
    roar = { g: rg, f: rf };
}
// on: the engine runs; frac: speed / top speed; throttle 0..1; drift 0..1; nitro 0..1
export function setEngine(on, frac, throttle, drift, nitro) {
    if (!engine) return;
    const t = ctx.currentTime;
    frac = Math.max(0, Math.min(1.5, frac || 0));
    const gears = 5, g = Math.min(gears - 1, Math.floor(frac * gears * 0.999));
    const rpm = frac * gears - g;
    const base = on ? 46 + rpm * 70 + g * 9 + (throttle > 0.1 ? 6 : 0) : 0;
    if (g !== engine.gear) { engine.gear = g; if (on && g > 0) engine.a.frequency.setValueAtTime(Math.max(30, base * 0.82), t); }
    engine.a.frequency.setTargetAtTime(Math.max(30, base), t, 0.06);
    engine.b.frequency.setTargetAtTime(Math.max(15, base * 0.5), t, 0.06);
    engine.lfo.frequency.setTargetAtTime(14 + rpm * 24 + g * 4, t, 0.1);
    engine.f.frequency.setTargetAtTime(420 + rpm * 900 + g * 260 + (throttle || 0) * 400, t, 0.1);
    const vol = on ? (0.05 + (throttle || 0) * 0.05 + frac * 0.03) * settings.engine : 0;
    engine.out.gain.setTargetAtTime(vol, t, 0.12);
    screech.g.gain.setTargetAtTime((drift || 0) * 0.07, t, 0.05);
    screech.f.frequency.setTargetAtTime(2000 + (drift || 0) * 900, t, 0.1);
    roar.g.gain.setTargetAtTime((nitro || 0) * 0.16, t, 0.08);
    roar.f.frequency.setTargetAtTime(600 + (nitro || 0) * 1400, t, 0.1);
}

// ----- sound effects -----
function tone(t, type, f0, f1, dur, gain, out) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
}
function whoosh(t, f0, f1, dur, gain) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(sfxBus); src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
const SFX = {
    click(t) { noise(t, 0.02, 'bandpass', 4800, 2, 0.22, sfxBus); tone(t, 'sine', 1150, 1700, 0.05, 0.11); },
    clickBuy(t) { noise(t, 0.02, 'bandpass', 4800, 2, 0.22, sfxBus); tone(t, 'sine', 900, 1500, 0.05, 0.12); tone(t + 0.05, 'sine', 1500, 2100, 0.06, 0.09); },
    hop(t) { tone(t, 'sine', 260, 520, 0.1, 0.18); noise(t, 0.05, 'lowpass', 900, 1, 0.12, sfxBus); },
    land(t) { noise(t, 0.12, 'lowpass', 500, 1, 0.35, sfxBus); tone(t, 'sine', 140, 60, 0.14, 0.3); },
    bump(t) { noise(t, 0.1, 'lowpass', 700, 1.2, 0.4, sfxBus); tone(t, 'triangle', 180, 80, 0.12, 0.22); noise(t, 0.08, 'bandpass', 3200, 2, 0.12, sfxBus); },
    crash(t) { noise(t, 0.5, 'lowpass', 1200, 0.8, 0.5, sfxBus); tone(t, 'sawtooth', 300, 50, 0.45, 0.2); tone(t + 0.1, 'triangle', 600, 120, 0.4, 0.15); noise(t + 0.05, 0.3, 'highpass', 3000, 0.8, 0.18, sfxBus); },
    gain(t) { tone(t, 'triangle', midi(88), null, 0.05, 0.04); },
    checkpoint(t) { [79, 84, 88].forEach((n, i) => tone(t + i * 0.06, 'triangle', midi(n), null, 0.25, 0.12)); },
    zap(t) { tone(t, 'square', 1400, 180, 0.22, 0.16); noise(t, 0.15, 'highpass', 3000, 0.8, 0.18, sfxBus); },
    crush(t) { tone(t, 'sine', 120, 35, 0.4, 0.55); noise(t, 0.35, 'lowpass', 700, 1, 0.45, sfxBus); },
    honk(t) { tone(t, 'square', 330, 320, 0.25, 0.1); tone(t, 'square', 415, 405, 0.25, 0.08); },
    siren(t) { for (let i = 0; i < 2; i++) tone(t + i * 0.3, 'square', 700, 1100, 0.3, 0.06); },
    levelUp(t) { [72, 76, 79, 84].forEach((n, i) => tone(t + i * 0.08, 'square', midi(n), null, 0.25, 0.1)); tone(t + 0.32, 'triangle', midi(88), null, 0.6, 0.18); },
    buy(t) { [79, 84, 88, 91, 96].forEach((n, i) => tone(t + i * 0.05, 'sine', midi(n), null, 0.3, 0.15)); },
    upgrade(t) { tone(t, 'sawtooth', 120, 480, 0.35, 0.12); [84, 88, 91, 96].forEach((n, i) => tone(t + 0.2 + i * 0.06, 'square', midi(n), null, 0.2, 0.08)); },
    denied(t) { tone(t, 'square', 220, 160, 0.14, 0.12); tone(t + 0.14, 'square', 180, 120, 0.18, 0.12); },
    boost(t) { whoosh(t, 400, 4000, 0.6, 0.35); tone(t, 'sawtooth', 160, 520, 0.4, 0.1); },
    nitro(t) { whoosh(t, 300, 2600, 0.5, 0.3); tone(t, 'sine', 80, 160, 0.4, 0.25); },
    turbo1(t) { whoosh(t, 600, 3000, 0.35, 0.22); tone(t, 'square', midi(76), midi(83), 0.15, 0.06); },
    turbo2(t) { whoosh(t, 500, 3800, 0.45, 0.28); tone(t, 'square', midi(79), midi(88), 0.18, 0.07); },
    turbo3(t) { whoosh(t, 400, 4600, 0.6, 0.34); [79, 84, 91].forEach((n, i) => tone(t + i * 0.04, 'square', midi(n), null, 0.18, 0.07)); },
    drift(t) { noise(t, 0.12, 'bandpass', 2600, 4, 0.12, sfxBus); },
    ramp(t) { whoosh(t, 300, 1800, 0.5, 0.25); tone(t, 'triangle', 300, 700, 0.3, 0.1); },
    cheer(t) {
        for (let i = 0; i < 6; i++) tone(t + i * 0.04, 'sine', 180 - i * 8, 90, 0.08, 0.2);
        [72, 76, 79, 84, 88].forEach((n, i) => tone(t + 0.25 + i * 0.07, 'square', midi(n), null, 0.3, 0.08));
        noise(t + 0.25, 0.6, 'highpass', 4000, 0.7, 0.12, sfxBus);
    },
    gate(t) {
        [84, 88, 91, 96, 100].forEach((n, i) => tone(t + i * 0.035, 'sine', midi(n), null, 0.5, 0.09));
        tone(t, 'triangle', 220, 880, 0.35, 0.12);
    },
    teleport(t) { for (let i = 0; i < 8; i++) tone(t + i * 0.03, 'sine', midi(76 + i * 3), null, 0.15, 0.07); },
    firework(t) { tone(t, 'sine', 900, 200, 0.35, 0.05); noise(t + 0.35, 0.4, 'lowpass', 2500, 0.8, 0.3, sfxBus); },
    quest(t) { [84, 91, 96].forEach((n, i) => tone(t + i * 0.09, 'triangle', midi(n), null, 0.35, 0.12)); },
    boom(t) { tone(t, 'sine', 90, 30, 0.7, 0.6); noise(t, 0.8, 'lowpass', 900, 0.8, 0.55, sfxBus); noise(t, 0.25, 'highpass', 2500, 0.8, 0.2, sfxBus); },
    beep(t) { tone(t, 'square', midi(69), null, 0.22, 0.12); tone(t, 'sine', midi(81), null, 0.25, 0.06); },
    go(t) { tone(t, 'square', midi(81), null, 0.5, 0.14); tone(t, 'sine', midi(93), null, 0.55, 0.08); whoosh(t + 0.05, 500, 3000, 0.5, 0.2); },
    orb(t, k) { const n = 84 + Math.min(14, (k || 1) - 1) * 1; tone(t, 'sine', midi(n), null, 0.14, 0.11); tone(t + 0.035, 'triangle', midi(n + 7), null, 0.16, 0.07); },
    trick(t) { whoosh(t, 700, 3200, 0.4, 0.26); tone(t, 'triangle', 380, 900, 0.25, 0.08); },
    trickDone(t) { tone(t, 'square', midi(88), null, 0.12, 0.06); tone(t + 0.06, 'square', midi(95), null, 0.16, 0.06); },
    best(t) { [84, 88, 91, 96, 100, 103].forEach((n, i) => tone(t + i * 0.06, 'square', midi(n), null, 0.25, 0.07)); },
};
export function sfx(name, arg) {
    if (!ctx || !SFX[name] || settings.sfx <= 0) return;
    SFX[name](ctx.currentTime + 0.005, arg);
}
