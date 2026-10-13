import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, hasProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile,
    topProfiles, recordSession, USE_DB,
} from './profiles.js';
import { sealProfile, openSave } from './saves.js';
import { verifyBloxityToken } from './bloxity.js';
import {
    CFG, LOBBY, STAGES, PAD, SUMMIT, kartById, treadById, trailById, UPGRADES,
    BOOSTS, CODES, FREE, DAILY, GROUP_CHEST, QUESTS, KITS, SKINS, BOOST_SLACK,
    xpFor, maxSpeedOf, kartSpeedFor, rebirthLevel, rebirthWinsMult, eventState, speedMult, treadmillAt, stageAt,
    upgradeCost, upg, upgCode, levelCost, packAmount, packCost, questProgress, dailyStatus, dayKey, rewardText, fmt, clamp,
} from '../../shared/config.js';

const GREEN = '#7dff6b', RED = '#ff5a5a', GOLD = '#ffd028', BLUE = '#6fe0ff', PINK = '#ff8ad8';

function cleanName(name) {
    return String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
}
const randomName = () => 'Racer' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');

export const liveRooms = new Set();

// One shared world: the garage lobby and the 12-stage speedway. Driving is client-side; everything
// that changes progress (Speed, Wins, karts, upgrades, rebirths) is decided here. Nothing is sold
// for real money: every price is in Wins.
export class KartRoom extends Room {
    maxClients = CFG.maxPlayers;

