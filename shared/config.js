// Game data shared by the client and the Colyseus server.
// +1 Speed Go Kart Escape: driving gives +Speed, Speed fills your Level, every level makes your
// kart faster. Jump the ramps (each gap needs a top speed), dodge the hazards and reach the Wins
// pads, stage after stage. There are no in-app purchases: everything is bought with Wins.

export const CFG = {
    maxLevel: 150,
    // "NEW KARTSPEED: 10 -> 11": top speed 18 + 2 per level, +5 per rebirth (studs per second)
    kartBase: 18,
    kartPerLevel: 2,
    kartPerRebirth: 5,
    kartCap: 400,
    minCustom: 10,
    // Kart physics (the client drives, the server sanity-checks)
    grav: 110,
    // How fast a kart with Speed v really drives: moveA * v^moveP world studs per second (see
    // worldSpeed). The number climbs fast, the kart less so: ~18 at 20 Speed, ~32 at 64, ~70 at 330
    moveA: 4.2,
    moveP: 0.485,
    hopV: 26,
    // Speed is earned every gainInterval while you drive
    gainInterval: 0.35,
    moveMin: 3,
    respawnDelay: 1.3,
    shieldTime: 1.5,
    // Rebirth: from Level 20 (+6 per rebirth, up to 90). Level back to 1, +50% Speed, +25% Wins,
    // +5 kart speed for good
    rebirthBase: 20,
    rebirthInc: 6,
    rebirthCap: 90,
    rebirthStep: 0.5,
    rebirthWins: 0.25,
    // Turbo Rush on the server clock: every 30 min for 5 min, x2 Speed and x2 Wins for everyone
    event: { every: 30 * 60, length: 5 * 60, speed: 2, wins: 2 },
    boostMult: 2,
    boostMinutes: 15,
    starterPackMinutes: 15,
    teleportBackSecs: 12,
    friendBoost: 0.1,
    friendMax: 5,
    offlineHours: 8,
    offlineRate: 0.25,
    maxPlayers: 24,
};

// XP to finish each level, read off the reference (Level 0: 5, then 6, 7, 8, 9, 10, 13, 14, 16,
// 18, 21, 25, 28, 32, 37), then x1.14 a level. XP is earned 1:1 with Speed.
const XP_TABLE = [5, 6, 7, 8, 9, 10, 13, 14, 16, 18, 21, 25, 28, 32, 37];
export const xpFor = (L) => (L <= 15 ? XP_TABLE[Math.max(1, L) - 1] : Math.round(37 * Math.pow(1.14, L - 15)));

// ----- Garage upgrades (Wins) -----
// ENGINE: +5% top speed a tier. NITRO: a bigger, stronger, faster-filling tank. GRIP: sharper
// steering, quicker drift charge and more grip on ice.
export const UPGRADES = {
    engine: { name: 'Engine', ic: '⚙️', max: 12, base: 5, grow: 2.1, desc: (n) => '+' + (n * 5) + '% top speed' },
    nitro: { name: 'Nitro', ic: '🔥', max: 10, base: 8, grow: 2.2, desc: (n) => nitroSecs(n).toFixed(1) + 's tank, x' + nitroPower(n).toFixed(2) + ' boost' },
    grip: { name: 'Grip', ic: '🛞', max: 10, base: 6, grow: 2.15, desc: (n) => '+' + (n * 7) + '% steering & drift' },
    power: { name: 'Power', ic: '⚡', max: 15, base: 12, grow: 1.95, desc: (n) => '+' + (n * 10) + '% Speed earned' },
};
export const upgradeCost = (key, n) => Math.round(UPGRADES[key].base * Math.pow(UPGRADES[key].grow, n));
export const nitroSecs = (n) => 1.6 + 0.34 * (n || 0);
export const nitroPower = (n) => 1.32 + 0.022 * (n || 0);
export const nitroRecharge = (n) => 0.16 + 0.025 * (n || 0); // tank fraction per second
export const gripMult = (n) => 1 + 0.07 * (n || 0);
export const powerMult = (n) => 1 + 0.1 * (n || 0);
// Short code for the upgrades that show on a kart ("e3n2g1p0"), synced to other players
export const upgCode = (p) => 'e' + upg(p, 'engine') + 'n' + upg(p, 'nitro') + 'g' + upg(p, 'grip') + 'p' + upg(p, 'power');
export function parseUpg(code) {
    const o = { engine: 0, nitro: 0, grip: 0, power: 0 }, m = /e(\d+)n(\d+)g(\d+)p(\d+)/.exec(code || '');
    if (m) { o.engine = +m[1]; o.nitro = +m[2]; o.grip = +m[3]; o.power = +m[4]; }
    return o;
}
export const upg = (p, k) => (p && p.upg && p.upg[k]) || 0;

