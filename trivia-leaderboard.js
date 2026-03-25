import { db } from "./firebase-init.js";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/** Minimum lifetime correct answers to rank on the accuracy list (plan: e.g. 25). */
export const MIN_CORRECT_FOR_ACCURACY_BOARD = 25;

const LIST_LIMIT = 20;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pct(n, d) {
  if (!d || d <= 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function ensureModal() {
  let modal = document.getElementById("triviaLeaderboardModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "triviaLeaderboardModal";
  modal.style.cssText =
    "display:none; position:fixed; inset:0; z-index:1200; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,0,0,0.9); padding:1rem;";
  modal.innerHTML = `
    <div style="max-width:680px; width:100%; max-height:88vh; overflow:auto; background:#111; border:3px solid #fd5a1e; border-radius:10px; padding:1.1rem;">
      <h2 style="margin:0 0 0.85rem; color:#fd5a1e; text-align:center;">Trivia Leaderboard</h2>
      <p style="margin:0 0 0.75rem; color:#888; font-size:0.9rem; text-align:center;">
        Sign in with Google before finishing a round to record your stats. Accuracy list requires at least
        ${MIN_CORRECT_FOR_ACCURACY_BOARD} lifetime correct answers.
      </p>
      <p id="triviaLbLoading" style="margin:0; color:#aaa; text-align:center;">Loading…</p>
      <div id="triviaLbBody" style="display:none;">
        <div style="display:grid; gap:0.85rem;">
          <section style="border:1px solid #333; border-radius:8px; padding:0.7rem;">
            <h3 style="margin:0 0 0.5rem; color:#fd5a1e; font-size:1rem;">Most correct (lifetime)</h3>
            <ol id="triviaLbTotals" style="margin:0; padding-left:1.1rem; color:#ddd; font-size:0.88rem; line-height:1.5;"></ol>
          </section>
          <section style="border:1px solid #333; border-radius:8px; padding:0.7rem;">
            <h3 style="margin:0 0 0.5rem; color:#fd5a1e; font-size:1rem;">Perfect games (5/5)</h3>
            <ol id="triviaLbPerfect" style="margin:0; padding-left:1.1rem; color:#ddd; font-size:0.88rem; line-height:1.5;"></ol>
          </section>
          <section style="border:1px solid #333; border-radius:8px; padding:0.7rem;">
            <h3 style="margin:0 0 0.5rem; color:#fd5a1e; font-size:1rem;">Highest accuracy (min. ${MIN_CORRECT_FOR_ACCURACY_BOARD} correct)</h3>
            <ol id="triviaLbAccuracy" style="margin:0; padding-left:1.1rem; color:#ddd; font-size:0.88rem; line-height:1.5;"></ol>
          </section>
        </div>
      </div>
      <button type="button" id="triviaLbClose" style="display:block; margin:1rem auto 0; padding:0.5rem 1.25rem; border-radius:8px; border:2px solid #fd5a1e; background:transparent; color:#f7f3e8; font-weight:700; cursor:pointer;">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#triviaLbClose").addEventListener("click", () => {
    modal.style.display = "none";
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });
  return modal;
}

export async function openTriviaLeaderboardModal() {
  const modal = ensureModal();
  const loading = modal.querySelector("#triviaLbLoading");
  const body = modal.querySelector("#triviaLbBody");
  const totalsEl = modal.querySelector("#triviaLbTotals");
  const perfectEl = modal.querySelector("#triviaLbPerfect");
  const accEl = modal.querySelector("#triviaLbAccuracy");

  modal.style.display = "flex";
  loading.style.display = "block";
  body.style.display = "none";

  try {
    const col = collection(db, "trivia_player_stats");
    const [totSnap, perfSnap, accPoolSnap] = await Promise.all([
      getDocs(query(col, orderBy("totalCorrect", "desc"), limit(LIST_LIMIT))),
      getDocs(query(col, orderBy("perfectGames", "desc"), limit(LIST_LIMIT))),
      getDocs(query(col, orderBy("accuracy", "desc"), limit(80))),
    ]);

    function renderOl(el, rows, renderLine) {
      if (!rows.length) {
        el.innerHTML = `<li style="color:#888;">No players yet.</li>`;
        return;
      }
      el.innerHTML = rows
        .map((r) => `<li>${renderLine(r)}</li>`)
        .join("");
    }

    const totals = totSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderOl(totalsEl, totals, (r) => {
      const name = escapeHtml(String(r.displayName || "Player"));
      return `${name} — <strong>${Number(r.totalCorrect || 0)}</strong> correct`;
    });

    const perfects = perfSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderOl(perfectEl, perfects, (r) => {
      const name = escapeHtml(String(r.displayName || "Player"));
      return `${name} — <strong>${Number(r.perfectGames || 0)}</strong> perfect`;
    });

    const accPool = accPoolSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const accFiltered = accPool
      .filter((r) => Number(r.totalCorrect || 0) >= MIN_CORRECT_FOR_ACCURACY_BOARD)
      .slice(0, LIST_LIMIT);

    renderOl(accEl, accFiltered, (r) => {
      const name = escapeHtml(String(r.displayName || "Player"));
      const tc = Number(r.totalCorrect || 0);
      const ta = Number(r.totalQuestionsAnswered || 0);
      const accStr = pct(tc, ta);
      return `${name} — <strong>${accStr}</strong> (${tc} / ${ta})`;
    });

    loading.style.display = "none";
    body.style.display = "block";
  } catch (e) {
    console.error(e);
    loading.style.display = "block";
    loading.textContent =
      e && e.message
        ? `Could not load leaderboard: ${e.message}`
        : "Could not load leaderboard.";
  }
}

document.getElementById("triviaLeaderboardBtn")?.addEventListener("click", () => {
  openTriviaLeaderboardModal();
});
