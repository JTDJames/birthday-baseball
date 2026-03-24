import { db } from "./firebase-init.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pct(numerator, denominator) {
  if (!denominator) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = nums.slice().sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[m];
  return (sorted[m - 1] + sorted[m]) / 2;
}

function fmtDateKey(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ensureStatsModal() {
  let modal = document.getElementById("statsModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "statsModal";
  modal.style.cssText =
    "display:none; position:fixed; inset:0; z-index:1200; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,0,0,0.9); padding:1rem;";
  modal.innerHTML = `
    <div style="max-width:680px; width:100%; max-height:88vh; overflow:auto; background:#111; border:3px solid #fd5a1e; border-radius:10px; padding:1.1rem;">
      <h2 style="margin:0 0 0.85rem; color:#fd5a1e; text-align:center;">Giants Trivia Stats</h2>
      <p id="statsLoading" style="margin:0; color:#aaa; text-align:center;">Loading stats…</p>
      <div id="statsBody" style="display:none;">
        <div id="statsSummary" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(145px,1fr)); gap:0.55rem; margin-bottom:0.9rem;"></div>
        <div style="display:grid; gap:0.8rem;">
          <section style="border:1px solid #333; border-radius:8px; padding:0.7rem;">
            <h3 style="margin:0 0 0.5rem; color:#fd5a1e; font-size:1rem;">Accuracy by difficulty</h3>
            <div id="statsDifficulty" style="font-size:0.9rem; color:#ddd; line-height:1.6;"></div>
          </section>
          <section style="border:1px solid #333; border-radius:8px; padding:0.7rem;">
            <h3 style="margin:0 0 0.5rem; color:#fd5a1e; font-size:1rem;">Most missed questions</h3>
            <ol id="statsMissed" style="margin:0; padding-left:1.1rem; color:#ddd; font-size:0.88rem; line-height:1.45;"></ol>
          </section>
          <section style="border:1px solid #333; border-radius:8px; padding:0.7rem;">
            <h3 style="margin:0 0 0.5rem; color:#fd5a1e; font-size:1rem;">Highest challenge rate</h3>
            <ol id="statsChallengeRate" style="margin:0; padding-left:1.1rem; color:#ddd; font-size:0.88rem; line-height:1.45;"></ol>
          </section>
          <section style="border:1px solid #333; border-radius:8px; padding:0.7rem;">
            <h3 style="margin:0 0 0.5rem; color:#fd5a1e; font-size:1rem;">Games per day (last 14 days)</h3>
            <div id="statsTrend" style="font-size:0.88rem; color:#ddd; line-height:1.5;"></div>
          </section>
        </div>
      </div>
      <button type="button" id="statsClose" style="display:block; margin:1rem auto 0; padding:0.5rem 1.25rem; border-radius:8px; border:2px solid #fd5a1e; background:transparent; color:#f7f3e8; font-weight:700; cursor:pointer;">Close</button>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function renderEmpty(el, message) {
  el.innerHTML = `<li style="color:#888;">${escapeHtml(message)}</li>`;
}

async function loadAndRenderStats(modal) {
  const loading = modal.querySelector("#statsLoading");
  const body = modal.querySelector("#statsBody");
  loading.style.display = "block";
  body.style.display = "none";

  try {
    const [sessionsSnap, questionStatsSnap] = await Promise.all([
      getDocs(collection(db, "trivia_game_sessions")),
      getDocs(collection(db, "trivia_question_stats")),
    ]);

    const sessions = sessionsSnap.docs.map((d) => d.data());
    const questionStats = questionStatsSnap.docs.map((d) => d.data());

    const gamesPlayed = sessions.length;
    const scores = sessions.map((s) => Number(s.score || 0));
    const perfectGames = sessions.filter((s) => !!s.perfect).length;
    const med = median(scores);
    const avg =
      scores.length > 0
        ? (scores.reduce((sum, v) => sum + v, 0) / scores.length).toFixed(2)
        : "0.00";

    const allAnswers = [];
    sessions.forEach((s) => {
      const arr = Array.isArray(s.answers) ? s.answers : [];
      arr.forEach((a) => allAnswers.push(a));
    });

    const difficultyStats = {};
    allAnswers.forEach((a) => {
      const key = String(a.difficulty || "unknown");
      if (!difficultyStats[key]) difficultyStats[key] = { seen: 0, right: 0 };
      difficultyStats[key].seen += 1;
      if (a.correct) difficultyStats[key].right += 1;
    });

    const summary = modal.querySelector("#statsSummary");
    summary.innerHTML = `
      <div style="border:1px solid #333; border-radius:8px; padding:0.6rem; text-align:center;"><div style="font-size:0.72rem;color:#999;">Games played</div><div style="font-size:1.35rem;font-weight:800;color:#fd5a1e;">${gamesPlayed}</div></div>
      <div style="border:1px solid #333; border-radius:8px; padding:0.6rem; text-align:center;"><div style="font-size:0.72rem;color:#999;">Average score</div><div style="font-size:1.35rem;font-weight:800;color:#fd5a1e;">${avg}</div></div>
      <div style="border:1px solid #333; border-radius:8px; padding:0.6rem; text-align:center;"><div style="font-size:0.72rem;color:#999;">Median score</div><div style="font-size:1.35rem;font-weight:800;color:#fd5a1e;">${med}</div></div>
      <div style="border:1px solid #333; border-radius:8px; padding:0.6rem; text-align:center;"><div style="font-size:0.72rem;color:#999;">Perfect games</div><div style="font-size:1.35rem;font-weight:800;color:#fd5a1e;">${perfectGames} (${pct(perfectGames, gamesPlayed)})</div></div>
    `;

    const diffWrap = modal.querySelector("#statsDifficulty");
    const difficultyOrder = ["easy", "somewhat_easy", "medium", "hard", "very_hard"];
    const labels = {
      easy: "Easy",
      somewhat_easy: "Somewhat easy",
      medium: "Medium",
      hard: "Hard",
      very_hard: "Very hard",
      unknown: "Unknown",
    };
    const diffLines = [];
    difficultyOrder.concat(["unknown"]).forEach((k) => {
      const ds = difficultyStats[k];
      if (!ds) return;
      diffLines.push(
        `<div><strong>${labels[k]}</strong>: ${pct(ds.right, ds.seen)} (${ds.right}/${ds.seen})</div>`
      );
    });
    diffWrap.innerHTML = diffLines.length
      ? diffLines.join("")
      : '<div style="color:#888;">No answer data yet.</div>';

    const missed = questionStats
      .filter((q) => Number(q.wrongCount || 0) > 0)
      .sort((a, b) => Number(b.wrongCount || 0) - Number(a.wrongCount || 0))
      .slice(0, 5);
    const missedEl = modal.querySelector("#statsMissed");
    if (!missed.length) {
      renderEmpty(missedEl, "No misses recorded yet.");
    } else {
      missedEl.innerHTML = missed
        .map((q) => {
          const seen = Number(q.timesSeen || 0);
          const wrong = Number(q.wrongCount || 0);
          const rate = pct(wrong, seen);
          return `<li><div>${escapeHtml(q.questionPrompt || q.questionId || "Question")}</div><div style="color:#999;">${wrong} wrong of ${seen} shown (${rate})</div></li>`;
        })
        .join("");
    }

    const challengeLeaders = questionStats
      .filter((q) => Number(q.challengeCount || 0) > 0 && Number(q.timesSeen || 0) > 0)
      .map((q) => ({
        ...q,
        challengeRate: Number(q.challengeCount || 0) / Number(q.timesSeen || 1),
      }))
      .sort((a, b) => b.challengeRate - a.challengeRate)
      .slice(0, 5);
    const challengeEl = modal.querySelector("#statsChallengeRate");
    if (!challengeLeaders.length) {
      renderEmpty(challengeEl, "No challenges recorded yet.");
    } else {
      challengeEl.innerHTML = challengeLeaders
        .map((q) => {
          const seen = Number(q.timesSeen || 0);
          const ch = Number(q.challengeCount || 0);
          return `<li><div>${escapeHtml(q.questionPrompt || q.questionId || "Question")}</div><div style="color:#999;">${ch} challenges / ${seen} shown (${pct(ch, seen)})</div></li>`;
        })
        .join("");
    }

    const now = new Date();
    const daily = new Map();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      daily.set(fmtDateKey(d), 0);
    }
    sessions.forEach((s) => {
      const dt = toDate(s.playedAt);
      if (!dt) return;
      const key = fmtDateKey(dt);
      if (daily.has(key)) daily.set(key, Number(daily.get(key)) + 1);
    });
    const trendEl = modal.querySelector("#statsTrend");
    trendEl.innerHTML = Array.from(daily.entries())
      .map(([date, count]) => `${escapeHtml(date)}: <strong>${count}</strong>`)
      .join("<br/>");

    loading.style.display = "none";
    body.style.display = "block";
  } catch (e) {
    console.error(e);
    loading.textContent =
      "Could not load stats. Publish Firestore rules and make sure analytics collections exist.";
    loading.style.color = "#e88";
  }
}

const openBtn = document.getElementById("triviaStatsBtn");
if (openBtn) {
  openBtn.addEventListener("click", async () => {
    const modal = ensureStatsModal();
    modal.style.display = "flex";
    await loadAndRenderStats(modal);
  });
}

document.addEventListener("click", (e) => {
  const modal = document.getElementById("statsModal");
  if (!modal || modal.style.display === "none") return;
  if (e.target === modal) modal.style.display = "none";
  if (e.target && e.target.id === "statsClose") modal.style.display = "none";
});