// Top speed before Custom Speed: level, rebirths and the Engine upgrade
export const baseSpeedFor = (L, R) => Math.min(CFG.kartCap, CFG.kartBase + CFG.kartPerLevel * Math.max(1, L || 1) + CFG.kartPerRebirth * (R || 0));
export const kartSpeedFor = (L, R, eng) => Math.round(baseSpeedFor(L, R) * (1 + 0.05 * (eng || 0)));
export const maxSpeedOf = (p) => kartSpeedFor(p.level, p.rebirths, upg(p, 'engine'));
export const rebirthLevel = (R) => Math.min(CFG.rebirthCap, CFG.rebirthBase + CFG.rebirthInc * (R || 0));
export const rebirthMult = (R) => 1 + CFG.rebirthStep * (R || 0);
export const rebirthWinsMult = (R) => 1 + CFG.rebirthWins * (R || 0);
// Nitro and drift boosts can push you past your top speed; the server allows for it
export const BOOST_SLACK = 1.65;

export function eventState(now) {
    const E = CFG.event, t = now / 1000, c = ((t % E.every) + E.every) % E.every;
    return c < E.length ? { on: true, left: E.length - c } : { on: false, left: E.every - c };
}

// =====================================================================================
// The course: 16 stages in one long speedway running north (+z) out of the lobby, all on the
// same floor (y = 0). Each stage: an entry gate, hazard sections with a checkpoint between them,
// a run-up to the big ramp, the gap (it needs the stage's speed), a landing, then the end zone:
// three lanes. Left (+x): a second ramp over a wider gap to the purple x2 Wins pad. Middle: on into
// the next stage. Right (-x): the yellow Wins pad.
// =====================================================================================
export const STAGE_W = 60;                 // corridor width: x from -30 to 30
export const LANE_X = 11;                  // end-zone dividers at x = +-11
// Ramps rise h over len and throw you up at vy; flight time back down to the road:
export const RAMP = { len: 12, h: 3.2, vy: 30 };
export const worldSpeed = (v) => Math.sign(v) * CFG.moveA * Math.pow(Math.abs(v), CFG.moveP);
export const speedFromWorld = (w) => Math.sign(w) * Math.pow(Math.abs(w) / CFG.moveA, 1 / CFG.moveP);
// Off a jump ramp below the Speed it needs, the kart flies short: (v / need)^4 of the needed
// distance, so a kart only a few points too slow clearly falls in
export const launchFactor = (v, need) => (!need || v >= need - 0.01 ? 1 : Math.pow(Math.max(0, v) / need, 4) * worldSpeed(need) / Math.max(0.01, worldSpeed(Math.max(0.01, v))));
export const KART_HW = 2.4;                // kart collision half-size (x and z)
export const flightTime = () => (RAMP.vy + Math.sqrt(RAMP.vy * RAMP.vy + 2 * CFG.grav * RAMP.h)) / CFG.grav;
// The widest gap a kart doing v clears: it leaves the lip a half-kart past it and lands as soon
// as its front edge is over the far side
export const gapFor = (v) => Math.round((worldSpeed(v) * flightTime() + 2 * KART_HW - 1.5) * 10) / 10;
// Run-up a kart needs to reach v from a standstill (it gets there in about half a second), plus some
export const runupFor = (v) => Math.round(worldSpeed(v) * 0.4 + 30);
export const PAD = { w: 14, d: 10, x: 20 };
export const LOBBY = { halfX: 104, z0: -120, z1: 80, wallHeight: 46, spawn: { x: 0, y: 0, z: -40 } };

