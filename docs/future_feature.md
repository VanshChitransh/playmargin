# Future feature: MARGIN on phones (the mobile app)

MARGIN is laptop only for now: mouse to steer, hold Space to BOOST, hold R to REPAY. A phone or tablet
sees only a "MARGIN plays on a laptop" page with the link to copy, on every route (13 Nov 2026).
This page records what we had, what broke and how to bring phones back.

## Why it is parked (10 Nov 2026)
- On a real phone (the founder's) the game opened to a **black screen**, and the UI did not fit.
- The hackathon judges play on laptops, so a phone build was risk with no reward before the deadline.
- One input model (mouse + keyboard) keeps the game fair between players and the code small.
- Headless browsers could not test touch for real: synthetic pointers fail `setPointerCapture`, so the
  touch BOOST and REPAY hold were never verified on a device.

## What we had (removed or switched off in the laptop-only change)
- **Touch controls** (`apps/client/src/input/controls.ts`): a nipplejs joystick on the left half of the
  screen (dynamic mode, 110 px, "Drag to steer" hint), and BOOST / REPAY / CASH OUT as round buttons with
  pointer capture so a sliding finger still counted until lifted.
- **Phone layout**: a smaller controls dock, safe-area padding, the HUD showing the top 3 plus me, an
  "offline practice" tag at the top, a short Judge Run line, and landscape rules under 500 px height
  (the short-window rules stay, a small laptop window uses them).
- **Detection**: `(pointer: coarse)` or `maxTouchPoints > 0`. That also caught touch-screen laptops and
  gave them touch wording; the new rule (`apps/client/src/device.ts`) is "pointer coarse and no fine pointer".
- **PWA** (vite-plugin-pwa, autoUpdate, fullscreen manifest): it precached 2.2 MB (1.3 MB after we
  dropped the email login chunk). Removed. `apps/client/public/sw.js` is a kill switch that clears caches and
  unregisters old installs; **delete it after 1 Dec 2026**.

## What we learned from agar.io (researched 10 Nov, `research/margin/ui/agar-responsive/`)
- agar sends phones to its app by user agent: Android goes to Google Play, iPhone and iPad go to the App Store.
- A desktop window is never blocked: the canvas resizes and the menu scales down as one block.
- The hole: an iPad in Safari's desktop mode reports "Macintosh", gets the desktop page and cannot play.
  Decide by input hardware, never by user agent alone.

## QA findings that only matter on phones (research/margin/qa/QA-LOG.md)
QA-B-13 (Commander note under the board), QA-B-15 (landscape board over the dock), QA-B-21 (offline label
over REPAY), and the open real-phone touch check.

## How to bring it back
1. **Find the black screen first**: test WebGL and WebGPU init on real devices, with a canvas fallback in
   Pixi when WebGL fails, and an on-screen error instead of black.
2. **Design for thumbs from scratch**: steering and a hold-to-borrow button that work one-handed, tested on
   a device matrix (iPhone Safari, Android Chrome, iPad, a small Android).
3. **Native wrapper or a phone-first web build**; then follow agar: the web page on a phone points to the app.
4. Bring back the touch code from git history (`input/controls.ts` before the laptop-only commit) as a
   starting point, not as the design.
