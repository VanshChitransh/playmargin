// Films one "How it works" clip from real offline practice (core rules, labelled bots), frame
// by frame: Playwright's fake clock steps the game 1/30 s at a time, so the footage is exact and
// the fixed clock fixes the match seed (offline practice seeds from Date.now). Nothing is staged:
// the script only presses keys and steers like a player would, and logs what the game drew.
//   node capture.cjs <nitro|repay|liquidated> <clockMs> [--dry] [--out dir] [--url base]
// --dry skips screenshots (fast seed search). Output: <out>/raw.mp4 + track.json.
// Needs the client on --url and the motion-ad skill's deps, with no new repo dependency:
//   export NODE_PATH=~/.claude/skills/motion-ad/scripts/node_modules
//   node capture.cjs nitro 1794304800000 && node build.cjs nitro
// Input timing in the browser is not bit-exact, so a run can miss its moment: retry with
// another clock (the clips on main used 1794304800000, +7000 and +13000).
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { chromium } = require('playwright-core')

const [CLIP, CLOCK] = process.argv.slice(2)
const flag = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const DRY = process.argv.includes('--dry')
const OUT = flag('out', path.join(__dirname, 'out', CLIP))
const BASE = flag('url', 'http://localhost:1240')
const FPS = 30
const SIZE = 640
const MAX_FRAMES = FPS * 60