// theme: wall / pillar / trim colours, floor (studs) and the accent used for neon and the sky tint
export const THEMES = {
    speedway: { wall: 0xff5a1e, pillar: 0x2a3352, floor: 0xb8bccb, floor2: 0xa4a9bc, trim: 0xffb02a, accent: 0xff6a2a, sky: 0xffc8a0, gate: 0xff8ad0 },
    laser: { wall: 0x2ad87a, pillar: 0x24304e, floor: 0xe4ecff, floor2: 0x9aaee0, trim: 0xffffff, accent: 0xff2a3a, sky: 0xb8ffd8, gate: 0xff8ad0, checker: true },
    police: { wall: 0xff7ab8, pillar: 0x3a3e58, floor: 0xbcbfcc, floor2: 0xa8acbc, trim: 0x3a8cff, accent: 0x3a8cff, sky: 0xffc8e6, gate: 0xff8ad0 },
    hammer: { wall: 0x8a4aff, pillar: 0x2a2452, floor: 0xc4bcd8, floor2: 0xaca4c8, trim: 0xffd028, accent: 0xffd028, sky: 0xd8c8ff, gate: 0xffd028 },
    tires: { wall: 0xffc828, pillar: 0x22222a, floor: 0xb4b4bc, floor2: 0x9c9ca8, trim: 0x22222a, accent: 0xff8a14, sky: 0xffe8a0, gate: 0xff8a14, stripes: true },
    crusher: { wall: 0x8a96b0, pillar: 0x30343e, floor: 0xb0b4c0, floor2: 0x989eae, trim: 0xff3a3a, accent: 0xff3a3a, sky: 0xd0d8e8, gate: 0xff5a5a },
    ice: { wall: 0x9ae4ff, pillar: 0x3a6a9a, floor: 0xe8f8ff, floor2: 0xc8ecff, trim: 0xffffff, accent: 0x5ae0ff, sky: 0xd8f4ff, gate: 0x9ae8ff, ice: true },
    city: { wall: 0x2a3a6a, pillar: 0x141a30, floor: 0x5a6078, floor2: 0x4a5068, trim: 0x2affe6, accent: 0x2affe6, sky: 0x4a5aa0, gate: 0xff3ad8, night: true },
    lava: { wall: 0x6a1a10, pillar: 0x200a08, floor: 0x5a4a48, floor2: 0x4a3a38, trim: 0xff8a1e, accent: 0xff6a14, sky: 0xff9a60, gate: 0xff8a1e, night: true },
    glitch: { wall: 0x14142a, pillar: 0x0a0a16, floor: 0x2a2a48, floor2: 0x1e1e38, trim: 0xff3ad8, accent: 0x3affd8, sky: 0x5a4aa0, gate: 0x3affd8, night: true },
    storm: { wall: 0x3a4a8a, pillar: 0x1a2250, floor: 0x7a84a8, floor2: 0x6a7498, trim: 0xffe05a, accent: 0xffe05a, sky: 0x6a7ab0, gate: 0xffe05a },
    chase: { wall: 0x3a6aff, pillar: 0x1a2250, floor: 0xb4b8c8, floor2: 0x9ca2b4, trim: 0xffffff, accent: 0xff2a3a, sky: 0xc8d8ff, gate: 0x3a8cff },
    mines: { wall: 0x7a8a4a, pillar: 0x3a4022, floor: 0xd8c08a, floor2: 0xc4ac78, trim: 0xffc414, accent: 0xff3a1e, sky: 0xffe0b0, gate: 0xffc414 },
    walls: { wall: 0x6a7080, pillar: 0x2a2e38, floor: 0xa0a4ae, floor2: 0x8c909c, trim: 0xff8a14, accent: 0xff8a14, sky: 0xd8dce8, gate: 0xff8a14 },
    night: { wall: 0x1a2450, pillar: 0x0a0e22, floor: 0x4a5068, floor2: 0x3e4458, trim: 0xff2a3a, accent: 0x3a8cff, sky: 0x3a4a8a, gate: 0xff2a3a, night: true },
    rainbow: { wall: 0xb86aff, pillar: 0x2a1a4a, floor: 0xf4ecff, floor2: 0xe0d0ff, trim: 0xffd028, accent: 0xff5ad8, sky: 0xffc8f0, gate: 0xffd028, rainbow: true },
};

