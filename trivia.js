import { db } from "./firebase-init.js";
import {
  auth,
  displayNameFromUser,
  signInWithGoogle,
  signOutTrivia,
} from "./trivia-auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const DIFFICULTY_ORDER = [
  "easy",
  "somewhat_easy",
  "medium",
  "hard",
  "very_hard",
];

const DIFFICULTY_LABEL = {
  easy: "Easy",
  somewhat_easy: "Somewhat easy",
  medium: "Medium",
  hard: "Hard",
  very_hard: "Very hard",
};

function shufflePick(arr) {
  const i = Math.floor(Math.random() * arr.length);
  return arr[i];
}

/** Randomize on-screen order; keep mapping to original choice indices for scoring/analytics. */
function shuffleChoicesDisplay(q) {
  const paired = q.choices.map((text, origIdx) => ({ text, origIdx }));
  for (let i = paired.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [paired[i], paired[j]] = [paired[j], paired[i]];
  }
  return paired;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Resolved relative to this module so fetch works even when the page URL path differs. */
function triviaDataUrl(tier) {
  return new URL(`./data/trivia/${tier}.json`, import.meta.url).href;
}

async function loadJsonBank() {
  const out = [];
  for (let t = 0; t < DIFFICULTY_ORDER.length; t++) {
    const tier = DIFFICULTY_ORDER[t];
    const res = await fetch(triviaDataUrl(tier));
    if (!res.ok) {
      throw new Error(`Missing trivia file for ${tier} (${res.status})`);
    }
    const arr = await res.json();
    arr.forEach((q, idx) => {
      out.push({
        id: `local-${tier}-${idx}`,
        difficulty: tier,
        prompt: q.prompt,
        choices: q.choices,
        correctIndex: q.correctIndex,
        category: q.category ?? "",
        author: q.author ?? "AI generated",
      });
    });
  }
  return out;
}

async function loadQuestionBank() {
  try {
    const snap = await getDocs(collection(db, "questions"));
    if (!snap.empty) {
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          difficulty: data.difficulty,
          prompt: data.prompt,
          choices: data.choices,
          correctIndex: data.correctIndex,
          category: data.category ?? "",
          author: data.author ?? "AI generated",
        };
      });
    }
  } catch (e) {
    console.warn(
      "Firestore questions read failed (rules or offline); using local JSON.",
      e
    );
  }

  return loadJsonBank();
}

function buildRound(bank) {
  const round = [];
  for (const tier of DIFFICULTY_ORDER) {
    const pool = bank.filter((q) => q.difficulty === tier);
    if (pool.length === 0) {
      throw new Error(`No questions available for difficulty: ${tier}`);
    }
    round.push(shufflePick(pool));
  }
  return round;
}

/**
 * Persist analytics for each completed round.
 * - trivia_game_sessions: one document per completed round
 * - trivia_question_stats: rolling counters by questionId
 * - trivia_player_stats/{uid}: lifetime totals when `user` is signed in
 */
