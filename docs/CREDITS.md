# Credits

## colyseus-pixijs-boilerplate

Server room, entity schema and Pixi client in `apps/server` and `apps/client` started from https://github.com/endel/colyseus-pixijs-boilerplate @ 8c20748.

```
Copyright (c) 2019-2023 Endel Dreyer

MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## MultiOgar BotPlayer (free-room agent steering)

`apps/server/src/agents/freebot.ts` ports the potential-field `decide()` from
https://github.com/agarian-2/MultiOgar `src/ai/BotPlayer.js` (L33-92), rewritten in TypeScript
for MARGIN's rules (who can eat or pop whom, spikes, zone, BOOST and REPAY habits).

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software distributed under the
License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
either express or implied. See the License for the specific language governing permissions
and limitations under the License.
```
Changes: TypeScript port, MARGIN eat ratio (1.15 by mass), red/shield/drone rules, spike and
zone terms, reaction delay, money habits. Split logic replaced by BOOST.

## Ported formulas and ideas (MIT)

| What | Source | Licence | Where |
|---|---|---|---|
| Blob radius from mass (`4 + sqrt(m) * 6`) | [owenashurst/agar.io-clone](https://github.com/owenashurst/agar.io-clone) `util.massToRadius` | MIT, Copyright (c) 2014 Owen Ashurst and contributors | `packages/core/src/motion.ts` |
| Snapshot interpolation buffer | [vzhou842/example-.io-game](https://github.com/vzhou842/example-.io-game) `src/client/state.js` | MIT, Copyright (c) 2019 Victor Zhou | `apps/client/src/net/interp.ts` |
| Drone avoidance idea (rewritten, no code copied) | [Apostolique/Agar.io-bot](https://github.com/Apostolique/Agar.io-bot) | MIT | `apps/server/src/agents/drone.ts` |
| Never block the tick on an LLM call, keep the last plan (pattern only) | [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) | MIT | `apps/server/src/agents/commander.ts` |

The MIT licence text above (colyseus-pixijs-boilerplate) applies to each MIT source, with its own
copyright line.

## References used without copying code

- NEP-366 relayer flow: the meta-transaction server pattern in
  [near-examples/near-api-examples](https://github.com/near-examples/near-api-examples) (the
  repository states no licence, so `services/relayer` was written from scratch on near-kit).
- Steering: Fray, "Context Steering", Game AI Pro 2, chapter 18.
- NEAR docs and the official NEAR agent skills (security checklist, NEP-141 / NEP-366 / NEP-413).

## Fonts (loaded from Google Fonts, not bundled)

Lilita One, Rubik and JetBrains Mono, all under the SIL Open Font License 1.1.

## Audio

No audio files ship in this repository.

## Runtime dependencies

Installed from npm and crates.io, not vendored. Licences as declared by each package:

| Package | Version | Licence |
|---|---|---|
| near-sdk, near-contract-standards (Rust) | 5.30.1 | MIT OR Apache-2.0 |
| near-kit | 0.20.2 | MIT |
| near-api-js (email login only) | 5.1.1 | MIT AND Apache-2.0 |
| @fast-auth-near/browser-sdk, @fast-auth-near/javascript-provider | 1.4.2, 1.4.1 | ISC |
| @auth0/auth0-spa-js (via fast-auth) | 2.30.0 | MIT |
| @hot-labs/near-connect | 0.12.0 | MIT |
| colyseus, @colyseus/sdk, @colyseus/tools | 0.17 | MIT |
| pixi.js | 8.22.0 | MIT |
| express, express-basic-auth | 5.3.0, 1.2.1 | MIT |
| tailwindcss, @tailwindcss/vite, daisyui | 4.3.5, 4.3.5, 5.7.50 | MIT |
| uqr, buffer | 0.1.2, 6.0.3 | MIT |

MARGIN itself is MIT (see `LICENSE`). Brand art (logo, mascot, banner) in `apps/client/public/brand`
is our own.