// name, hint, theme, speed for the stage's big jump, base Wins, hazard sections [type, difficulty]
const S_ = (name, sub, theme, need, wins, plan) => ({ name, sub, theme: THEMES[theme], themeKey: theme, need, bonus: Math.round(need * 1.16 / 2) * 2, wins, plan });
export const STAGES = [
    S_('Stage 1', 'STARTER SPEEDWAY', 'speedway', 24, 1, [['cones', 0], ['ramps', 0], ['cones', 0.25]]),
    S_('Stage 2', 'LASER LANE', 'laser', 32, 2, [['lasers', 0.1], ['cones', 0.35], ['lasers', 0.35]]),
    S_('Stage 3', 'COP PATROL', 'police', 42, 4, [['cops', 0.15], ['lasers', 0.45], ['cops', 0.4]]),
    S_('Stage 4', 'POLICE CHASE', 'chase', 52, 8, [['chase', 0.1], ['chase', 0.3], ['chase', 0.5]]),
    S_('Stage 5', 'HAMMER HIGHWAY', 'hammer', 64, 16, [['hammers', 0.2], ['cops', 0.5], ['spinners', 0.35]]),
    S_('Stage 6', 'MINE FIELD', 'mines', 78, 32, [['mines', 0.2], ['hammers', 0.55], ['mines', 0.45]]),
    S_('Stage 7', 'TIRE TUMBLE', 'tires', 94, 64, [['tires', 0.3], ['spinners', 0.55], ['tires', 0.5]]),
    S_('Stage 8', 'CRUSHER CANYON', 'crusher', 112, 128, [['crushers', 0.35], ['mines', 0.6], ['crushers', 0.55]]),
    S_('Stage 9', 'CLOSING WALLS', 'walls', 132, 256, [['walls', 0.3], ['crushers', 0.65], ['walls', 0.55]]),
    S_('Stage 10', 'ICE DRIFT', 'ice', 154, 512, [['ice', 0.35], ['walls', 0.65], ['ice', 0.6]]),
    S_('Stage 11', 'RUSH HOUR', 'city', 178, 1024, [['traffic', 0.4], ['ice', 0.7], ['traffic', 0.65]]),
    S_('Stage 12', 'NIGHT PURSUIT', 'night', 204, 2048, [['chase', 0.6], ['traffic', 0.75], ['chase', 0.85]]),
    S_('Stage 13', 'LAVA BRIDGES', 'lava', 232, 4096, [['lava', 0.5], ['mines', 0.8], ['lava', 0.75]]),
    S_('Stage 14', 'GLITCH GRID', 'glitch', 262, 8192, [['glitch', 0.55], ['lava', 0.85], ['glitch', 0.75]]),
    S_('Stage 15', 'THUNDER STORM', 'storm', 294, 16384, [['wind', 0.6], ['glitch', 0.85], ['wind', 0.85]]),
    S_('Stage 16', 'RAINBOW FINALE', 'rainbow', 330, 32768, [['lasers', 1], ['chase', 1], ['crushers', 1], ['walls', 1]]),
];
export const ENTRY = 40, REST = 30;
// Room after the big jump to pick a lane (about 1.2 s at the stage speed)
const LANDING = (v) => Math.max(70, Math.round(worldSpeed(v) * 1.2)), END_RUN = 26, ISLAND = (v) => Math.max(36, Math.round(worldSpeed(v) * 0.3));
{
    let z = LOBBY.z1;
    STAGES.forEach((s, i) => {
        s.i = i;
        s.zS = z;
        // A section lasts about 3.5 s at the stage's speed
        s.secLen = Math.max(120, Math.round(worldSpeed(s.need) * 3.5));
        s.gap = gapFor(s.need);
        s.bonusGap = gapFor(s.bonus);
        // Section k spans [sec[k].a, sec[k].b]; checkpoint k sits in the rest before section k
        let a = z + ENTRY;
        s.secs = s.plan.map(([type, d], k) => {
            const sec = { type, d, a, b: a + s.secLen };
            a = sec.b + REST;
            return sec;
        });
        // Run-up (starts with a checkpoint), the big ramp, the gap, the landing
        s.runup0 = s.secs[s.secs.length - 1].b;
        s.ramp0 = s.runup0 + runupFor(s.need);
        s.lip = s.ramp0 + RAMP.len;
        s.land = s.lip + s.gap;
        // End zone: lanes from e0; the bonus ramp in the left lane, its island up to the end wall
        s.e0 = s.land + LANDING(s.need);
        s.bRamp0 = s.e0 + END_RUN + Math.max(0, runupFor(s.bonus) - runupFor(s.need));
        s.bLip = s.bRamp0 + RAMP.len;
        s.bLand = s.bLip + s.bonusGap;
        s.zE = s.bLand + ISLAND(s.bonus);
        s.len = s.zE - s.zS;
        s.pads = [
            { k: 0, x: -PAD.x, z: s.zE - 12, wins: s.wins, need: 0 },
            { k: 1, x: PAD.x, z: s.zE - 12, wins: s.wins * 2, need: s.bonus },
        ];
        // Speed you needed to get into this stage at all (the jump of the stage before)
        s.entry = i ? STAGES[i - 1].need : 0;
        z = s.zE;
    });
}
export const COURSE_END = STAGES[STAGES.length - 1].zE;
// The finish plaza after the last stage: the golden trophy and the ESCAPE pad
export const SUMMIT = { x: 0, z: COURSE_END + 46, wins: 100000, len: 80 };
// Stage at a z position (-1 in the lobby); the finish plaza counts as the last stage
export function stageAt(z) {
    if (z < LOBBY.z1) return -1;
    for (let i = 0; i < STAGES.length; i++) if (z < STAGES[i].zE) return i;
    return STAGES.length - 1;
}