async function persistRoundAnalytics(answers, score, user) {
  if (!Array.isArray(answers) || answers.length === 0) return;
  const playedAt = Timestamp.now();
  const normalized = answers.map((a) => ({
    questionId: String(a.question.id),
    questionPrompt: String(a.question.prompt || ""),
    difficulty: String(a.question.difficulty || ""),
    category: String(a.question.category || ""),
    correct: !!a.correct,
    pickedIndex: Number(a.pickedIndex),
    correctIndex: Number(a.question.correctIndex),
  }));

  const sessionPayload = {
    score: Number(score),
    totalQuestions: normalized.length,
    perfect: Number(score) === normalized.length,
    playedAt,
    gameType: "giants_trivia",
    answers: normalized,
  };
  if (user) {
    sessionPayload.playerId = user.uid;
    sessionPayload.playerDisplayName = displayNameFromUser(user);
  }

  // 1) Session-level event log (best source of truth)
  await addDoc(collection(db, "trivia_game_sessions"), sessionPayload);

  if (user) {
    const uid = user.uid;
    const displayName = displayNameFromUser(user);
    const statsRef = doc(db, "trivia_player_stats", uid);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(statsRef);
      const prev = snap.exists() ? snap.data() : null;
      const totalGames = Number(prev?.totalGames || 0) + 1;
      const totalCorrect = Number(prev?.totalCorrect || 0) + Number(score);
      const totalQuestionsAnswered =
        Number(prev?.totalQuestionsAnswered || 0) + normalized.length;
      const perfectGames =
        Number(prev?.perfectGames || 0) +
        (Number(score) === normalized.length ? 1 : 0);
      const accuracy =
        totalQuestionsAnswered > 0 ? totalCorrect / totalQuestionsAnswered : 0;
      tx.set(
        statsRef,
        {
          displayName,
          totalGames,
          totalCorrect,
          totalQuestionsAnswered,
          perfectGames,
          accuracy,
          lastPlayedAt: playedAt,
        },
        { merge: true }
      );
    });
  }

  // 2) Aggregated per-question counters
  const perQuestionDeltas = new Map();
  normalized.forEach((row) => {
    const prev = perQuestionDeltas.get(row.questionId) || {
      questionId: row.questionId,
      difficulty: row.difficulty,
      category: row.category,
      timesSeen: 0,
      rightDelta: 0,
      wrongDelta: 0,
    };
    prev.timesSeen += 1;
    if (row.correct) prev.rightDelta += 1;
    else prev.wrongDelta += 1;
    perQuestionDeltas.set(row.questionId, prev);
  });

  // Use transactions to avoid lost updates if multiple users finish simultaneously.
  for (const delta of perQuestionDeltas.values()) {
    const ref = doc(db, "trivia_question_stats", delta.questionId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const timesSeen = Number(data.timesSeen || 0) + delta.timesSeen;
      const rightCount = Number(data.rightCount || 0) + delta.rightDelta;
      const wrongCount = Number(data.wrongCount || 0) + delta.wrongDelta;
      tx.set(
        ref,
        {
          questionId: delta.questionId,
          questionPrompt: normalized.find((n) => n.questionId === delta.questionId)
            ?.questionPrompt || "",
          difficulty: delta.difficulty,
          category: delta.category,
          timesSeen,
          rightCount,
          wrongCount,
          challengeCount: Number(data.challengeCount || 0),
          lastUpdatedAt: playedAt,
        },
        { merge: true }
      );
    });
  }
}

