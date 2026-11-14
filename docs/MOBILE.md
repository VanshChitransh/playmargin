# MARGIN on phones

MARGIN is laptop only for now: mouse to steer, hold Space to BOOST, hold R to REPAY. A phone or tablet
can read every page (home, How it works, Verify, Judges) under a slim "MARGIN plays on a laptop"
banner with the link to copy. Only the game itself (practice, the $1 match, Judge Run, a room link)
and Watch show the "plays on a laptop" card instead, because they run the renderer that failed on a
real phone. This page records what we had, what broke and how to bring phones back.

## Why phones are parked

- On a real phone the game opened to a black screen, and the UI did not fit.
- One input model (mouse and keyboard) keeps the game fair between players and the code small.
- Headless browsers could not test touch for real. Synthetic pointers fail `setPointerCapture`, so the
  touch BOOST and REPAY holds were never verified on a device.

## What we had

These were removed or switched off in the laptop-only change.

- Touch controls (`apps/client/src/input/controls.ts`): a nipplejs joystick on the left half of the
  screen, and BOOST, REPAY and CASH OUT as round buttons with pointer capture, so a sliding finger still
  counted until lifted.
- A phone layout: a smaller controls dock, safe-area padding, a HUD showing the top 3 plus you, and
  landscape rules under 500 px height. The short-window rules stay, because a small laptop window uses them.
- Detection: `(pointer: coarse)` or `maxTouchPoints > 0`. That also caught touch-screen laptops, so the
  new rule (`apps/client/src/device.ts`) is "pointer coarse and no fine pointer".
- A PWA (vite-plugin-pwa) that precached about 2 MB. It is removed. `apps/client/public/sw.js` is a kill
  switch that clears caches and unregisters old installs, and can be deleted once old installs are gone.

## What agar.io does

- It sends phones to its app by user agent: Android to Google Play, iPhone and iPad to the App Store.
- A desktop window is never blocked. The canvas resizes and the menu scales down as one block.
- The gap: an iPad in Safari's desktop mode reports "Macintosh", gets the desktop page and cannot play.
  So MARGIN decides by input hardware, never by user agent alone.

## How to bring phones back

1. Find the black screen first: test WebGL and WebGPU init on real devices, add a canvas fallback in
   Pixi when WebGL fails, and show an on-screen error instead of black.
2. Design for thumbs from scratch: one-handed steering and a hold-to-borrow button, tested on iPhone
   Safari, Android Chrome, an iPad and a small Android phone.
3. Ship a native wrapper or a phone-first web build, then do what agar.io does: the web page on a phone
   points to the app.
4. Use the old touch code in git history (`input/controls.ts` before the laptop-only commit) as a
   starting point, not as the design.