// =====================================================================================
// Lobby shops. Everything costs Wins.
// =====================================================================================
// GO-KARTS: each multiplies the Speed you earn. Later karts also need rebirths (as in the reference).
const K = (id, name, mult, cost, reb, style, body, accent, extra) => Object.assign({ id, name, mult, cost, reb, style, body, accent }, extra || {});
export const KARTS = [
    K('wooden', 'Wooden Go-Kart', 1, 0, 0, 'wooden', 0x8a5a32, 0x5a3a20),
    K('diy', 'DIY Go-Kart', 2.5, 10, 0, 'diy', 0x3a8cff, 0xffd028),
    K('good', 'Good Go-Kart', 4, 45, 0, 'classic', 0xe8283a, 0xffffff),
    K('fast', 'Fast Go-Kart', 5.5, 140, 1, 'sport', 0xff3a3a, 0xffffff, { wing: true }),
    K('street', 'Street Go-Kart', 7, 350, 1, 'street', 0x2ad8ff, 0x1a1a24, { glow: 0x2ad8ff }),
    K('excavator', 'Excavator Go-Kart', 8, 800, 2, 'excavator', 0xffc414, 0x22222a),
    K('racer', 'Racer Go-Kart', 9, 1600, 2, 'racer', 0x1a6aff, 0xffffff, { wing: true }),
    K('hyper', 'Hyper Go-Kart', 10, 3200, 3, 'hyper', 0xff6a14, 0x1a1a24, { wing: true, glow: 0xff8a2a }),
    K('police', 'Police Go-Kart', 12, 6500, 4, 'police', 0xffffff, 0x14141e),
    K('flame', 'Flamethrower Go-Kart', 16, 13000, 5, 'flame', 0xb8140c, 0xff8a14, { fire: true, glow: 0xff5a14 }),
    K('pro', 'Pro Racer Go-Kart', 22, 26000, 6, 'pro', 0xf4f4f8, 0xe8102a, { wing: true }),
    K('ninja', 'Ninja Go-Kart', 30, 52000, 7, 'ninja', 0x16141e, 0x9a3aff, { glow: 0x9a3aff }),
    K('energy', 'Purple Energy Go-Kart', 40, 105000, 8, 'energy', 0x6a1ad8, 0xff5aff, { glow: 0xd25aff, core: true }),
    K('lightning', 'Lightning Go-Kart', 55, 220000, 10, 'lightning', 0xffd814, 0x2a8cff, { glow: 0x5ad8ff, sparks: true, wing: true }),
    K('golden', 'Golden Go-Kart', 75, 480000, 12, 'golden', 0xffc828, 0xfff2b0, { gold: true, glow: 0xffd028, wing: true }),
    K('galaxy', 'Galaxy Go-Kart', 100, 1000000, 15, 'galaxy', 0x2a0a5a, 0x5affff, { galaxy: true, glow: 0xb85aff, wing: true }),
    // SUPER CARS: modern supercars with glass canopies, LED light bars and modern rims
    K('egt', 'Electro GT', 6, 300, 1, 'gt', 0x1a8cff, 0xffffff, { super: true, glow: 0x5ad8ff }),
    K('cyber', 'Cyber Wedge', 18, 20000, 5, 'cyber', 0xb8bcc8, 0x2affe6, { super: true, glow: 0x2affe6 }),
    K('formula', 'Formula X', 35, 80000, 7, 'formula', 0xe8102a, 0xffffff, { super: true, glow: 0xff3a5a }),
    K('phantom', 'Hyper Phantom', 60, 300000, 10, 'phantom', 0x111116, 0xff1a2a, { super: true, glow: 0xff1a2a }),
    K('hover', 'Hover Racer', 110, 1200000, 14, 'hover', 0xf4f6ff, 0x3ad8ff, { super: true, glow: 0x3ad8ff, hover: true }),
    K('prism', 'Quantum Prism', 200, 5000000, 18, 'prism', 0xd8d8ff, 0xff5aff, { super: true, glow: 0xffffff, prism: true }),
    // Only from the OP STARTER PACK
    K('rocket', 'Rocket Go-Kart', 3.5, 0, 0, 'rocket', 0xff3ad8, 0xffffff, { pack: true, fire: true, glow: 0xff5ad8 }),
];
export const kartById = Object.fromEntries(KARTS.map((d) => [d.id, d]));
export const SHOWROOM = KARTS.filter((d) => !d.pack && !d.super);
export const SUPERCARS = KARTS.filter((d) => d.super);