function injectStyles() {
  if (document.getElementById("trivia-styles")) return;
  const s = document.createElement("style");
  s.id = "trivia-styles";
  s.textContent = `
    #triviaModal.trivia-open { display: flex !important; }
    .trivia-panel {
      position: relative; z-index: 2;
      max-width: 520px; width: 100%; background: #111;
      border: 3px solid var(--giants-orange, #fd5a1e);
      border-radius: 12px; padding: 1.25rem 1.15rem 1.1rem;
      color: var(--giants-cream, #f7f3e8);
      box-shadow: 0 12px 40px rgba(0,0,0,0.55);
    }
    .trivia-panel.trivia-panel-wide { max-width: 600px; }
    .trivia-panel h2 { margin: 0 0 0.35rem; color: var(--giants-orange, #fd5a1e); font-size: 1.35rem; text-align: center; }
    .trivia-meta { text-align: center; font-size: 0.85rem; color: #aaa; margin: 0 0 0.35rem; }
    .trivia-author { text-align: center; font-size: 0.72rem; color: #666; margin: 0 0 1rem; }
    .trivia-prompt { font-size: 1.08rem; margin: 0 0 1rem; line-height: 1.45; }
    .trivia-choices { display: flex; flex-direction: column; gap: 0.55rem; }
    .trivia-choices button {
      text-align: left; padding: 0.65rem 0.75rem; border-radius: 8px;
      border: 2px solid #444; background: #1a1a1a; color: var(--giants-cream, #f7f3e8);
      font-size: 0.98rem; cursor: pointer; font-weight: 600;
    }
    .trivia-choices button:hover:not(:disabled) { border-color: var(--giants-orange, #fd5a1e); }
    .trivia-choices button:disabled { opacity: 0.85; cursor: default; }
    .trivia-choices button.trivia-correct { border-color: #2d7a3e; background: #142818; }
    .trivia-choices button.trivia-wrong { border-color: #8a2b2b; background: #241010; }
    .trivia-footer { display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap; }
    .trivia-challenge-end {
      font-size: 0.72rem; color: #888; background: none; border: none; text-decoration: underline; cursor: pointer;
      padding: 0.15rem 0; margin-top: 0.35rem; display: inline-block;
    }
    .trivia-challenge-end:hover { color: var(--giants-orange, #fd5a1e); }
    .trivia-summary-scroll { max-height: min(52vh, 420px); overflow-y: auto; margin: 0.75rem 0 0; padding-right: 0.35rem; text-align: left; }
    .trivia-summary-item {
      border: 1px solid #333; border-radius: 8px; padding: 0.65rem 0.75rem; margin-bottom: 0.55rem; background: #161616;
    }
    .trivia-summary-item:last-child { margin-bottom: 0; }
    .trivia-summary-item.trivia-summary-wrong { border-color: #5a3030; background: #1a1212; }
    .trivia-summary-item.trivia-summary-right { border-color: #2a4a2a; }
    .trivia-summary-head { font-size: 0.82rem; font-weight: 800; color: var(--giants-orange, #fd5a1e); margin: 0 0 0.35rem; }
    .trivia-summary-prompt { font-size: 0.9rem; margin: 0 0 0.35rem; line-height: 1.4; color: #e8e4dc; }
    .trivia-summary-correct { font-size: 0.82rem; margin: 0.35rem 0 0; color: #8fd68f; }
    .trivia-summary-picked { font-size: 0.78rem; margin: 0.25rem 0 0; color: #999; }
    .trivia-fireworks-layer {
      position: absolute; inset: 0; pointer-events: none; z-index: 1; overflow: hidden; border-radius: 0;
    }
    .trivia-firework-particle {
      position: absolute; width: 7px; height: 7px; border-radius: 50%;
      animation: trivia-firework-burst 1.15s ease-out forwards;
    }
    @keyframes trivia-firework-burst {
      0% { transform: translate(0, 0) rotate(0deg) scale(1); opacity: 1; }
      100% { transform: translate(var(--tx), var(--ty)) rotate(var(--rot)) scale(0.15); opacity: 0; }
    }
    .trivia-next {
      margin-left: auto; padding: 0.55rem 1rem; border-radius: 8px; border: 2px solid var(--giants-orange, #fd5a1e);
      background: var(--giants-orange, #fd5a1e); color: #111; font-weight: 800; cursor: pointer; font-size: 0.95rem;
    }
    .trivia-next:disabled { opacity: 0.45; cursor: not-allowed; }
    .trivia-score { font-size: 0.9rem; color: #ccc; margin-top: 0.75rem; text-align: center; }
    .trivia-backdrop {
      position: fixed; inset: 0; z-index: 1200; display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.88); padding: 1rem;
    }
    .trivia-challenge-panel label { display: block; font-size: 0.82rem; color: #bbb; margin: 0.5rem 0 0.25rem; }
    .trivia-challenge-panel textarea, .trivia-challenge-panel input[type="email"] {
      width: 100%; padding: 0.5rem 0.6rem; border-radius: 6px; border: 2px solid #444; background: #0d0d0d; color: #eee; font-size: 0.95rem;
    }
    .trivia-challenge-panel textarea { min-height: 88px; resize: vertical; }
    .trivia-challenge-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.75rem; flex-wrap: wrap; }
    .trivia-challenge-actions button {
      padding: 0.45rem 0.85rem; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.9rem;
    }
    .trivia-btn-secondary { border: 2px solid #666; background: transparent; color: var(--giants-cream, #f7f3e8); }
    .trivia-btn-primary { border: 2px solid var(--giants-orange, #fd5a1e); background: var(--giants-orange, #fd5a1e); color: #111; }
    .trivia-auth-bar { font-size: 0.78rem; color: #888; text-align: center; margin: 0 0 0.65rem; line-height: 1.45; }
    .trivia-auth-bar .trivia-auth-action { color: var(--giants-orange, #fd5a1e); background: none; border: none; text-decoration: underline; cursor: pointer; padding: 0; font-weight: 700; font-size: inherit; }
  `;
  document.head.appendChild(s);
}

