// One render frame: everything the arena draws, in display units (never Micro).
// Built from the server patch (U2) or the synthetic generator; the renderer
// does not care which. Food and spike views are client-side until core/protocol has them.
import type { BlobView, MatchView } from "@margin/core";

export interface FoodView {
  id: number;
  x: number;
  y: number;
  r: number;
}

export interface SpikeView {
  id: number;
  x: number;
  y: number;
  big: boolean;
  /** Core hitbox radius: drawn exactly this size. */
  r: number;
}

export interface Frame {
  /** Id of the blob this client controls; the camera follows it. */
  me: string;
  arena: { w: number; h: number };
  match: MatchView;
  blobs: BlobView[];
  food: FoodView[];
  spikes: SpikeView[];
  /** Private room lobby (friends only, host taps START); absent in public and offline matches. */
  lobby?: { host: boolean };
  /** My match rate (private "me" message); absent offline, where the tier stands in. */
  rateBps?: number;
}
