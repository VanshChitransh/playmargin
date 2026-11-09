// fast-auth and near-api-js 5 expect Node's Buffer and `global`. Imported first by email.ts so the
// global exists before those modules evaluate. Only the email login chunk pays for it.

import { Buffer } from "buffer";

const g = globalThis as { Buffer?: typeof Buffer; global?: typeof globalThis };
g.Buffer ??= Buffer;
g.global ??= globalThis;