async function openTriviaModal() {
  injectStyles();
  let modal = document.getElementById("triviaModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "triviaModal";
    modal.className = "trivia-backdrop";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "San Francisco Giants Trivia");
    document.body.appendChild(modal);
  }

  modal.innerHTML = `<div class="trivia-panel" id="triviaPanelRoot"></div>`;
  const root = document.getElementById("triviaPanelRoot");
  root.innerHTML = `<p style="text-align:center;color:#aaa;margin:0;">Loading trivia…</p>`;
  modal.style.display = "flex";
  modal.classList.add("trivia-open");

  /** @type {null | (() => void)} */
  let authUnsub = null;

  let bank;
  let round;
  try {
    bank = await loadQuestionBank();
    round = buildRound(bank);
  } catch (e) {
    console.error(e);
    const detail =
      e && typeof e.message === "string" ? e.message : String(e);
    const safe = detail
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    root.innerHTML = `<p style="color:#e88;">Could not load questions.</p>
      <p style="font-size:0.85rem;color:#aaa;margin:0.5rem 0 0;line-height:1.4;">${safe}</p>
      <p style="font-size:0.82rem;color:#888;margin:0.75rem 0 0;">If Firestore is empty, ensure <code>data/trivia/*.json</code> is next to <code>trivia.js</code> and you are using a local web server (not opening the HTML file directly).</p>
      <button type="button" class="trivia-next" id="triviaCloseErr" style="margin-top:1rem;">Close</button>`;
    document.getElementById("triviaCloseErr").onclick = () => closeTriviaModal();
    return;
  }

  authUnsub = onAuthStateChanged(auth, () => syncAuthBar());

  function syncAuthBar() {
    const bar = document.getElementById("triviaAuthBar");
    if (!bar) return;
    const u = auth.currentUser;
    if (u) {
      const nm = escapeHtml(displayNameFromUser(u));
      bar.innerHTML = `Signed in as ${nm} · <button type="button" class="trivia-auth-action" id="triviaSignOut">Sign out</button>`;
      const outBtn = document.getElementById("triviaSignOut");
      if (outBtn)
        outBtn.onclick = () => {
          signOutTrivia().catch((err) => console.warn("Sign out failed:", err));
        };
    } else {
      bar.innerHTML = `Sign in with Google to count on the leaderboard. <button type="button" class="trivia-auth-action" id="triviaSignIn">Sign in</button>`;
      const inBtn = document.getElementById("triviaSignIn");
      if (inBtn)
        inBtn.onclick = () => {
          signInWithGoogle().catch((err) =>
            console.warn("Sign-in failed:", err)
          );
        };
    }
  }

  let step = 0;
  let score = 0;
  /** @type {{ question: object, pickedIndex: number, correct: boolean }[]} */
  let answers = [];
  let analyticsPersistedForRound = false;

  function closeTriviaModal() {
    if (authUnsub) {
      authUnsub();
      authUnsub = null;
    }
    modal.style.display = "none";
    modal.classList.remove("trivia-open");
    modal.innerHTML = "";
    document.removeEventListener("keydown", onKey);
  }

  function onKey(ev) {
    if (ev.key === "Escape") {
      if (document.getElementById("triviaChallengeOverlay")) return;
      closeTriviaModal();
    }
  }
  document.addEventListener("keydown", onKey);

  function renderQuestion() {
    root.classList.remove("trivia-panel-wide");
    const q = round[step];
    const n = step + 1;
    const diffLabel = DIFFICULTY_LABEL[q.difficulty] || q.difficulty;
    const authorLabel = q.author ? String(q.author) : "AI generated";

    root.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin:-0.25rem 0 0.35rem;">
        <button type="button" id="triviaCloseTop" style="font-size:0.82rem;color:#888;background:none;border:none;cursor:pointer;padding:0.2rem 0;">Close</button>
      </div>
      <div id="triviaAuthBar" class="trivia-auth-bar"></div>
      <h2 style="margin-top:0;">Play Giants Trivia!</h2>
      <p class="trivia-meta">Question ${n} of 5 · ${diffLabel}</p>
      <p class="trivia-author">Author: ${escapeHtml(authorLabel)}</p>
      <p class="trivia-prompt" id="triviaPrompt"></p>
      <div class="trivia-choices" id="triviaChoices"></div>
      <div class="trivia-footer">
        <button type="button" class="trivia-next" id="triviaNextBtn" disabled>Next</button>
      </div>
    `;

    document.getElementById("triviaPrompt").textContent = q.prompt;
    const choicesEl = document.getElementById("triviaChoices");
    const nextBtn = document.getElementById("triviaNextBtn");

    const paired = shuffleChoicesDisplay(q);

    let answered = false;
    paired.forEach((item, displayIdx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = item.text;
      btn.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const pickedOriginal = item.origIdx;
        const correct = pickedOriginal === q.correctIndex;
        if (correct) score += 1;
        answers.push({ question: q, pickedIndex: pickedOriginal, correct });
        choicesEl.querySelectorAll("button").forEach((b, bi) => {
          b.disabled = true;
          const orig = paired[bi].origIdx;
          if (orig === q.correctIndex) b.classList.add("trivia-correct");
          else if (bi === displayIdx && !correct) b.classList.add("trivia-wrong");
        });
        nextBtn.disabled = false;
      });
      choicesEl.appendChild(btn);
    });

    nextBtn.onclick = () => {
      step += 1;
      if (step >= 5) renderSummary();
      else renderQuestion();
    };

    document.getElementById("triviaCloseTop").onclick = () => closeTriviaModal();
    syncAuthBar();
  }

  function showFireworks() {
    const layer = document.createElement("div");
    layer.className = "trivia-fireworks-layer";
    layer.setAttribute("aria-hidden", "true");
    const colors = ["#fd5a1e", "#111111", "#ff7a3d", "#2a2a2a", "#ffb020"];
    for (let w = 0; w < 3; w++) {
      setTimeout(() => {
        for (let i = 0; i < 35; i++) {
          const p = document.createElement("div");
          p.className = "trivia-firework-particle";
          p.style.left = `${8 + Math.random() * 84}%`;
          p.style.bottom = `${8 + Math.random() * 22}%`;
          p.style.background = colors[Math.floor(Math.random() * colors.length)];
          p.style.animationDelay = `${Math.random() * 0.15}s`;
          const dur = 0.95 + Math.random() * 0.55;
          p.style.animationDuration = `${dur}s`;
          const tx = (Math.random() - 0.5) * 300;
          const ty = -Math.random() * 340 - 60;
          const rot = (Math.random() - 0.5) * 540;
          p.style.setProperty("--tx", `${tx}px`);
          p.style.setProperty("--ty", `${ty}px`);
          p.style.setProperty("--rot", `${rot}deg`);
          layer.appendChild(p);
        }
      }, w * 280);
    }
    modal.insertBefore(layer, modal.firstChild);
    setTimeout(() => layer.remove(), 3600);
  }

  function renderSummary() {
    root.classList.add("trivia-panel-wide");
    const perfect = score === 5;
    const summaryRows = answers
      .map((a, i) => {
        const q = a.question;
        const diffLabel = DIFFICULTY_LABEL[q.difficulty] || q.difficulty;
        const n = i + 1;
        const correctText = q.choices[q.correctIndex];
        const pickedText = q.choices[a.pickedIndex];
        const ok = a.correct;
        const head = ok
          ? `Q${n} · ${diffLabel} · Correct`
          : `Q${n} · ${diffLabel} · Wrong`;
        const cls = ok ? "trivia-summary-right" : "trivia-summary-wrong";
        let html = `<div class="trivia-summary-item ${cls}">
          <div class="trivia-summary-head">${escapeHtml(head)}</div>
          <p class="trivia-summary-prompt">${escapeHtml(q.prompt)}</p>`;
        if (!ok) {
          html += `<p class="trivia-summary-correct">Correct answer: ${escapeHtml(correctText)}</p>
          <p class="trivia-summary-picked">Your answer: ${escapeHtml(pickedText)}</p>
          <button type="button" class="trivia-challenge-end" data-challenge-idx="${i}">Challenge this question</button>`;
        }
        html += `</div>`;
        return html;
      })
      .join("");

    root.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin:-0.25rem 0 0.35rem;">
        <button type="button" id="triviaCloseTopSum" style="font-size:0.82rem;color:#888;background:none;border:none;cursor:pointer;padding:0.2rem 0;">Close</button>
      </div>
      <div id="triviaAuthBar" class="trivia-auth-bar"></div>
      <h2 style="margin-top:0;">Round complete</h2>
      <p class="trivia-meta">${perfect ? "Perfect game — 5 for 5!" : `You got ${score} out of 5 correct.`}</p>
      <div class="trivia-summary-scroll">${summaryRows}</div>
      <p class="trivia-score" style="margin-top:0.75rem;">Thanks for playing!</p>
      <div style="display:flex;gap:0.6rem;justify-content:center;margin-top:1rem;flex-wrap:wrap;">
        <button type="button" class="trivia-next" id="triviaPlayAgain">Play again</button>
        <button type="button" class="trivia-btn-secondary" id="triviaCloseSummary" style="padding:0.55rem 1rem;border-radius:8px;">Close</button>
      </div>
    `;

    if (perfect) showFireworks();
    if (!analyticsPersistedForRound) {
      analyticsPersistedForRound = true;
      persistRoundAnalytics(answers, score, auth.currentUser).catch((e) => {
        console.warn("Could not persist trivia analytics:", e);
      });
    }

    root.querySelectorAll("[data-challenge-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-challenge-idx"), 10);
        const entry = answers[idx];
        if (entry && entry.question) openChallengeUI(entry.question);
      });
    });

    document.getElementById("triviaPlayAgain").onclick = () => {
      round = buildRound(bank);
      step = 0;
      score = 0;
      answers = [];
      analyticsPersistedForRound = false;
      renderQuestion();
    };
    document.getElementById("triviaCloseSummary").onclick = () => closeTriviaModal();
    document.getElementById("triviaCloseTopSum").onclick = () => closeTriviaModal();
    syncAuthBar();
  }

  renderQuestion();
}

