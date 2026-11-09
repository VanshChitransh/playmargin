// One switch for players who asked their OS for less motion: pulses, wobble, trails and shakes
// calm down to static cues. Danger keeps its shape and its label, so nothing is lost.
export const reducedMotion: boolean = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
