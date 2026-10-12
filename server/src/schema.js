import { schema, t } from '@colyseus/schema';

// Public, synced to every client. Private progress (owned karts, upgrades, rollers, codes...)
// is sent only to its owner with the "profile" message.
export const PlayerState = schema({
    name: t.string().default(''),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ry: t.angle(),
    anim: t.uint8().default(0), // 0 idle, 1 driving, 2 air, 3 crashed
    fx: t.uint8().default(0),   // bits: 1 drift left, 2 drift right, 4 nitro, 8 boost, 16 braking
    v: t.float32().default(0),  // forward speed, for wheels and engine sounds of other karts
    speed: t.number().default(0),
    wins: t.number().default(0),
    level: t.uint16().default(1),
    xp: t.number().default(0),
    rebirths: t.uint16().default(0),
    kart: t.string().default('wooden'),
    upg: t.string().default(''),  // visible upgrades ("e3n2g1p0")
    trail: t.string().default(''),
    friends: t.uint8().default(0),
    kit: t.uint8().default(0),
    skin: t.uint8().default(0),
    av: t.string().default(''),
}, 'PlayerState');

export const GameState = schema({
    players: t.map(PlayerState),
}, 'GameState');