function openChallengeUI(q) {
  const overlay = document.createElement("div");
  overlay.id = "triviaChallengeOverlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;padding:1rem;";
  overlay.innerHTML = `
    <div class="trivia-panel trivia-challenge-panel" style="max-width:440px;">
      <h2 style="margin-top:0;">Challenge</h2>
      <p style="font-size:0.9rem;color:#bbb;margin:0 0 0.5rem;line-height:1.4;">If you think the marked answer is wrong, tell us why. We review submissions and update the bank when needed.</p>
      <label for="triviaChallengeReason">Your reason (required)</label>
      <textarea id="triviaChallengeReason" maxlength="4000" placeholder="What should we verify?"></textarea>
      <label for="triviaChallengeEmail">Email (optional — if you want a reply)</label>
      <input id="triviaChallengeEmail" type="email" maxlength="200" placeholder="you@example.com" autocomplete="email" />
      <label>Which option do you believe is correct?</label>
      <div id="triviaClaimedChoices" style="display:flex;flex-direction:column;gap:0.35rem;margin-top:0.25rem;"></div>
      <p id="triviaChallengeStatus" style="font-size:0.85rem;color:#aaa;margin:0.5rem 0 0;min-height:1.2em;" role="status"></p>
      <div class="trivia-challenge-actions">
        <button type="button" class="trivia-btn-secondary" id="triviaChallengeCancel">Cancel</button>
        <button type="button" class="trivia-btn-primary" id="triviaChallengeSend">Submit</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const claimedWrap = overlay.querySelector("#triviaClaimedChoices");
  const addRadio = (value, label) => {
    const id = `triviaClaim_${value}`;
    const row = document.createElement("label");
    row.style.cssText = "display:flex;gap:0.5rem;align-items:flex-start;font-size:0.9rem;color:#ddd;cursor:pointer;";
    row.innerHTML = `<input type="radio" name="claimed" id="${id}" value="${value}" style="margin-top:0.2rem"/> <span>${label}</span>`;
    claimedWrap.appendChild(row);
  };
  addRadio("unsure", "Not sure / just a wording issue");
  q.choices.forEach((text, idx) => {
    addRadio(String(idx), `${String.fromCharCode(65 + idx)}. ${text}`);
  });
  const firstRadio = overlay.querySelector('input[name="claimed"]');
  if (firstRadio) firstRadio.checked = true;

  overlay.querySelector("#triviaChallengeCancel").onclick = () => overlay.remove();
  overlay.querySelector("#triviaChallengeSend").onclick = async () => {
    const reason = overlay.querySelector("#triviaChallengeReason").value.trim();
    const email = overlay.querySelector("#triviaChallengeEmail").value.trim();
    const statusEl = overlay.querySelector("#triviaChallengeStatus");
    if (!reason) {
      statusEl.textContent = "Please add a short reason.";
      statusEl.style.color = "#e88";
      return;
    }
    const sel = overlay.querySelector('input[name="claimed"]:checked');
    let claimedCorrectIndex = null;
    if (sel && sel.value !== "unsure") {
      const parsed = parseInt(sel.value, 10);
      if (!Number.isNaN(parsed)) claimedCorrectIndex = parsed;
    }
    statusEl.style.color = "#aaa";
    statusEl.textContent = "Sending…";
    try {
      const payload = {
        questionId: q.id,
        questionPrompt: q.prompt,
        reason,
        status: "open",
        createdAt: serverTimestamp(),
      };
      if (claimedCorrectIndex !== null) payload.claimedCorrectIndex = claimedCorrectIndex;
      if (email) payload.contactEmail = email;

      await addDoc(collection(db, "challenges"), payload);
      // Keep a rolling challenge counter per question for analytics.
      const qRef = doc(db, "trivia_question_stats", String(q.id));
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(qRef);
        const data = snap.exists() ? snap.data() : {};
        tx.set(
          qRef,
          {
            questionId: String(q.id),
            questionPrompt: String(q.prompt || ""),
            difficulty: String(q.difficulty || ""),
            category: String(q.category || ""),
            timesSeen: Number(data.timesSeen || 0),
            rightCount: Number(data.rightCount || 0),
            wrongCount: Number(data.wrongCount || 0),
            challengeCount: Number(data.challengeCount || 0) + 1,
            lastUpdatedAt: Timestamp.now(),
          },
          { merge: true }
        );
      });
      statusEl.style.color = "#8fd68f";
      statusEl.textContent = "Thanks — we received your challenge.";
      overlay.querySelector("#triviaChallengeSend").disabled = true;
      setTimeout(() => overlay.remove(), 1400);
    } catch (err) {
      console.error(err);
      statusEl.style.color = "#e88";
      statusEl.textContent =
        err && err.message
          ? `Could not send: ${err.message}`
          : "Could not send. Check Firestore rules for challenges.";
    }
  };

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

document.getElementById("giantsTriviaBtn")?.addEventListener("click", () => {
  openTriviaModal();
});