// SPEED ROLLERS (treadmills): drive onto one and every bit of Speed counts xN
export const TREADMILLS = [
    { id: 't3', mult: 3, cost: 0, color: 0xffd028, label: 'Starter' },
    { id: 't6', mult: 6, cost: 20, color: 0x3ad8ff },
    { id: 't12', mult: 12, cost: 110, color: 0x7aff3a },
    { id: 't25', mult: 25, cost: 550, color: 0xff5ad8 },
    { id: 't50', mult: 50, cost: 2800, color: 0xff8a14, tag: '*SUPER OP*' },
    { id: 't100', mult: 100, cost: 14000, color: 0xff3a4a, tag: '*INSANE*' },
    { id: 't200', mult: 200, cost: 70000, color: 0xb85aff, tag: '*GODLY*' },
    { id: 'aqua', mult: 40, cost: 0, daily: true, color: 0x2ae6ff, label: 'Aqua' },
];
export const treadById = Object.fromEntries(TREADMILLS.map((d) => [d.id, d]));
// Roller bays on the lobby's east side, every one facing north (+z)
export const TREAD_GEO = { x0: 30, z: -78, step: 9.5, len: 16, width: 7, top: 0.6 };
export function treadmillAt(x, y, z) {
    const g = TREAD_GEO;
    if (Math.abs(z - g.z) > g.len / 2 + 1 || y > g.top + 3 || y < g.top - 1) return null;
    for (let i = 0; i < TREADMILLS.length; i++) {
        if (Math.abs(x - (g.x0 + i * g.step)) <= g.width / 2 + 0.6) return TREADMILLS[i];
    }
    return null;
}

// TRAILS: a light ribbon behind your kart, unlocked by rebirths. The Moon Trail is Day 3's reward.
export const TRAILS = [
    { id: 'starter', name: 'Starter', mult: 1, reb: 0, color: 0xffffff },
    { id: 'r1', name: 'Bubblegum', mult: 1.5, reb: 1, color: 0xff7ad8 },
    { id: 'r3', name: 'Sky Streak', mult: 2, reb: 3, color: 0x3ad8ff },
    { id: 'r5', name: 'Lime Zap', mult: 3, reb: 5, color: 0x7aff3a },
    { id: 'r10', name: 'Inferno', mult: 5, reb: 10, color: 0xff6a14 },
    { id: 'r20', name: 'Rainbow Road', mult: 8, reb: 20, color: 0xffffff, rainbow: true },
    { id: 'moon', name: 'Moon Trail', mult: 1.5, reb: 0, daily: true, color: 0xc8d8ff },
];
export const trailById = Object.fromEntries(TRAILS.map((d) => [d.id, d]));

