// Drives wallet.ts email login by hand: login -> (new) name -> quick play key -> ticket check.

import { createEmailAccount, onAccount, resumeEmail, signInEmail, signOut } from "../wallet";
import { enableQuickPlay } from "../session";

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const log = (m: unknown) => ($("log").textContent += `${m instanceof Error ? m.stack : typeof m === "string" ? m : JSON.stringify(m)}\n`);
let acc: string | null = null;

onAccount((a) => {
  acc = a;
  $("status").textContent = a ? `logged in as ${a}` : "logged out";
});
resumeEmail().then((s) => log(`resume: ${s}`), log);
$("login").onclick = () => void signInEmail().catch(log);
$("create").onclick = () => void createEmailAccount($("name").value).then(log, log);
$("quick").onclick = () => void (acc ? enableQuickPlay(acc).then(() => log("quick play key added"), log) : log("log in first"));
$("logout").onclick = () => void signOut().catch(log);