// One frame of what the game drew: my blob, everyone near me, all on screen coordinates.
const SAMPLE = () => {
  const f = window.__frame, a = window.__arena
  if (!f) return null
  const view = (b) => { const s = a.screenOf(b.id); return { id: b.id, label: b.label, kind: b.kind, x: b.x, y: b.y, sx: s && s.x, sy: s && s.y, sr: s && s.r, r: b.radius, ring: b.ring, state: b.state, owe: b.owe, equity: b.equity, fuel: b.fuel } }
  const me = f.blobs.find((b) => b.id === f.me)
  const stamp = document.querySelector('.stamp')?.textContent ?? ''
  // The death card's "popped by X" line names the hunter (the footer also uses .tag, so match the text).
  const by = (document.body.innerText.match(/popped by\s+([^\n]+)/i) || [])[1]?.trim() ?? ''
  return { phase: f.match.phase, left: f.match.timeLeftS, me: me && view(me), others: f.blobs.filter((b) => b.id !== f.me && b.state === 'alive').map(view), spikes: f.spikes.map((s) => ({ x: s.x, y: s.y })), stamp, by }
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 2 })
  // Installed clocks keep running in real time: pause at once, so time only moves in runFor.
  await page.clock.install({ time: Number(CLOCK) })
  await page.clock.pauseAt(Number(CLOCK) + 1000)
  await page.goto(`${BASE}/`)
  await page.evaluate(() => { localStorage.setItem('margin.coached', '1'); localStorage.setItem('margin.muted', '1') })
  await page.goto(`${BASE}/play?local&view=700`)
  // Display only: hide the HUD chrome a 326 px card cannot read (leaderboard, clock, pills, hint
  // labels). Gameplay, the blobs, the floats and the red margin-call frame are untouched.
  await page.addStyleTag({ content: '.hud-timer,.hud-lb,[data-h=mute],[data-h=banner],[data-h=tap],[data-h=call],[data-h=center],.tag.fixed{display:none!important}' })

  const ff = DRY ? null : spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', path.join(OUT, 'raw.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] })

  const keys = new Set()
  const hold = async (code, on) => { if (on === keys.has(code)) return; on ? keys.add(code) : keys.delete(code); await (on ? page.keyboard.down(code) : page.keyboard.up(code)) }
  const c = SIZE / 2
  // Steer: the camera keeps me centred, so pointing from the centre toward a world spot steers there.
  const steer = async (me, x, y) => { const n = Math.hypot(x - me.x, y - me.y) || 1; await page.mouse.move(c + ((x - me.x) / n) * 220, c + ((y - me.y) / n) * 220) }
  const nearest = (me, list) => list.reduce((a, s) => (!a || Math.hypot(s.x - me.x, s.y - me.y) < Math.hypot(a.x - me.x, a.y - me.y) ? s : a), null)

  const track = []
  const marks = {}
  let liveAt = -1
  let recording = false
  let doneAt = -1
  let outcome = 'timeout'

  for (let i = 0; i < MAX_FRAMES * 2; i++) {
    await page.clock.runFor(1000 / FPS)
    const s = await page.evaluate(SAMPLE)
    if (!s || !s.me) continue
    if (s.phase === 'LIVE' && liveAt < 0) liveAt = i
    if (liveAt < 0) continue
    const t = (i - liveAt) / FPS // seconds since GO
    const me = s.me
    const alive = me.state === 'alive'
    const mark = (k) => { if (!(k in marks)) marks[k] = track.length }

    if (alive) {
      if (CLIP === 'nitro') {
        await steer(me, 2400, 2400) // toward the middle, away from walls
        // BOOST is blocked during the 5 s spawn shield, so the hold starts after it.
        await hold('Space', t >= 6 && t < 8.6)
        if (t >= 6) mark('boostDown')
        if (t >= 8.6) mark('boostUp')
        if (t >= 13) { doneAt = track.length; outcome = 'ok' }
      } else {
        // Borrow to the cap, then fly into spikes until red: the real way players go red.
        const red = me.ring === 'red'
        if (red) mark('red')
        await hold('Space', t >= 5.5 && t < 8.5 && !('red' in marks))
        if (CLIP === 'repay') {
          if (!('red' in marks)) { const sp = t >= 8.5 && nearest(me, s.spikes); await (sp ? steer(me, sp.x, sp.y) : steer(me, 2400, 2400)) }
          else {
            await steer(me, 2400, 2400)
            const sinceRed = (track.length - marks.red) / FPS
            const paying = sinceRed >= 0.3 && !('paid' in marks)
            await hold('KeyR', paying)
            if (paying) mark('repayDown')
            if (me.owe < 0.5 && 'repayDown' in marks) { mark('paid'); await hold('KeyR', false) }
            if ('paid' in marks && (track.length - marks.paid) / FPS > 2.5) { doneAt = track.length; outcome = 'ok' }
          }
        } else if (!('red' in marks)) { if (t < 8.5) await steer(me, 2400, 2400); else { const sp = nearest(me, s.spikes); if (sp) await steer(me, sp.x, sp.y) } }
        else {
          // Red and not repaying: drift toward the nearest bigger blob, like a panicking player.
          const big = nearest(me, s.others.filter((o) => o.r > me.r && o.ring !== 'red'))
          if (big) await steer(me, big.x, big.y)
        }
      }
    } else if (CLIP === 'liquidated' && 'red' in marks) {
      mark('pop')
      if (/LIQUIDATED/.test(s.stamp)) mark('card')
      if (/EATEN/.test(s.stamp)) { outcome = 'eaten'; doneAt = track.length }
      if ('card' in marks && (track.length - marks.card) / FPS > 2.5) { doneAt = track.length; outcome = 'ok' }
    } else { outcome = 'died'; doneAt = track.length }

    if (!recording && t >= 0) recording = true
    if (recording) {
      track.push({ i: track.length, t: +t.toFixed(3), ...s })
      if (ff) { const buf = await page.screenshot({ type: 'png' }); if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r)) }
    }
    if (doneAt >= 0 || t > 40) break
  }
  if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)) }
  await browser.close()
  fs.writeFileSync(path.join(OUT, 'track.json'), JSON.stringify({ clip: CLIP, clock: Number(CLOCK), fps: FPS, size: SIZE, outcome, marks, frames: track }))
  console.log(JSON.stringify({ clip: CLIP, clock: Number(CLOCK), outcome, marks, frames: track.length }))
})()