// Boosts in the Shop (all Wins)
export const BOOSTS = {
    pass2x: { name: 'x2 Speed', cost: 50, ic: '⚡', desc: 'Double all Speed you earn. Forever!' },
    boost: { name: 'x2 Speed Boost', cost: 10, ic: '⏱️', desc: '15 minutes of double Speed (stacks)' },
    starter: { name: 'OP STARTER PACK', cost: 10, ic: '🎁', desc: 'Rocket Go-Kart (x3.5) + 15 min x2 Speed + 1K Speed', speed: 1000, kart: 'rocket' },
};
// Bottom bar: "+1 Level" and three Speed packs, priced in Wins and scaled to your level.
// The packs give 10%, 35% and 75% of the XP your current level needs.
export const levelCost = (L) => Math.max(1, Math.ceil(0.5 * Math.pow(1.13, Math.max(1, L))));
export const PACKS = [
    { frac: 0.1, cost: 0.15, color: 'g-blue' },
    { frac: 0.35, cost: 0.4, color: 'g-yellow' },
    { frac: 0.75, cost: 0.7, color: 'g-purple' },
];
export const packAmount = (i, L) => Math.max(1, Math.floor(xpFor(L) * PACKS[i].frac));
export const packCost = (i, L) => Math.max(1, Math.ceil(levelCost(L) * PACKS[i].cost));

export const CODES = {
    GOKART: { wins: 5 },
    SPEED: { speed: 1000 },
    NITRO: { boost: 10 },
    DRIFT: { speed: 2500 },
    LEGION: { wins: 25 },
    RELEASE: { speed: 5000, wins: 10 },
};
// Free Reward chest in the lobby (once a day)
export const GROUP_CHEST = { hours: 24, speed: 1500, wins: 3 };

// Session playtime rewards (minutes since joining)
export const FREE = [
    { min: 2, speed: 200 }, { min: 5, wins: 2 }, { min: 10, speed: 2500 },
    { min: 15, wins: 5 }, { min: 25, speed: 25000 }, { min: 40, wins: 25 }, { min: 60, boost: 15 },
];
// Daily Rewards: one claim per UTC day; missing a day resets the streak
export const DAILY = [
    { speed: 100 }, { wins: 5 }, { trail: 'moon' }, { speed: 2500 }, { wins: 25 }, { wins: 250 }, { tread: 'aqua' },
];
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function dailyStatus(d, now) {
    d = d || {};
    const today = dayKey(now), yesterday = dayKey(now - 86400000);
    const can = d.last !== today;
    const streak = d.last === today || d.last === yesterday ? d.streak || 0 : 0;
    return { can, streak, day: Math.min(DAILY.length - 1, can ? streak % DAILY.length : Math.max(0, streak - 1) % DAILY.length) };
}
export const rewardText = (r) => [
    r.speed ? '+' + fmt(r.speed) + ' Speed' : '',
    r.wins ? '+' + fmt(r.wins) + ' Wins' : '',
    r.boost ? r.boost + ' min x2 Speed' : '',
    r.trail ? trailById[r.trail].name : '',
    r.tread ? treadById[r.tread].label + ' x' + treadById[r.tread].mult + ' Roller' : '',
    r.kart ? kartById[r.kart].name : '',
].filter(Boolean).join(' & ');

