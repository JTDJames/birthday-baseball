import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

const COLLECTION = "pinball_leaderboard";

function docToEntry(doc) {
  const d = doc.data();
  let atMs = Date.now();
  if (d.at != null) {
    if (typeof d.at.toMillis === "function") atMs = d.at.toMillis();
    else if (typeof d.at === "number") atMs = d.at;
  }
  return {
    initials: String(d.initials || "???").slice(0, 3),
    score: Math.max(0, Math.floor(Number(d.score) || 0)),
    at: atMs,
  };
}

export async function fetchPinballLeaderboard(max) {
  const q = query(
    collection(db, COLLECTION),
    orderBy("score", "desc"),
    limit(Math.max(1, Math.min(50, max || 10)))
  );
  const snap = await getDocs(q);
  return snap.docs.map(docToEntry);
}

export async function submitPinballScore({ initials, score }) {
  await addDoc(collection(db, COLLECTION), {
    initials,
    score: Math.max(0, Math.floor(score)),
    at: serverTimestamp(),
  });
}

if (typeof window !== "undefined") {
  window.bbPinballLeaderboard = {
    fetchTop: fetchPinballLeaderboard,
    submit: submitPinballScore,
  };
}
