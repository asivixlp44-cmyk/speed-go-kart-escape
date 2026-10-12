// Turns the session records into the numbers that explain playtime: how long sessions last,
// how far players get, and where and why they crash.
import { STAGES } from '../../shared/config.js';
import { loadSessions } from './profiles.js';

const BUCKETS = [[0, 60, '<1 min'], [60, 180, '1-3 min'], [180, 300, '3-5 min'], [300, 600, '5-10 min'], [600, 1200, '10-20 min'], [1200, Infinity, '20+ min']];
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[i];
}
function lengths(list) {
    const secs = list.map((d) => d.secs).sort((a, b) => a - b);
    const mean = secs.reduce((a, b) => a + b, 0) / Math.max(1, secs.length);
    return {
        sessions: list.length,
        meanMin: Math.round(mean / 6) / 10,
        medianMin: Math.round(quantile(secs, 0.5) / 6) / 10,
        p25Min: Math.round(quantile(secs, 0.25) / 6) / 10,
        p75Min: Math.round(quantile(secs, 0.75) / 6) / 10,
        buckets: Object.fromEntries(BUCKETS.map(([a, b, name]) => [name, pct(secs.filter((s) => s >= a && s < b).length, secs.length) + '%'])),
    };
}

export async function statsSummary(days) {
    const since = Date.now() - days * 86400000;
    // Very short visits (under 10 s) are page bounces, counted separately
    const all = await loadSessions(since, 20000);
    const list = all.filter((d) => d.secs >= 10);
    const fresh = list.filter((d) => d.fresh);
    const stages = STAGES.map((s, i) => {
        const reached = list.filter((d) => d.maxStage >= i).length;
        const cleared = list.filter((d) => d.pads && d.pads[i]).length;
        const deaths = list.reduce((a, d) => a + ((d.deaths && d.deaths[i]) || 0), 0);
        const quitHere = list.filter((d) => d.endStage === i).length;
        return { stage: s.name, reachedPct: pct(reached, list.length), clearedPct: pct(cleared, list.length), clearedOfReachedPct: pct(cleared, reached), deaths, deathsPerVisitor: reached ? Math.round((deaths / reached) * 10) / 10 : 0, leftWhileHere: quitHere };
    });
    const causes = {};
    for (const d of list) for (const [c, n] of Object.entries(d.causes || {})) causes[c] = (causes[c] || 0) + n;
    return {
        days, since: new Date(since).toISOString(),
        bounces: all.length - list.length,
        all: lengths(list),
        newPlayers: lengths(fresh),
        returning: lengths(list.filter((d) => !d.fresh)),
        neverLeftLobbyPct: pct(list.filter((d) => d.maxStage < 0).length, list.length),
        leftInLobbyPct: pct(list.filter((d) => d.endStage < 0).length, list.length),
        leftWhileCrashedPct: pct(list.filter((d) => d.endDead).length, list.length),
        avgDeaths: Math.round((list.reduce((a, d) => a + Object.values(d.deaths || {}).reduce((x, y) => x + y, 0), 0) / Math.max(1, list.length)) * 10) / 10,
        treadmillShareOfTimePct: pct(list.reduce((a, d) => a + (d.treadSecs || 0), 0), list.reduce((a, d) => a + d.secs, 0)),
        boughtSomethingPct: pct(list.filter((d) => d.buys > 0).length, list.length),
        rebirthedPct: pct(list.filter((d) => d.rebirths > 0).length, list.length),
        stages,
        deathCauses: causes,
    };
}
