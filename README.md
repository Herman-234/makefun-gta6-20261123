# VICE SHORES — Sun, Sand &amp; Stolen Cars

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Herman-234/makefun-gta6-20261123/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Herman-234/makefun-gta6-20261123/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An original open-world crime game for the [make.fun gta6-01 bounty](https://make.fun/bounty/gta6-01)
— a sun-soaked coastal city you explore **on foot and by car**, with traffic, pedestrians, cars to steal, a wanted
level with police chases, six story missions, combat, a HUD with a live minimap, a start
screen and a save that persists between visits. Everything is original: the city, the
characters, the names, the story, the art and the sound. Nothing from Rockstar Games.

## Play it

No build step, no network. Serve the `game/` folder with any static server and open it
in a desktop browser:

```sh
node serve.ts
# open http://localhost:8080
```

Or serve `game/` with Python, `npx serve`, or any static host.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Walk / drive |
| Mouse drag | Look around (orbit camera) |
| E | Enter or steal a car · pick up a package |
| F | Punch |
| Space | Jump |
| H | Horn |
| Shift | Run |
| M | Mute |
| P / Esc | Pause |
| R | Restart the current mission |

## The game

You are **Jax**, new in Vice Shores with empty pockets and a phone full of Rico's
"easy jobs":

1. **Meet Rico at the Pier** — get to the south beach.
2. **Borrow a Ride** — take any parked car (the owner will not mind. Probably.)
3. **Pick Up the Package** — fetch it from the north docks.
4. **Lose the Heat** — stay clean until your wanted level drops to zero.
5. **Beach Sprint** — reach the beach marker in 75 seconds.
6. **The Big Delivery** — deliver the package north in 90 seconds for $500.

Between missions the city is yours: grab cash bags ($25), health kits, dodge the
Vice Shores PD. Stealing a car, hitting a pedestrian or punching someone raises your
wanted level (★–★★★); police cars spawn and chase you. Get busted and you lose 15%
of your cash at the hospital; get wrecked and you lose 10%. Lay low for 18 seconds
without a new crime and the heat drops a star.

## What is inside

- `game/index.html` — the page, HUD and minimap.
- `game/src/main.js` — boot, fixed-step loop, screens, save/continue, screenshot staging.
- `game/src/world.js` — the simulation: procedural city, traffic AI, pedestrians,
  police AI, wanted system, missions, pickups, combat, save.
- `game/src/render.js` — three.js scene, camera, HUD and minimap painting.
- `game/src/core.js` — tuning, seeded random, input, synthesized WebAudio sound.
- `game/vendor/three.module.min.js` — three.js r160, vendored (MIT).
- `screenshots/` — three real renders of the game (`?shot=start|play|end&seed=1`).
- `main.ts` — the entry program: copies `game/` and `screenshots/` to `/output` and
  writes `dossier.json` with the kit's `vendor/makefun-game.ts`.

Sound is synthesized live with WebAudio (engine hum, sirens, pickups, mission
jingles, a bass loop) — no audio files. Your cash, mission progress and best score
save to `localStorage`.

## Screenshots

The three images in `screenshots/` are real renders of this build, staged with
the `?shot=` query the game itself understands (same seed, `seed=1`):

| File | Scene |
| --- | --- |
| `1-start.jpg` | `?shot=start` — the title screen over the living city |
| `2-play.jpg` | `?shot=play` — Jax driving through town after 22 seconds |
| `3-end.jpg` | `?shot=end` — the first mission paid out, overlay shown |

Each shot simulates the world forward, paints 40 frames, then flags
`window.__shotReady`, so a headless browser can capture the settled scene.

## Development

- `node serve.ts` serves `game/` on http://localhost:8080 for local play.
- `main.ts` is the entry program the grader runs: it copies `game/` and
  `screenshots/` into `/output` and writes `/output/dossier.json` with the
  kit's vendored `vendor/makefun-game.ts`. Run it locally with
  `MAKEFUN_OUTPUT_DIR=out node main.ts` to inspect what the grader sees.
- The city is seeded: `?seed=1` always builds the same streets, cars and
  pedestrians, which is what makes the screenshots reproducible.

## License

MIT — see [LICENSE](LICENSE).
