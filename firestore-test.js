import { db } from "./firebase-init.js";
import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const FIRESTORE_DEBUG = () => {
  try {
    const p = new URLSearchParams(window.location.search);
    return p.get("debug") === "firestore";
  } catch {
    return false;
  }
};

function showDebugLine(message) {
  if (!FIRESTORE_DEBUG()) return;
  const el = document.createElement("p");
  el.id = "firestoreDebugStatus";
  el.style.cssText =
    "font-size:0.75rem;color:#888;text-align:center;margin:1.5rem 0 0;padding:0 1rem;";
  el.textContent = message;
  document.body.appendChild(el);
}

function showErrorBanner(message) {
  const el = document.createElement("div");
  el.setAttribute("role", "alert");
  el.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;background:#4a1515;color:#f7f3e8;padding:0.55rem 1rem;font-size:0.85rem;text-align:center;z-index:10000;line-height:1.35;";
  el.textContent = message;
  document.body.appendChild(el);
}

async function run() {
  try {
    const snap = await getDocs(collection(db, "questions"));
    const n = snap.size;
    const msg = `FIRESTORE: OK — read "questions" (${n} document${n === 1 ? "" : "s"})`;
    console.info("%c" + msg, "color:#2d7a3e;font-weight:bold");
    window.__firestoreTestResult = { ok: true, count: n };
    if (FIRESTORE_DEBUG()) {
      showDebugLine(`Firestore: connected · ${n} question(s) in collection "questions"`);
    }
  } catch (err) {
    const code = err && err.code ? err.code : "unknown";
    const detail = err && err.message ? err.message : String(err);
    console.error("FIRESTORE TEST FAILED", code, detail);
    window.__firestoreTestResult = { ok: false, code, detail };
    showErrorBanner(
      `Firestore read failed (${code}). Check console & Firestore rules. ${detail}`
    );
  }
}

run();
