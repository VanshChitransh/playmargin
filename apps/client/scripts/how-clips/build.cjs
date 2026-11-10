// Builds one "How it works" clip from a capture: picks the shots around the logged moments
// (BOOST held, gone red, REPAY held, paid off, popped), fills compose.html with the track and the
// shot list, renders it frame by frame (motion-ad render.cjs) and encodes a small looping mp4.
//   node build.cjs <nitro|repay|liquidated> [--stills 1,2,3]   (reads out/<clip>/, writes public/clips/<clip>.mp4)
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const CLIP = process.argv[2]
const STILLS = (() => { const i = process.argv.indexOf('--stills'); return i > -1 ? process.argv[i + 1] : null })()
const SKILL = process.env.MOTION_AD || path.join(process.env.HOME, '.claude/skills/motion-ad/scripts')
const DIR = path.join(__dirname, 'out', CLIP)
const data = JSON.parse(fs.readFileSync(path.join(DIR, 'track.json'), 'utf8'))
if (data.outcome !== 'ok') throw new Error(`${CLIP}: capture outcome ${data.outcome}, re-capture first`)
const M = data.marks
const F = data.fps
const last = data.frames.length - 1
const at = (i) => Math.max(0, Math.min(last, i))
// A shot plays footage [from, to] in dur seconds (rate shown on screen when not 1x), or holds a frame.
const play = (from, to, rate, o = {}) => ({ from: at(from), to: at(to), dur: (at(to) - at(from)) / F / rate, rate, ...o })
const hold = (i, dur, o = {}) => ({ hold: at(i), dur, ...o })

// Captions that quote numbers read them from the frame being shown, never typed in.
const owe = (i) => Math.round(data.frames[at(i)].me.owe)

function shots() {
  if (CLIP === 'nitro') {
    const B = M.boostDown, U = M.boostUp
    return [
      // Zoom stays put while BOOST is held, so the growth reads on screen.
      play(B - 30, B, 1, { z: 1.4, zDur: 0.01, arrow: 'me', cap: 'This is you', fadeIn: true }),
      play(B, U, 1, { key: 'HOLD BOOST', keyDown: true, owe: true, cap: 'BOOST = borrow' }),
      hold(U, 1.1, { owe: true, arrow: 'me', cap: `Bigger. And you owe ${owe(U)}` }),
      play(U, U + 60, 1, { owe: true, cap: 'Every boost is a loan' }),
      play(U + 60, U + 72, 1, { owe: true, fadeOut: true }),
    ]
  }
  if (CLIP === 'repay') {
    const R = M.red, D = M.repayDown, P = M.paid
    // The spike that turned me red: the one closest to me on the red frame.
    const fr = data.frames[R].me
    const sp = data.frames[R].spikes.reduce((a, s) => (!a || Math.hypot(s.x - fr.x, s.y - fr.y) < Math.hypot(a.x - fr.x, a.y - fr.y) ? s : a), null)
    return [
      play(R - 40, R - 10, 1, { z: 1.4, zDur: 0.01, owe: true, arrow: 'spike', spikeAt: sp, cap: `Owe ${owe(R - 40)}. Spike ahead`, fadeIn: true }),
      play(R - 10, R + 4, 0.3, { z: 1.6, owe: true, cap: 'Hit!' }),
      hold(R + 4, 1.4, { owe: true, arrow: 'me', cap: 'Red: you cannot eat, and anyone can pop you' }),
      play(R + 4, D, 1, { owe: true, key: 'HOLD R' }),
      // No owe chip here: the game's own "owe N" floats count down on the blob while REPAY is held.
      play(D, P + 6, 0.4, { z: 1.3, key: 'HOLD R', keyDown: true, cap: 'REPAY pays the loan with your size' }),
      // A bigger bot drifts over the now small blob from about P + 40: end before that.
      play(P + 6, P + 24, 1, { cap: 'Back to green' }),
      hold(P + 24, 1.0, { cap: 'Back to green' }),
      play(P + 24, P + 34, 1, { fadeOut: true }),
    ]
  }
  // liquidated: who popped me comes from the death card's "popped by X" line.
  const R = M.red, P = M.pop
  // Card text is upper case with a robot emoji for agents: match it to a label case-insensitively.
  const by = (data.frames[last].by || '').replace(/[^\w -]/g, '').trim().toLowerCase()
  const hunter = data.frames[P - 1].others.find((o) => o.label.toLowerCase() === by)?.label ?? null
  const name = hunter ?? 'The vault'
  const C = M.card
  const chase = P - 12 - (R + 10)
  const fast = Math.max(2, Math.ceil(chase / F / 1.8))
  return [
    play(R - 30, R, 1, { z: 1.5, zDur: 0.01, arrow: 'me', cap: `Owe ${owe(R - 30)}. A spike hits`, fadeIn: true }),
    play(R, R + 10, 1, { arrow: 'me', cap: 'Red, and not repaying' }),
    ...(chase > 15 ? [play(R + 10, P - 12, fast, { z: 1.1, cap: `Still red after ${Math.round((P - R) / F)} s` })] : []),
    play(Math.max(R + 10, P - 12), P - 1, 0.25, { z: 1.3, focus: hunter, arrow: hunter, cap: hunter ? `${hunter} touches you` : 'Still red' }),
    hold(P - 1, 1.1, { focus: hunter, arrow: hunter, cap: 'One touch: popped' }),
    play(P, P + 45, 1, { z: 1, zDur: 0.4, cap: hunter ? `${hunter} takes the bounty` : 'The vault closes the loan' }),
    play(P + 45, Math.min(last - 12, C + 66), 1, {}),
    play(Math.min(last - 12, C + 66), Math.min(last, C + 78), 1, { fadeOut: true }),
  ]
}

const html = fs.readFileSync(path.join(__dirname, 'compose.html'), 'utf8')
  .replace('/*DATA*/null', JSON.stringify(data))
  .replace('/*SHOTS*/null', JSON.stringify(shots()))
fs.writeFileSync(path.join(DIR, 'index.html'), html)
fs.copyFileSync(path.join(SKILL, 'node_modules/gsap/dist/gsap.min.js'), path.join(DIR, 'gsap.min.js'))

const render = (args) => execFileSync('node', [path.join(SKILL, 'render.cjs'), '--size', '640x640', '--fps', String(F), ...args], { cwd: DIR, stdio: 'inherit' })
if (STILLS) { render(['--stills', STILLS]); process.exit(0) }
render(['--out', 'master.mp4'])
const out = path.join(__dirname, '../../public/clips', `${CLIP}.mp4`)
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(DIR, 'master.mp4'), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
console.log(`${out} ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`)
