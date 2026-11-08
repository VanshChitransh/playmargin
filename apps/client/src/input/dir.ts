// Mouse steering maths, kept pure so it can be tested without a DOM.

/** Steering vector (|v| <= 1) from a pointer at (px, py) on a w x h screen; my blob sits at the centre. */
export function dirFromPointer(px: number, py: number, w: number, h: number): { x: number; y: number } {
  const dx = px - w / 2;
  const dy = py - h / 2;
  const d = Math.hypot(dx, dy);
  if (d < 12) return { x: 0, y: 0 }; // dead zone: resting the mouse on the blob stops it
  // Full speed a quarter screen away, so small hand moves still steer precisely.
  const m = Math.min(1, d / (Math.min(w, h) * 0.25));
  return { x: (dx / d) * m, y: (dy / d) * m };
}
