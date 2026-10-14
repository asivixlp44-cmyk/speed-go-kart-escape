# +1 Speed Go Kart Escape

A multiplayer "+1 Speed" go-kart game for the browser, built with **Three.js** and **Colyseus** for Bloxity. Driving gives +Speed, Speed fills your Level, and every level makes your kart faster. Each stage ends with a ramp jump over a gap that only a fast enough kart clears, and the stages get harder one after another. It clones the Roblox game *[+1 Speed Go Kart Escape](https://www.roblox.com/share?code=e62d318937fb4f41bed20a3bbb78e2af&type=ExperienceDetails)* (see `reference/Gameplay.mp4`).

**There are no in-app purchases.** Karts, Garage upgrades, Speed Rollers and boosts are all bought with **Wins**, which you get from the pads at the end of every stage.

It shares its engine with Backflip Keyboard Escape and Motorcycle Evolution (server, profiles, saves, Bloxity login and avatars, effects). The kart driving, the 17 procedural go-karts and 6 super cars, the speedway, the 16 stages, the police chases, the HUD and the soundtrack are new.

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js client: `main.js` (kart physics, camera, network), `world.js` (lobby, 16 stages, hazards, police cars), `kart.js` (procedural karts, super cars, visible upgrades), `ui.js` (HUD and panels), `audio.js` (music, engine, sounds), `fx.js` (bloom, speed blur, drift sparks, skid marks, particles), `engine.js` (renderer, sky, materials, the driver) |
| `server/` | Colyseus 0.18 server: the `kart` room (`KartRoom.js`), profiles, leaderboards, play stats |
| `shared/` | Game data and formulas used by both sides (`config.js`): stages, karts, upgrades, rollers, prices, levels |

## Run it locally

Needs Node 20 or newer. Double-click `start-local.bat`, or:

```sh
npm --prefix server install && npm --prefix client install
npm run build        # builds the client into client/dist
npm start            # server + game on http://localhost:2597
```

For development run `npm run dev:server` and `npm run dev:client`, then open the Vite URL (the client talks to the server on port 2597; `VITE_SERVER_URL` overrides that). Dev builds expose `window.__qa` for automated test runs.

## Gameplay (from the reference)

- **Driving is +Speed** ("+1 ⚡" pops up beside the kart). Speed is also XP: Level 1 needs 5, then 6, 7, 8, 9, 10, 13, 14, 16, 18, 21, 25, 28, 32, 37 (as in the reference), then x1.14 a level, up to Level 150.
- **Each level makes the kart faster**: "Level Up! (4) / NEW KARTSPEED: 26 -> 28". Top speed is 18 + 2 per level + 5 per rebirth, times the Engine upgrade. **Custom Speed** (box + slider) lets you drive slower than your Max.
- **Ramp jumps gate the stages.** Every gap is sized so a kart at the speed on its sign ("BIG JUMP NEEDS ⚡ 42 SPEED", green when you're fast enough) just clears it. Too slow and you come up short (a kart 4% under the number falls in): "TOO SLOW! This jump needs ⚡ 42 Speed (you: 38). Level up!", and you respawn at the checkpoint before the run-up.
- **16 stages in one long speedway**, each one harder than the last. Every stage has its own colours, an entry gate ("STAGE 3 / COP PATROL / Recommended Level 12", as in the original; the last stage shows its Speed), the reference's pink see-through wall), three hazard sections with checkpoints between them, the run-up and big jump, then the **end zone**: the purple **x2 Wins** pad on the left behind a wider jump, the yellow **Wins** pad on the right, and the middle lane drives on into the next stage. A pad pays out and sends you to the lobby with a **Teleport Back!** button to the next stage.

  | # | Stage | Hazards | Jump needs | Wins |
  |---|---|---|---|---|
  | 1 | Starter Speedway | barrier slaloms, boost pads, practice jumps | 24 | 1 / 2 |
  | 2 | Laser Lane | laser gates (time them), low lasers (HOP them), sliding laser gaps | 32 | 2 / 4 |
  | 3 | Cop Patrol | police officers walking across, parked police cars, lasers | 42 | 4 / 8 |
  | 4 | Police Chase | a police cruiser chases you through roadblocks | 52 | 8 / 16 |
  | 5 | Hammer Highway | pendulum hammers, cops, spinning bars | 64 | 16 / 32 |
  | 6 | Mine Field | rows of blinking mines with one zig-zag gap, hammers | 78 | 32 / 64 |
  | 7 | Tire Tumble | giant tyres rolling at you, spinners | 94 | 64 / 128 |
  | 8 | Crusher Canyon | crushers slamming down, mines | 112 | 128 / 256 |
  | 9 | Closing Walls | red steel walls with a gap that slides side to side, crushers | 132 | 256 / 512 |
  | 10 | Ice Drift | slippery zig-zag ice bridges over the void, closing walls | 154 | 512 / 1K |
  | 11 | Rush Hour | cars crossing out of tunnels, oncoming traffic, ice | 178 | 1K / 2K |
  | 12 | Night Pursuit | two police chases at night (two cruisers), traffic | 204 | 2K / 4K |
  | 13 | Lava Bridges | narrow bridges over lava, meteors, mines | 232 | 4K / 8K |
  | 14 | Glitch Grid | neon tiles that blink out, lava | 262 | 8K / 16K |
  | 15 | Thunder Storm | narrow causeway, wind gusts, lightning strikes, glitch tiles | 294 | 16K / 32K |
  | 16 | Rainbow Finale | lasers, a police chase, crushers and closing walls at full difficulty | 330 | 32K / 64K |

  Then the finish plaza: **ESCAPE! +100K Wins**. Hazards run on the server clock, so everyone sees the same thing. Hazard spacing scales with each stage's speed, so a stage is about as hard at the speed it asks for; the difficulty climbs through shorter windows, more hazards, narrower roads and slippery or vanishing floors. Each rebirth adds +25% Wins. Every stage is timed from its first arch to its pad, and your best times are saved (Stats panel).
- **Police chases** (stages 4, 12 and 16): drive into a chase zone and a cruiser with flashing red and blue lights comes after you, siren wailing, following the exact path you drove. Roadblocks of police cars cross the road with the gap marked in green and boost pads behind every other one. A chip shows how far back the police are ("🚓 18m - FASTER!") and the camera lifts as they close in. Drive clean at the stage's speed and you get away by about 10-15 m at the blue line; come in about 10% too slow or crash into a roadblock and you're **BUSTED!**, back to the checkpoint. Boosts and nitro buy you room.
- **Clear obstacles**: every hazard section has a board over the checkpoint arch before it saying what it is and what to do ("⚡ LASERS - Wait for red gates to switch OFF - HOP low lasers"), and the same card pops up on the HUD as you drive under it. Deadly things are red or striped on the floor (zebra crossings for the cops, red bands under hammers and laser gates, yellow-black zones under crushers and traffic lanes, red rings round the spinners); barriers you only bump into are blue and white. Before the Wins pads the lanes are painted: yellow = Wins, purple = x2 Wins, green = next stage.
- **Driving** (quick and easy): the Speed number climbs fast but the kart itself speeds up gently (about 18 studs per second at 20 Speed, 32 at 64, 70 at 330), so every stage stays drivable; the kart rolls off the line and pulls smoothly up to top speed in about 0.7 s (worked out in real speed, so there is no lurch), and the turn rate eases in and out so a tapped key never twitches the kart; steering is sharp at low speed and calmer near top speed, so it feels the same at every level. **Track assist**: on the stages, let go of the steering and the kart lines itself up with the track. Side walls slide you along instead of stopping you. **Hop** (Space), **drift** (hold hop while steering) with mini-turbos that charge blue → orange → purple, **nitro** (Shift) from a tank that refills, boost pads, ice that barely grips, a chase camera that swings behind the kart and widens its view with speed.
- **Speed Orbs** ⚡: glowing orbs along the racing line - through every gap in the barriers, roadblocks and mine rows, down the run-up, in the air along the big jump's flight path, on the landing and down the lobby road. Drive through one for +2 Speed (times your multipliers); a quick string of them chimes higher and higher ("ORB STREAK x10!"). They come back after 20 s. The server adds the Speed (rate-limited, each orb once per respawn).
- **Air tricks** 🔥: off any ramp, tap HOP in the air for a barrel roll, a front flip or a flat spin (up to three per jump). Land it and you get a turbo ("TRICK!", "DOUBLE TRICK!"); land in the middle of one and you just wobble. Other players see your tricks.
- **Racing feel**: Teleport (or Teleport Back!) to a stage and you line up under start lights: **3, 2, 1, GO!** Hold the gas from just before GO for a **PERFECT START** boost. Your best run on each stage is saved as a **ghost** (a see-through kart) to race against, with **−0.42s / +0.31s** splits at every checkpoint, and a **progress bar** shows the stage, its checkpoints, the jump, the finish, you and your ghost. Red-and-white curbs, a dashed centre line, trackside boards and distance boards (150 / 100 / 50) before the big jump.
- **Lobby** (grey studded arena, navy walls with orange stripes, as in the reference):
  - **GO-KARTS** showroom (west): 16 karts on red pads, from the Wooden Go-Kart (x1) to the Galaxy Go-Kart (x100). Each multiplies the Speed you earn; the later ones also need rebirths (DIY x2.5 for 10 Wins, Good x4, Fast x5.5 + 1 Rebirth … Galaxy x100 for 1M Wins + 15 Rebirths). Drive onto a pad to buy or equip. The Rocket Go-Kart (x3.5) comes with the OP Starter Pack.
  - **SUPER CARS** showroom (behind the spawn, or Teleport → ⭐ Super Cars): six modern cars on glossy turntables under spotlights. Electro GT (x6, 300 Wins + 1 Rebirth), Cyber Wedge (x18, 20K + 5), Formula X (x35, 80K + 7), Hyper Phantom (x60, 300K + 10), Hover Racer (x110, 1.2M + 14, floats on four hover pods) and Quantum Prism (x200, 5M + 18, iridescent paint with rainbow light lines).
  - **GARAGE** (north-east): three bays, drive in to upgrade (or tap the orange **🔧 UPGRADE** button, which pulses when you can afford one). **Engine** +5% top speed per level (12 levels), **Nitro** bigger and stronger tank (10), **Grip** sharper steering and faster drift charge (10), **Power** +10% Speed earned per level (15). Upgrades show on your car and other players see them: nitro bottles, a chrome blower and glowing intake, exhaust pipes, wider tyres with neon rims, neon side stripes.
  - **SPEED ROLLERS** (east): dyno rollers x3 (free), x6, x12, x25, x50, x100, x200 and the Aqua x40 (Daily Day 7). Drive on and hold the throttle; they keep paying while you're offline (a quarter rate, up to 8 h). The **Rollers** button trains automatically.
  - **TRAILS** by the rollers, unlocked by rebirths (x1.5 to x8), the Moon Trail from Daily Day 3.
  - Free Reward and Codes chests, Top Speed / Top Wins / Top Rebirths boards, the Turbo Rush countdown board and the Next Update sign.
- **HUD** (as in the reference): the Level bar and "Speed: N" at the top, Wins and the Go-Karts / Rebirth / Garage / Shop / Teleport / Rollers tiles on the left, Starter PACK, Custom Speed, **2x SPEED** and **FREE** on the right, **+1 Level** and three Speed packs at the bottom, a speedometer with the nitro tank and drift charge, the stage stopwatch, the quest line ("Tutorial: Get 10 Wins!").
- **Prices in Wins**: x2 Speed forever (50), x2 Speed Boost 15 min (10), OP Starter Pack (10, first 15 minutes), +1 Level and the Speed packs (priced by your level).
- **Rebirth** from Level 20 (+6 per rebirth, up to 90): back to Level 1 for +50% Speed, +25% Wins and +5 kart top speed for good, and new karts and trails unlock.
- **Turbo Rush** event: every 30 minutes, 5 minutes of x2 Speed and x2 Wins for everyone.
- Daily Rewards (7 days, shown once you're back in the lobby), FREE playtime rewards, quests, codes (`GOKART`, `SPEED`, `NITRO`, `DRIFT`, `LEGION`, `RELEASE`), Friend Boost.
- **Soundtrack**: "Turbo Bricks", an original code-generated 140 BPM racing electro-pop track (galloping bass, supersaw drops, a bright lead hook over Am - F - C - G). A kart engine shifts through five gears with your speed; drifts screech and nitro roars. No audio files.

## Graphics

- Super cars with modern spoked wheels and brake callipers, LED light bars, underglow, a formula car with wings and a halo, a steel wedge, a hover car with pulsing pods and a glass dome, and an iridescent hypercar.
- Procedural go-karts in 17 styles: plank crates for the starter kart, fibreglass pods, F1 noses with front and rear wings, the excavator's bucket arm, the police light bar, the energy core in a glass dome, the rocket booster, gold and galaxy paint. Clear-coated paint, spinning wheels, front wheels and steering wheel that turn, body roll and squat, underglow on the neon karts. Each kart draws in a few dozen calls (static parts merged).
- Drift sparks in the mini-turbo colour, tyre smoke, skid marks that fade, nitro and fire flames from the exhausts, trails, speed lines and a radial speed blur, bloom and a colour grade, a sky with drifting clouds that turns to a starry night on the dark stages.
- Performance: only the stages next to you are drawn and collided with; static scenery is merged per material in 300-stud chunks with a 720-stud render distance (far chunks fade into the haze and are not drawn), plain studded boxes share one vertex-coloured material, far players and display cars are hidden, and shaders are compiled at load. **Rendering**: drawn straight to the screen with MSAA at the screen's own resolution (no bloom or grading passes), sharp and clean like the original. Presets: High (up to 2x resolution, 2048 shadows), Medium (up to 1.5x, 1024 shadows), Low (1x, no shadows). **Adaptive quality**: it starts at Medium on desktop (Low on phones), steps up after a steady 60 FPS and down under ~45 FPS (only at Low does it lower the resolution, to 75% at most), never above the preset chosen in the settings; the preset it settles on is where the next visit starts. **Fast start**: only the lobby and Stage 1 are built before joining; the display cars and the other stages are built a piece at a time while the game connects (about 40% quicker to the first frame).
- The game starts straight behind your kart (no camera fly-in).

## Controls

| Action | Keyboard / mouse | Controller | Touch |
|---|---|---|---|
| Gas / brake & reverse | W / S (arrows) | RT / LT | Push the stick (pull down to brake) |
| Steer | A / D | Left stick | Stick left / right |
| Hop (tap in the air off a ramp for a trick), hold to drift | Space | A | HOP/DRIFT |
| Nitro | Shift | X or B | NITRO |
| Back to checkpoint | R | | |
| Camera | Drag, wheel to zoom (C re-centres) | Right stick, D-pad zoom | Drag |
| Shop / Garage / Teleport / Karts / Settings | Buttons | Y / LB / RB / View / Menu | Buttons |

## Multiplayer and saves

- One shared `kart` room (up to 24 players). Driving and hazards are client-side; Speed, Wins, levels, purchases, upgrades, pads (position and speed checks), rebirths and best times are decided by the server.
- Progress is saved per browser or per Bloxity account: MongoDB on Legion (`MONGODB_URI`), `server/data/profiles.json` locally, plus a signed backup in the browser.
- Play stats: `GET /api/stats?key=<stats key>&days=7` (the key is in `server/STATS_KEY.local.txt`, not in the repo; locally the stats are open).

## Deploy (Bloxity hosting)

Pushing `main` (prod) or `dev` runs `.github/workflows/deploy.yml`: server image `ghcr.io/asivixlp44-cmyk/speed-go-kart-escape-server`, Legion rollout, client upload. Play at https://speed-go-kart-escape.play.bloxity.io.

One-time setup: create the app `speed-go-kart-escape` on hosting.bloxity.io, create the game with the same slug in bloxity.io Manage Games (no IAPs needed), and add the repo secret `LEGION_DEPLOY_TOKEN`. `bloxity-setup.html` has every form field with copy buttons.
