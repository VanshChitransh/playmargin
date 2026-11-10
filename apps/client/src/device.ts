// Can this device play MARGIN? The game is laptop only for now (mouse + keyboard), see
// docs/future_feature.md. Decided by the input hardware, never the user agent: agar's UA check
// lets a desktop-mode iPad through to a page it cannot play.

/** True when there is a mouse or trackpad (a laptop, a touch laptop, an iPad with a trackpad). */
export function laptopCapable(): boolean {
  const mq = (q: string): boolean => typeof matchMedia === "function" && matchMedia(q).matches;
  // A phone or tablet: the main input is a finger and there is no fine pointer at all.
  return !(mq("(pointer: coarse)") && !mq("(any-pointer: fine)"));
}

/** Calls back when a pointer is plugged in or removed (a trackpad on an iPad). Returns the unsubscribe. */
export function onLaptopChange(cb: (capable: boolean) => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const qs = [matchMedia("(pointer: coarse)"), matchMedia("(any-pointer: fine)")];
  const f = (): void => cb(laptopCapable());
  qs.forEach((q) => q.addEventListener("change", f));
  return () => qs.forEach((q) => q.removeEventListener("change", f));
}
