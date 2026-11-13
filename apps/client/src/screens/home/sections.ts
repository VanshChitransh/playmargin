// Home page sections below the hero: How it plays, the proof block and the footer. landing.ts
// renders the three containers and calls mountSections, whose cleanup stops every loop,
// observer and listener the sections started.
import "./sections.css";
import { mountStory } from "./story";
import { mountProof } from "./proof";
import { mountFooter } from "./footer";

/** Mount the sections into root's [data-home-*] containers; returns one cleanup for all. */
export function mountSections(root: HTMLElement): () => void {
  const stops: (() => void)[] = [];
  const at = (k: string, mount: (box: HTMLElement) => () => void): void => {
    const box = root.querySelector<HTMLElement>(`[data-home-${k}]`);
    if (box) stops.push(mount(box));
  };
  at("story", mountStory);
  at("proof", mountProof);
  at("footer", mountFooter);
  return () => stops.forEach((s) => s());
}
