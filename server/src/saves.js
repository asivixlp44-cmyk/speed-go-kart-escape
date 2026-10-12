import crypto from 'node:crypto';

// Signed progress backups kept in the player's browser. Hosts with a temporary disk
// (Render's free tier) lose profiles.json whenever the service restarts; on the next join
// the browser hands its last backup back and we restore it. The HMAC stops edited backups.
// On Legion the per-game JWT_SECRET it injects signs the backups (Legion has no custom env vars)
const SECRET = process.env.SAVE_SECRET || process.env.JWT_SECRET || 'go-kart-escape-dev-only';
if (!process.env.SAVE_SECRET && !process.env.JWT_SECRET) console.warn('[saves] no SAVE_SECRET / JWT_SECRET; using the dev-only key');

const FIELDS = [
    'speed', 'wins', 'totalWins', 'level', 'xp', 'rebirths', 'karts', 'kart', 'upg', 'treads', 'trails', 'trail',
    'pass2x', 'boostUntil', 'customSpeed', 'starterPack', 'maxStage', 'escaped', 'quest', 'codes', 'daily', 'chestAt', 'best', 'firstPlay',
];
const MAX_LEN = 8000;

const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

export function sealProfile(p) {
    const data = { uid: p.uid };
    for (const k of FIELDS) data[k] = p[k];
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    return payload + '.' + sign(payload);
}

// Returns the saved fields when the backup is genuine and belongs to one of the uids, else null
export function openSave(save, uids) {
    if (typeof save !== 'string' || save.length > MAX_LEN) return null;
    const dot = save.lastIndexOf('.');
    if (dot < 1) return null;
    const payload = save.slice(0, dot), sig = Buffer.from(save.slice(dot + 1));
    const want = Buffer.from(sign(payload));
    if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return null;
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return null; }
    if (!data || !uids.includes(data.uid)) return null;
    const out = {};
    for (const k of FIELDS) if (data[k] !== undefined) out[k] = data[k];
    return out;
}