// Quests (the reference's "Tutorial: Get 10 Wins!"): one at a time, each pays a little
export const QUESTS = [
    { text: 'Drive into Stage 1', kind: 'stage', n: 1, reward: { speed: 50 } },
    { text: 'Tutorial: Get 10 Wins!', kind: 'wins', n: 10, reward: { speed: 150 } },
    { text: 'Buy the DIY Go-Kart', kind: 'kart', n: 2, reward: { wins: 3 } },
    { text: 'Upgrade your Engine', kind: 'upg', n: 1, reward: { speed: 300 } },
    { text: 'Reach Stage 3', kind: 'stage', n: 3, reward: { wins: 5 } },
    { text: 'Buy the x6 Speed Roller', kind: 'tread', n: 6, reward: { speed: 600 } },
    { text: 'Reach Level 20', kind: 'level', n: 20, reward: { wins: 10 } },
    { text: 'Reach Stage 5', kind: 'stage', n: 5, reward: { wins: 20 } },
    { text: 'Rebirth once', kind: 'rebirth', n: 1, reward: { wins: 30 } },
    { text: 'Reach Stage 6', kind: 'stage', n: 6, reward: { wins: 60 } },
    { text: 'Reach Stage 8', kind: 'stage', n: 8, reward: { wins: 250 } },
    { text: 'Buy a Super Car', kind: 'super', n: 1, reward: { wins: 100 } },
    { text: 'Reach Stage 10', kind: 'stage', n: 10, reward: { wins: 1500 } },
    { text: 'Reach Stage 12', kind: 'stage', n: 12, reward: { wins: 6000 } },
    { text: 'Reach Stage 14', kind: 'stage', n: 14, reward: { wins: 25000 } },
    { text: 'Reach Stage 16', kind: 'stage', n: 16, reward: { wins: 100000 } },
    { text: 'ESCAPE the Speedway!', kind: 'escape', n: 1, reward: { wins: 250000 } },
];
export function questProgress(q, p) {
    if (!q) return 0;
    switch (q.kind) {
        case 'wins': return p.totalWins || 0;
        case 'kart': return Object.keys(p.karts || {}).length + 1;
        case 'upg': return (upg(p, 'engine') + upg(p, 'nitro') + upg(p, 'grip') + upg(p, 'power'));
        case 'super': return Object.keys(p.karts || {}).filter((id) => kartById[id] && kartById[id].super).length;
        case 'level': return p.level || 1;
        case 'stage': return (p.maxStage ?? -1) + 1;
        case 'tread': return Object.keys(p.treads || {}).some((id) => (treadById[id] || {}).mult >= q.n && !treadById[id].daily) ? q.n : 0;
        case 'rebirth': return p.rebirths || 0;
        case 'escape': return p.escaped ? 1 : 0;
        default: return 0;
    }
}

// Driver outfits for the blocky fallback body (cycle by join order)
export const KITS = [
    { shirt: 0x14141e, shorts: 0x2a2a3a, socks: 0x14141e },
    { shirt: 0xe8283a, shorts: 0x1e2a44, socks: 0xffffff },
    { shirt: 0x3ad8ff, shorts: 0x1e3a6a, socks: 0xffffff },
    { shirt: 0x7aff3a, shorts: 0x1e2a44, socks: 0xffffff },
    { shirt: 0xffc828, shorts: 0x6a3a1e, socks: 0xffffff },
    { shirt: 0x9a4aff, shorts: 0x1e1a3a, socks: 0xffffff },
    { shirt: 0xff8a14, shorts: 0x14141e, socks: 0xffffff },
    { shirt: 0xffffff, shorts: 0x3a3a5a, socks: 0xff6ac8 },
];
export const SKINS = [0xe1af87, 0xc88c5f, 0x8c5a3c, 0x5f3c28, 0xf0c8a0];

// Every multiplier on earned Speed, as the Stats panel lists them
export function multipliers(p, now, friends, onTread) {
    const ev = eventState(now);
    const kart = kartById[p.kart] || kartById.wooden;
    const trail = trailById[p.trail];
    return {
        global: ev.on ? CFG.event.speed : 1,
        pass: (p.pass2x ? 2 : 1) * ((now || Date.now()) < (p.boostUntil || 0) ? CFG.boostMult : 1),
        kart: kart.mult,
        trail: trail ? trail.mult : 1,
        rebirth: rebirthMult(p.rebirths),
        power: powerMult(upg(p, 'power')),
        friends: 1 + CFG.friendBoost * Math.min(CFG.friendMax, friends || 0),
        tread: onTread || 1,
    };
}
export function speedMult(p, now, friends) {
    const m = multipliers(p, now, friends);
    return m.global * m.pass * m.kart * m.trail * m.rebirth * m.power * m.friends;
}

const SUF = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
// 2700 -> "2.7K", 1000000 -> "1M", 950 -> "950"
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    let i = -1, s = v;
    while (s >= 1000 && i < SUF.length - 1) { s /= 1000; i++; }
    const t = s >= 100 ? String(Math.floor(s)) : (Math.floor(s * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return t + SUF[i];
}
export function fmt1(v) {
    v = v || 0;
    if (v >= 1000) return fmt(v);
    return (Math.floor(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + sec : m + ':' + sec;
}
export function clock3(s) {
    s = Math.max(0, Math.floor(s));
    const p = (n) => String(n).padStart(2, '0');
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
}
// Stage timer: 12.34 -> "12.34s", 75.2 -> "1:15.20"
export function lapTime(s) {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60), r = s - m * 60;
    return m ? m + ':' + r.toFixed(2).padStart(5, '0') : r.toFixed(2) + 's';
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
