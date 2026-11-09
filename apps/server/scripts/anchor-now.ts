// Ops: run the hourly anchor once against DB_PATH with the settler from env, and print the result.
// Usage: DB_PATH=margin.sqlite NETWORK=testnet CONTRACT_ID=... SETTLER_ID=... SETTLER_PRIVATE_KEY=... npx tsx apps/server/scripts/anchor-now.ts
import { anchorPending } from "../src/anchor/job";
import { openDb } from "../src/db";
import { sharedChain } from "../src/settlement";

const db = openDb();
const sent = await anchorPending(db, sharedChain());
console.log(`anchors sent on chain: ${sent}`);
console.log(db.prepare("SELECT hour, root, tx_hash FROM anchors ORDER BY hour DESC LIMIT 5").all());