    onCreate() {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.joinCount = 0;

        const on = (type, fn) => this.onMessage(type, (client, m) => { try { fn.call(this, client, m || {}); } catch (e) { console.warn('[msg]', type, e.message); } });
        on('move', this.onMove);
        on('pad', this.onPad);
        on('summit', this.onSummit);
        on('kart', this.onKart);
        on('upgrade', this.onUpgrade);
        on('tread', this.onTread);
        on('trail', this.onTrail);
        on('boost', this.onBoost);
        on('level', this.onLevel);
        on('pack', this.onPack);
        on('rebirth', this.onRebirth);
        on('free', this.onFree);
        on('daily', this.onDaily);
        on('chest', this.onChest);
        on('code', this.onCode);
        on('custom', this.onCustom);
        on('auth', this.onBloxityLogin);
        on('avatar', this.onAvatar);
        on('emote', this.onEmote);
        on('chat', this.onChat);
        on('friends', this.onFriends);
        on('died', this.onDied);
        on('orb', this.onOrb);

        this.setSimulationInterval((dt) => this.tick(dt), 100);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
        this.lastEvent = eventState(Date.now()).on;
        this.clock.setInterval(() => this.eventTick(), 1000);
    }

    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name);
        }
        await loadProfile(uid);
        // A fresh server on a temporary disk restores the browser's signed backup.
        // With a database the profile is never lost, so backups are not accepted at all.
        const restore = !USE_DB && !hasProfile(uid) && openSave(options.save, [uid, guest]);
        const profile = getProfile(uid, name, randomName());
        if (restore) { Object.assign(profile, restore); markDirty(); }
        const player = new PlayerState();
        player.name = profile.name;
        player.av = cleanAvatar(options.av);
        player.x = LOBBY.spawn.x; player.y = LOBBY.spawn.y; player.z = LOBBY.spawn.z; player.ry = 0;
        player.kit = this.joinCount % KITS.length;
        player.skin = (this.joinCount * 3) % SKINS.length;
        this.joinCount++;
        this.state.players.set(client.sessionId, player);
        this.sessions.set(client.sessionId, {
            client, profile, player,
            moving: false, lastMove: 0, gainT: 0, friends: 0, treadMult: 0, treadSeen: 0, orbTok: CFG.orbRate * 2, orbAt: Date.now(), orbSeen: new Map(),
            joinedAt: Date.now(), freeClaimed: {}, cooldowns: new Map(), guest, lastChat: 0, padArmed: true,
            stats: {
                fresh: Date.now() - (profile.firstPlay || 0) < 60000, maxStage: -1, pads: {}, deaths: {}, causes: {}, buys: 0,
                speed0: profile.speed, wins0: profile.totalWins, level0: profile.level, rebirths0: profile.rebirths, treadSecs: 0,
            },
        });
        this.syncPublic(client.sessionId);
        client.send('hello', { now: Date.now(), bloxity: uid.startsWith('legion_') });
        this.payOffline(this.sessions.get(client.sessionId));
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    onDrop(client) {
        this.allowReconnection(client, 30);
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client;
        client.send('hello', { now: Date.now(), bloxity: s.profile.uid.startsWith('legion_') });
        this.sendProfile(client.sessionId);
        this.broadcastBoards(client);
    }

    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        if (s) this.logSession(s);
        // Left while training: the roller keeps earning until they come back (payOffline)
        if (s && Date.now() - s.treadSeen < 3000 && s.treadMult > 0) s.profile.offline = { mult: s.treadMult, at: Date.now() };
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        markDirty();
        if (s && !isOnline(s.profile.uid)) releaseProfile(s.profile.uid, isOnline);
    }

    // One record per finished session, for /api/stats (no names, no ids)
    logSession(s) {
        const st = s.stats, p = s.profile, pl = s.player;
        if (!st || st.logged) return;
        st.logged = true;
        recordSession({
            at: new Date(), secs: Math.round((Date.now() - s.joinedAt) / 1000), fresh: st.fresh,
            maxStage: st.maxStage, endStage: stageAt(pl.z), endDead: pl.anim === 3,
            pads: st.pads, deaths: st.deaths, causes: st.causes, buys: st.buys, treadSecs: Math.round(st.treadSecs),
            level0: st.level0, level1: p.level, wins0: st.wins0, wins1: p.totalWins, rebirths: p.rebirths - st.rebirths0,
            bloxity: p.uid.startsWith('legion_'),
        }).catch((e) => console.warn('[stats]', e.message));
    }
    // A Speed Orb picked up: rate-limited (a token bucket) and each orb only once per respawn
    onOrb(client, m) {
        const s = this.sessions.get(client.sessionId);
        const id = m.i | 0;
        if (!s || id < 0 || id > 100000) return;
        const now = Date.now();
        s.orbTok = Math.min(CFG.orbRate * 2, s.orbTok + (now - s.orbAt) / 1000 * CFG.orbRate);
        s.orbAt = now;
        const last = s.orbSeen.get(id);
        if (s.orbTok < 1 || (last && now - last < (CFG.orbRespawn - 2) * 1000)) return;
        s.orbTok -= 1;
        s.orbSeen.set(id, now);
        if (s.orbSeen.size > 600) for (const [k, t] of s.orbSeen) if (now - t > CFG.orbRespawn * 1000) s.orbSeen.delete(k);
        s.stats.orbs = (s.stats.orbs || 0) + 1;
        this.addSpeed(s, CFG.orbSpeed, true);
        this.syncPublic(client.sessionId);
    }
    onDied(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !this.cooldown(s, 'died', 0.5)) return;
        const st = STAGES[m.s | 0] ? m.s | 0 : -1;
        const cause = String(m.c || 'fall').replace(/[^a-z ]/g, '').slice(0, 16) || 'fall';
        s.stats.deaths[st] = (s.stats.deaths[st] || 0) + 1;
        s.stats.causes[cause] = (s.stats.causes[cause] || 0) + 1;
    }

    onDispose() { liveRooms.delete(this); for (const s of this.sessions.values()) this.logSession(s); markDirty(); return saveProfiles(); }

    // ----- helpers -----
    syncPublic(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile, pl = s.player;
        pl.speed = p.speed; pl.wins = p.wins; pl.level = p.level; pl.xp = p.xp;
        pl.rebirths = p.rebirths; pl.kart = p.kart || 'wooden'; pl.trail = p.trail || ''; pl.upg = upgCode(p);
    }
    sendProfile(id) {
        const s = this.sessions.get(id);
        if (!s) return;
        const p = s.profile;
        s.client.send('profile', {
            karts: p.karts, kart: p.kart, upg: p.upg, treads: p.treads, trails: p.trails, trail: p.trail,
            pass2x: p.pass2x, boostUntil: p.boostUntil, customSpeed: p.customSpeed, starterPack: p.starterPack,
            maxStage: p.maxStage, escaped: p.escaped, quest: p.quest, codes: p.codes, totalWins: p.totalWins, best: p.best,
            firstPlay: p.firstPlay, freeClaimed: s.freeClaimed, joinedAt: s.joinedAt, daily: p.daily, chestAt: p.chestAt,
            save: sealProfile(p),
        });
    }
    toast(s, text, color) { s.client.send('toast', { text, color }); }
    cooldown(s, key, seconds) {
        const now = Date.now();
        if ((s.cooldowns.get(key) || 0) > now) return false;
        s.cooldowns.set(key, now + seconds * 1000);
        return true;
    }
    changed(id) {
        const s = this.sessions.get(id);
        if (s) this.checkQuest(s);
        this.syncPublic(id); this.sendProfile(id); markDirty();
    }
    fx(s, kind) { s.client.send('fx', { kind: kind || 'confetti' }); }
    // Pays with Wins; false (and a toast) when the player can't afford it
    spend(s, cost) {
        if (!(cost >= 0) || s.profile.wins < cost) {
            this.toast(s, 'Not Enough Wins! (need ' + fmt(Math.max(0, cost - s.profile.wins)) + ' more)', RED);
            return false;
        }
        s.profile.wins -= cost;
        s.stats.buys++;
        return true;
    }

    addSpeed(s, amount, boosted) {
        const p = s.profile;
        if (!(amount > 0)) return 0;
        if (boosted) amount = Math.floor(amount * speedMult(p, Date.now(), s.friends) + 0.5);
        p.speed += amount;
        // XP is earned 1:1 with Speed; at MAX level the bar keeps filling up to its cap
        const old = p.level;
        p.xp += amount;
        while (p.level < CFG.maxLevel && p.xp >= xpFor(p.level)) { p.xp -= xpFor(p.level); p.level++; }
        if (p.level >= CFG.maxLevel) p.xp = Math.min(p.xp, xpFor(CFG.maxLevel));
        if (p.level > old) this.levelMsg(s, old);
        markDirty();
        return amount;
    }
    levelMsg(s, old) {
        const p = s.profile, eng = upg(p, 'engine');
        s.client.send('levelUp', { from: old, to: p.level, kart: [kartSpeedFor(old, p.rebirths, eng), kartSpeedFor(p.level, p.rebirths, eng)] });
        this.checkQuest(s);
    }
    addWins(s, n, boosted) {
        if (boosted) {
            n *= rebirthWinsMult(s.profile.rebirths);
            if (eventState(Date.now()).on) n *= CFG.event.wins;
            n = Math.floor(n);
        }
        s.profile.wins += n;
        s.profile.totalWins = (s.profile.totalWins || 0) + n;
        markDirty();
        return n;
    }
    giveReward(s, r) {
        if (r.speed) this.addSpeed(s, r.speed, false);
        if (r.wins) this.addWins(s, r.wins, false);
        if (r.boost) s.profile.boostUntil = Math.max(Date.now(), s.profile.boostUntil || 0) + r.boost * 60000;
        if (r.trail) { s.profile.trails[r.trail] = true; s.profile.trail = r.trail; }
        if (r.tread) s.profile.treads[r.tread] = true;
        if (r.kart) { s.profile.karts[r.kart] = true; s.profile.kart = r.kart; }
    }
    checkQuest(s) {
        const p = s.profile;
        for (let guard = 0; guard < QUESTS.length; guard++) {
            const q = QUESTS[p.quest || 0];
            if (!q || questProgress(q, p) < q.n) return;
            p.quest = (p.quest || 0) + 1;
            this.giveReward(s, q.reward);
            s.client.send('quest', { done: q.text, reward: rewardText(q.reward) });
        }
    }

    // ----- simulation -----
    tick(dt) {
        const now = Date.now();
        for (const [id, s] of this.sessions) {
            const pl = s.player;
            s.gainT += dt / 1000;
            if (s.gainT < CFG.gainInterval) continue;
            s.gainT -= CFG.gainInterval;
            if (s.gainT > CFG.gainInterval) s.gainT = 0;
            if (!s.moving || now - s.lastMove > 700 || pl.anim === 3) continue;
            let mult = 1;
            const tread = treadmillAt(pl.x, pl.y, pl.z);
            if (tread && this.ownsTread(s.profile, tread)) {
                mult = tread.mult; s.treadMult = mult; s.treadSeen = now; s.stats.treadSecs += CFG.gainInterval;
            }
            this.addSpeed(s, mult, true);
            this.syncPublic(id);
        }
    }
    ownsTread(p, def) { return def.cost === 0 && !def.daily ? true : !!p.treads[def.id]; }

    eventTick() {
        const on = eventState(Date.now()).on;
        if (on === this.lastEvent) return;
        this.lastEvent = on;
        this.broadcast('event', { on });
    }

    // "Get Speed While Offline!": time away after leaving on a roller pays out at a reduced rate
    payOffline(s) {
        const p = s && s.profile, off = p && p.offline;
        if (!off) return;
        delete p.offline;
        const secs = Math.min(CFG.offlineHours * 3600, (Date.now() - (off.at || 0)) / 1000);
        if (!(secs > 60)) return markDirty();
        const ticks = secs / CFG.gainInterval;
        const amount = Math.floor(ticks * clamp(off.mult | 0, 1, 200) * CFG.offlineRate * speedMult({ ...p, boostUntil: 0 }, 0, 0));
        if (amount <= 0) return markDirty();
        this.addSpeed(s, amount, false);
        s.client.send('offline', { speed: amount, secs: Math.floor(secs), mult: off.mult | 0 });
    }

    broadcastBoards(target) {
        const top = (key) => topProfiles(key).map((p) => ({ n: p.name, v: Math.floor(p[key] || 0) }));
        const msg = { speed: top('speed'), wins: top('totalWins'), rebirths: top('rebirths') };
        if (target) target.send('boards', msg); else this.broadcast('boards', msg);
    }

    // ----- messages -----
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const pl = s.player, p = s.profile;
        pl.x = clamp(m.x, -LOBBY.halfX - 20, LOBBY.halfX + 20);
        pl.y = clamp(m.y, -200, 400);
        pl.z = clamp(m.z, LOBBY.z0 - 50, SUMMIT.z + SUMMIT.len + 50);
        pl.ry = finite(m.ry) ? m.ry : 0;
        pl.anim = clamp(m.a | 0, 0, 3);
        pl.fx = (m.f | 0) & 255;
        pl.v = finite(m.v) ? clamp(m.v, -200, 800) : 0;
        s.moving = !!m.mv;
        s.lastMove = Date.now();
        const here = stageAt(pl.z);
        if (here > s.stats.maxStage) s.stats.maxStage = here;
        if (pl.z < LOBBY.z1 - 2) s.padArmed = true;
        // A new stage counts once you are in it with the speed it takes to jump into it
        if (here > (p.maxStage ?? -1) && here >= 0 && pl.y > -6) {
            const st = STAGES[here];
            if (maxSpeedOf(p) * BOOST_SLACK >= st.entry) {
                p.maxStage = here;
                client.send('reached', { s: here });
                this.changed(client.sessionId);
            }
        }
    }

    // Wins pad at a stage's end: the player must be on it, and fast enough for the bonus gap
    onPad(client, m) {
        const s = this.sessions.get(client.sessionId);
        const st = STAGES[m.s | 0], pad = st && st.pads[m.k | 0];
        if (!s || !pad) return;
        const pl = s.player, p = s.profile;
        const near = Math.abs(pl.x - pad.x) <= PAD.w / 2 + 4 && Math.abs(pl.z - pad.z) <= PAD.d / 2 + 6 && pl.y > -3 && pl.y < 8;
        if (!near) return;
        if (pad.need && maxSpeedOf(p) * BOOST_SLACK < pad.need) return;
        if (!s.padArmed || !this.cooldown(s, 'pad', 3)) return;
        s.padArmed = false;
        const got = this.addWins(s, pad.wins, true);
        s.stats.pads[m.s | 0] = (s.stats.pads[m.s | 0] || 0) + 1;
        // Reaching a stage's pads means you made its big jump: the next stage is open too
        const open = Math.min(STAGES.length - 1, (m.s | 0) + (maxSpeedOf(p) * BOOST_SLACK >= st.need ? 1 : 0));
        if (open > (p.maxStage ?? -1)) p.maxStage = open;
        // Best time through the stage (the client times it from the stage gate)
        let best = false;
        const tm = Number(m.t);
        if (finite(tm) && tm > 1.5 && tm < 3600) {
            p.best = p.best || {};
            const key = String(m.s | 0);
            if (!p.best[key] || tm < p.best[key]) { p.best[key] = Math.round(tm * 100) / 100; best = true; }
        }
        client.send('wins', { n: got, s: m.s | 0, k: m.k | 0, t: finite(tm) ? tm : 0, best });
        this.changed(client.sessionId);
    }
    // The finish plaza: you escaped the speedway
    onSummit(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const pl = s.player, p = s.profile;
        if (Math.abs(pl.x - SUMMIT.x) > 12 || Math.abs(pl.z - SUMMIT.z) > 12) return;
        if (maxSpeedOf(p) * BOOST_SLACK < STAGES[STAGES.length - 1].need) return;
        if (!s.padArmed || !this.cooldown(s, 'pad', 3)) return;
        s.padArmed = false;
        const first = !p.escaped;
        p.escaped = true;
        const got = this.addWins(s, SUMMIT.wins, true);
        client.send('wins', { n: got, s: STAGES.length, k: 2, escape: true, first });
        this.broadcast('announce', { text: '👑 ' + p.name + ' ESCAPED THE SPEEDWAY!', color: GOLD }, { except: client });
        this.changed(client.sessionId);
    }

    // GO-KARTS: buy (Wins + rebirths) or equip one you own
    onKart(client, m) {
        const s = this.sessions.get(client.sessionId), d = kartById[m.id];
        if (!s || !d) return;
        const p = s.profile;
        const owned = d.id === 'wooden' || !!p.karts[d.id];
        if (owned) {
            if (p.kart !== d.id) { p.kart = d.id; this.toast(s, 'Equipped ' + d.name + '! x' + d.mult + ' Speed', BLUE); }
        } else {
            if (d.pack) return this.toast(s, d.name + ' comes in the OP STARTER PACK!', PINK);
            if ((p.rebirths || 0) < d.reb) return this.toast(s, 'You need ' + d.reb + ' Rebirth' + (d.reb > 1 ? 's' : '') + ' for the ' + d.name + '!', RED);
            if (!this.spend(s, d.cost)) return;
            p.karts[d.id] = true;
            p.kart = d.id;
            this.toast(s, 'Bought the ' + d.name + '! x' + d.mult + ' Speed', GREEN);
            this.fx(s, 'kart');
        }
        this.changed(client.sessionId);
    }
    // GARAGE: Engine, Nitro and Grip, one tier at a time
    onUpgrade(client, m) {
        const s = this.sessions.get(client.sessionId), def = UPGRADES[m.k];
        if (!s || !def) return;
        const p = s.profile;
        p.upg = Object.assign({ engine: 0, nitro: 0, grip: 0, power: 0 }, p.upg || {});
        const n = p.upg[m.k] || 0;
        if (n >= def.max) return this.toast(s, def.name + ' is maxed out!', BLUE);
        if (!this.spend(s, upgradeCost(m.k, n))) return;
        p.upg[m.k] = n + 1;
        this.toast(s, def.ic + ' ' + def.name + ' Lv ' + (n + 1) + '! ' + def.desc(n + 1), GREEN);
        this.fx(s, 'upgrade');
        this.changed(client.sessionId);
    }
    onTread(client, m) {
        const s = this.sessions.get(client.sessionId), d = treadById[m.id];
        if (!s || !d || d.daily || this.ownsTread(s.profile, d)) return;
        if (!this.spend(s, d.cost)) return;
        s.profile.treads[d.id] = true;
        this.toast(s, 'x' + d.mult + ' Speed Roller unlocked!', GREEN);
        this.fx(s);
        this.changed(client.sessionId);
    }
    onTrail(client, m) {
        const s = this.sessions.get(client.sessionId), d = trailById[m.id];
        if (!s || !d) return;
        const p = s.profile;
        const ok = d.daily ? !!p.trails[d.id] : (p.rebirths || 0) >= d.reb;
        if (!ok) return this.toast(s, d.daily ? 'Get it from the Daily Rewards!' : 'You need ' + d.reb + ' Rebirth' + (d.reb > 1 ? 's' : '') + ' for this trail!', RED);
        if (p.trail === d.id) return;
        p.trail = d.id;
        this.toast(s, d.name + ' trail equipped! x' + d.mult + ' Speed', BLUE);
        this.changed(client.sessionId);
    }
    onBoost(client, m) {
        const s = this.sessions.get(client.sessionId), b = BOOSTS[m.id];
        if (!s || !b) return;
        const p = s.profile;
        if (m.id === 'pass2x') {
            if (p.pass2x) return this.toast(s, 'x2 Speed is already yours!', BLUE);
            if (!this.spend(s, b.cost)) return;
            p.pass2x = true;
            this.toast(s, 'x2 Speed unlocked forever!', GOLD);
        } else if (m.id === 'boost') {
            if (!this.spend(s, b.cost)) return;
            p.boostUntil = Math.max(Date.now(), p.boostUntil || 0) + CFG.boostMinutes * 60000;
            this.toast(s, 'x2 Speed Boost for ' + CFG.boostMinutes + ' minutes!', GOLD);
        } else if (m.id === 'starter') {
            const left = CFG.starterPackMinutes * 60000 - (Date.now() - (p.firstPlay || 0));
            if (p.starterPack || left <= 0) return this.toast(s, 'The Starter Pack is gone!', RED);
            if (!this.spend(s, b.cost)) return;
            p.starterPack = true;
            this.giveReward(s, { speed: b.speed, kart: b.kart, boost: CFG.boostMinutes });
            this.toast(s, 'OP STARTER PACK! Rocket Go-Kart + x2 Speed!', GOLD);
        }
        this.fx(s);
        this.changed(client.sessionId);
    }
    onLevel(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        if (p.level >= CFG.maxLevel) return;
        if (!this.spend(s, levelCost(p.level))) return;
        const old = p.level;
        p.level++;
        p.xp = Math.min(p.xp, xpFor(p.level) - 1);
        this.levelMsg(s, old);
        this.changed(client.sessionId);
    }
    onPack(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m.i | 0;
        if (!s || i < 0 || i > 2) return;
        const p = s.profile;
        const amount = packAmount(i, p.level);
        if (!this.spend(s, packCost(i, p.level))) return;
        this.addSpeed(s, amount, false);
        client.send('gain', { n: amount, pack: 1 });
        this.changed(client.sessionId);
    }

    onRebirth(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        const need = rebirthLevel(p.rebirths);
        if (p.level < need) return this.toast(s, 'Reach Level ' + need + ' to Rebirth!', RED);
        p.rebirths++;
        p.level = 1; p.xp = 0; p.customSpeed = 0;
        this.toast(s, 'REBIRTH! x' + (1 + p.rebirths * CFG.rebirthStep) + ' Speed and +' + CFG.kartPerRebirth + ' kart speed!', BLUE);
        this.fx(s, 'rebirth');
        this.changed(client.sessionId);
        this.broadcastBoards();
    }

    onFree(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m.i | 0, r = FREE[i];
        if (!s || !r || s.freeClaimed[i]) return;
        if ((Date.now() - s.joinedAt) / 60000 < r.min) return;
        s.freeClaimed[i] = true;
        this.giveReward(s, r);
        this.toast(s, 'Claimed ' + rewardText(r) + '!', GREEN);
        this.fx(s);
        this.changed(client.sessionId);
    }
    onDaily(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, now = Date.now();
        const st = dailyStatus(p.daily, now);
        if (!st.can) return this.toast(s, 'Come back tomorrow for more!', BLUE);
        const r = DAILY[st.day];
        p.daily = { last: dayKey(now), streak: st.streak + 1 };
        this.giveReward(s, r);
        this.toast(s, 'Day ' + p.daily.streak + '! ' + rewardText(r), GREEN);
        this.fx(s);
        this.changed(client.sessionId);
    }
    // Free Reward chest in the lobby: once every GROUP_CHEST.hours
    onChest(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, left = (p.chestAt || 0) + GROUP_CHEST.hours * 3600000 - Date.now();
        if (left > 0) return this.toast(s, 'Free Reward refills in ' + Math.ceil(left / 3600000) + 'h', BLUE);
        p.chestAt = Date.now();
        this.giveReward(s, GROUP_CHEST);
        this.toast(s, 'Free Reward! ' + rewardText(GROUP_CHEST), GOLD);
        this.fx(s);
        this.changed(client.sessionId);
    }
    onCode(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !this.cooldown(s, 'code', 1)) return;
        const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
        const r = CODES[code];
        if (!r) return client.send('codeResult', { ok: false, text: 'Invalid code!' });
        if (s.profile.codes[code]) return client.send('codeResult', { ok: false, text: 'Already redeemed!' });
        s.profile.codes[code] = true;
        this.giveReward(s, r);
        client.send('codeResult', { ok: true, text: rewardText(r) + '!' });
        this.fx(s);
        this.changed(client.sessionId);
    }
    onCustom(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        const max = maxSpeedOf(p);
        const v = Math.floor(Number(m.v) || 0);
        p.customSpeed = v <= 0 || v >= max ? 0 : clamp(v, CFG.minCustom, max);
        this.changed(client.sessionId);
    }

    // ----- Bloxity -----
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        await adoptGuestProgress(uid, guestProfile.uid, name);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        s.profile = getProfile(uid, name, randomName());
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid, isOnline);
        s.player.name = s.profile.name;
        this.changed(client.sessionId);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (s) s.player.av = cleanAvatar(m.av);
    }
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || typeof m.id !== 'string' || m.id.length > 40) return;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, text });
    }
    // Friend Boost: only names actually present here are counted, and the bonus is capped
    onFriends(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !Array.isArray(m.names)) return;
        const here = new Set([...this.sessions.values()].filter((o) => o !== s).map((o) => o.profile.name));
        const n = new Set(m.names.slice(0, 50).map(String).filter((x) => here.has(x))).size;
        const friends = Math.min(CFG.friendMax, n);
        if (friends === s.friends) return;
        s.friends = friends;
        s.player.friends = friends;
    }
}

function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}
