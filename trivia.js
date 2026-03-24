import { db } from "./firebase-init.js";
import {
  addDoc,
  collection,
  getDocs,
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

async function loadQuestionBank() {
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
      };
    });
  }

  const out = [];
  for (let t = 0; t < DIFFICULTY_ORDER.length; t++) {
    const tier = DIFFICULTY_ORDER[t];
    const res = await fetch(`./data/trivia/${tier}.json`);
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
      });
    });
  }
  return out;
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

function injectStyles() {
  if (document.getElementById("trivia-styles")) return;
  const s = document.createElement("style");
  s.id = "trivia-styles";
  s.textContent = `
    #triviaModal.trivia-open { display: flex !important; }
    .trivia-panel {
      max-width: 520px; width: 100%; background: #111;
      border: 3px solid var(--giants-orange, #fd5a1e);
      border-radius: 12px; padding: 1.25rem 1.15rem 1.1rem;
      color: var(--giants-cream, #f7f3e8);
      box-shadow: 0 12px 40px rgba(0,0,0,0.55);
    }
    .trivia-panel h2 { margin: 0 0 0.35rem; color: var(--giants-orange, #fd5a1e); font-size: 1.35rem; text-align: center; }
    .trivia-meta { text-align: center; font-size: 0.85rem; color: #aaa; margin: 0 0 1rem; }
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
    .trivia-footer { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-top: 1rem; flex-wrap: wrap; }
    .trivia-challenge {
      font-size: 0.72rem; color: #777; background: none; border: none; text-decoration: underline; cursor: pointer; padding: 0.2rem 0;
    }
    .trivia-challenge:hover { color: #aaa; }
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

  let bank;
  let round;
  try {
    bank = await loadQuestionBank();
    round = buildRound(bank);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<p style="color:#e88;">Could not load questions. Check Firestore rules and that <code>data/trivia/*.json</code> exists if the bank is empty.</p>
      <button type="button" class="trivia-next" id="triviaCloseErr">Close</button>`;
    document.getElementById("triviaCloseErr").onclick = () => closeTriviaModal();
    return;
  }

  let step = 0;
  let score = 0;
  const answers = [];

  function closeTriviaModal() {
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
    const q = round[step];
    const n = step + 1;
    const diffLabel = DIFFICULTY_LABEL[q.difficulty] || q.difficulty;

    root.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin:-0.25rem 0 0.35rem;">
        <button type="button" id="triviaCloseTop" style="font-size:0.82rem;color:#888;background:none;border:none;cursor:pointer;padding:0.2rem 0;">Close</button>
      </div>
      <h2 style="margin-top:0;">Giants Trivia</h2>
      <p class="trivia-meta">Question ${n} of 5 · ${diffLabel}</p>
      <p class="trivia-prompt" id="triviaPrompt"></p>
      <div class="trivia-choices" id="triviaChoices"></div>
      <div class="trivia-footer">
        <button type="button" class="trivia-challenge" id="triviaChallengeBtn">Challenge this question</button>
        <button type="button" class="trivia-next" id="triviaNextBtn" disabled>Next</button>
      </div>
    `;

    document.getElementById("triviaPrompt").textContent = q.prompt;
    const choicesEl = document.getElementById("triviaChoices");
    const nextBtn = document.getElementById("triviaNextBtn");

    let answered = false;
    q.choices.forEach((text, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      btn.addEventListener("click", () => {
        if (answered) return;
        answered = true;
        const correct = idx === q.correctIndex;
        if (correct) score += 1;
        answers.push({ questionId: q.id, correct });
        choicesEl.querySelectorAll("button").forEach((b, bi) => {
          b.disabled = true;
          if (bi === q.correctIndex) b.classList.add("trivia-correct");
          else if (bi === idx && !correct) b.classList.add("trivia-wrong");
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
    document.getElementById("triviaChallengeBtn").onclick = () => openChallengeUI(q);
  }

  function renderSummary() {
    root.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin:-0.25rem 0 0.35rem;">
        <button type="button" id="triviaCloseTopSum" style="font-size:0.82rem;color:#888;background:none;border:none;cursor:pointer;padding:0.2rem 0;">Close</button>
      </div>
      <h2 style="margin-top:0;">Round complete</h2>
      <p class="trivia-meta">You got ${score} out of 5 correct.</p>
      <p class="trivia-score">Thanks for playing!</p>
      <div style="display:flex;gap:0.6rem;justify-content:center;margin-top:1rem;flex-wrap:wrap;">
        <button type="button" class="trivia-next" id="triviaPlayAgain">Play again</button>
        <button type="button" class="trivia-btn-secondary" id="triviaCloseSummary" style="padding:0.55rem 1rem;border-radius:8px;">Close</button>
      </div>
    `;
    document.getElementById("triviaPlayAgain").onclick = () => {
      round = buildRound(bank);
      step = 0;
      score = 0;
      renderQuestion();
    };
    document.getElementById("triviaCloseSummary").onclick = () => closeTriviaModal();
    document.getElementById("triviaCloseTopSum").onclick = () => closeTriviaModal();
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
