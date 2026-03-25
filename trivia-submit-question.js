import { auth, db } from "./firebase-init.js";
import { displayNameFromUser } from "./trivia-auth.js";
import {
  addDoc,
  collection,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const DIFFICULTY_KEYS = [
  "easy",
  "somewhat_easy",
  "medium",
  "hard",
  "very_hard",
];

const DIFFICULTY_LABELS = [
  "1 — Easy",
  "2 — Somewhat easy",
  "3 — Medium",
  "4 — Hard",
  "5 — Very hard (highest)",
];

const MAX_PROMPT = 2000;
const MAX_ANSWER = 500;
const MAX_AUTHOR = 120;

function injectStyles() {
  if (document.getElementById("trivia-submit-styles")) return;
  const s = document.createElement("style");
  s.id = "trivia-submit-styles";
  s.textContent = `
    #triviaSubmitOverlay {
      position: fixed; inset: 0; z-index: 1250;
      display: none; align-items: center; justify-content: center;
      padding: 1rem; background: rgba(0,0,0,0.82);
    }
    #triviaSubmitOverlay.trivia-submit-open { display: flex !important; }
    .trivia-submit-panel {
      max-width: 480px; width: 100%; max-height: 90vh; overflow-y: auto;
      background: #111; border: 3px solid #fd5a1e; border-radius: 12px;
      padding: 1.15rem 1.1rem 1rem; color: #f7f3e8;
      box-shadow: 0 12px 40px rgba(0,0,0,0.55);
    }
    .trivia-submit-panel h2 { margin: 0 0 0.5rem; color: #fd5a1e; font-size: 1.2rem; text-align: center; }
    .trivia-submit-panel .trivia-submit-lede {
      font-size: 0.88rem; color: #999; line-height: 1.45; margin: 0 0 1rem; text-align: center;
    }
    .trivia-submit-panel label {
      display: block; font-size: 0.82rem; color: #bbb; margin: 0.65rem 0 0.25rem; font-weight: 600;
    }
    .trivia-submit-panel input[type="text"],
    .trivia-submit-panel input[type="email"],
    .trivia-submit-panel textarea,
    .trivia-submit-panel select {
      width: 100%; padding: 0.5rem 0.6rem; border-radius: 8px; border: 2px solid #444;
      background: #0d0d0d; color: #eee; font-size: 0.95rem; font-family: inherit;
      box-sizing: border-box;
    }
    .trivia-submit-panel textarea { min-height: 72px; resize: vertical; }
    .trivia-submit-panel .trivia-submit-radio-row {
      display: flex; flex-direction: column; gap: 0.45rem; margin-top: 0.35rem;
    }
    .trivia-submit-panel .trivia-submit-radio-row label {
      display: flex; align-items: flex-start; gap: 0.45rem; margin: 0; font-weight: 500; cursor: pointer;
    }
    .trivia-submit-panel .trivia-submit-radio-row input { width: auto; margin-top: 0.2rem; }
    .trivia-submit-panel .trivia-submit-actions {
      display: flex; gap: 0.5rem; justify-content: flex-end; flex-wrap: wrap; margin-top: 1rem;
    }
    .trivia-submit-panel .trivia-submit-actions button {
      padding: 0.5rem 1rem; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.92rem;
    }
    .trivia-submit-secondary { border: 2px solid #666; background: transparent; color: #f7f3e8; }
    .trivia-submit-primary { border: 2px solid #fd5a1e; background: #fd5a1e; color: #111; }
    .trivia-submit-status { font-size: 0.88rem; margin: 0.5rem 0 0; min-height: 1.25em; }
    .trivia-submit-hidden { display: none !important; }
  `;
  document.head.appendChild(s);
}

function openSubmitQuestionModal() {
  injectStyles();
  let overlay = document.getElementById("triviaSubmitOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "triviaSubmitOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "triviaSubmitHeading");
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="trivia-submit-panel">
      <h2 id="triviaSubmitHeading">Submit a trivia question</h2>
      <p class="trivia-submit-lede">
        Questions are reviewed before they go live. If you ask for AI wrong answers, an organizer will add them when approving.
      </p>
      <form id="triviaSubmitForm" novalidate>
        <label for="triviaSubmitAuthor">Author name</label>
        <input id="triviaSubmitAuthor" name="authorName" type="text" maxlength="${MAX_AUTHOR}" required autocomplete="name" placeholder="How you want to be credited" />

        <label for="triviaSubmitPrompt">Question</label>
        <textarea id="triviaSubmitPrompt" name="prompt" maxlength="${MAX_PROMPT}" required placeholder="Full question text"></textarea>

        <label for="triviaSubmitCorrect">Correct answer</label>
        <input id="triviaSubmitCorrect" name="correctAnswer" type="text" maxlength="${MAX_ANSWER}" required placeholder="The right choice" />

        <label for="triviaSubmitDifficulty">Difficulty (1 = easiest, 5 = hardest)</label>
        <select id="triviaSubmitDifficulty" name="difficulty" required>
          ${DIFFICULTY_KEYS.map(
            (k, i) =>
              `<option value="${k}">${escapeHtml(DIFFICULTY_LABELS[i])}</option>`
          ).join("")}
        </select>

        <span style="display:block;font-size:0.78rem;color:#888;margin-top:0.35rem;">Wrong answers</span>
        <div class="trivia-submit-radio-row">
          <label><input type="radio" name="wrongSource" value="manual" checked /> I’ll provide three wrong answers</label>
          <label><input type="radio" name="wrongSource" value="ai_requested" /> Use AI-generated wrong answers (added when approved)</label>
        </div>

        <div id="triviaSubmitWrongFields">
          <label for="triviaSubmitWrong1">Wrong answer 1</label>
          <input id="triviaSubmitWrong1" type="text" maxlength="${MAX_ANSWER}" />
          <label for="triviaSubmitWrong2">Wrong answer 2</label>
          <input id="triviaSubmitWrong2" type="text" maxlength="${MAX_ANSWER}" />
          <label for="triviaSubmitWrong3">Wrong answer 3</label>
          <input id="triviaSubmitWrong3" type="text" maxlength="${MAX_ANSWER}" />
        </div>

        <p id="triviaSubmitStatus" class="trivia-submit-status" role="status"></p>
        <div class="trivia-submit-actions">
          <button type="button" class="trivia-submit-secondary" id="triviaSubmitCancel">Cancel</button>
          <button type="submit" class="trivia-submit-primary" id="triviaSubmitSend">Submit</button>
        </div>
      </form>
    </div>
  `;

  const form = overlay.querySelector("#triviaSubmitForm");
  const statusEl = overlay.querySelector("#triviaSubmitStatus");
  const wrongBlock = overlay.querySelector("#triviaSubmitWrongFields");
  const wrongInputs = [
    overlay.querySelector("#triviaSubmitWrong1"),
    overlay.querySelector("#triviaSubmitWrong2"),
    overlay.querySelector("#triviaSubmitWrong3"),
  ];

  function syncWrongVisibility() {
    const manual = overlay.querySelector(
      'input[name="wrongSource"]:checked'
    )?.value === "manual";
    wrongBlock.classList.toggle("trivia-submit-hidden", !manual);
    wrongInputs.forEach((el) => {
      if (el) el.required = manual;
    });
  }

  overlay.querySelectorAll('input[name="wrongSource"]').forEach((r) => {
    r.addEventListener("change", syncWrongVisibility);
  });
  syncWrongVisibility();

  overlay.querySelector("#triviaSubmitCancel").onclick = () => closeModal();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  function closeModal() {
    document.removeEventListener("keydown", onKey);
    overlay.classList.remove("trivia-submit-open");
    overlay.innerHTML = "";
  }

  function onKey(ev) {
    if (ev.key === "Escape" && overlay.classList.contains("trivia-submit-open")) {
      closeModal();
    }
  }
  document.addEventListener("keydown", onKey);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    statusEl.style.color = "#aaa";
    statusEl.textContent = "";

    const authorName = form.querySelector("#triviaSubmitAuthor").value.trim();
    const prompt = form.querySelector("#triviaSubmitPrompt").value.trim();
    const correctAnswer = form.querySelector("#triviaSubmitCorrect").value.trim();
    const difficulty = form.querySelector("#triviaSubmitDifficulty").value;
    const wrongSource = form.querySelector(
      'input[name="wrongSource"]:checked'
    )?.value;

    if (!authorName || !prompt || !correctAnswer) {
      statusEl.style.color = "#e88";
      statusEl.textContent = "Please fill in author, question, and correct answer.";
      return;
    }

    const correctNorm = correctAnswer.toLowerCase();
    let wrongAnswers = [];
    let wrongAnswersSource = "ai_requested";

    if (wrongSource === "manual") {
      wrongAnswers = wrongInputs.map((el) => (el ? el.value.trim() : ""));
      if (wrongAnswers.some((w) => !w)) {
        statusEl.style.color = "#e88";
        statusEl.textContent = "Please enter all three wrong answers.";
        return;
      }
      const set = new Set(
        wrongAnswers.map((w) => w.toLowerCase()).concat([correctNorm])
      );
      if (set.size < 4) {
        statusEl.style.color = "#e88";
        statusEl.textContent =
          "Wrong answers must be different from each other and from the correct answer.";
        return;
      }
      wrongAnswersSource = "manual";
    }

    const submitBtn = overlay.querySelector("#triviaSubmitSend");
    submitBtn.disabled = true;
    statusEl.textContent = "Sending…";

    try {
      const payload = {
        authorName,
        prompt,
        correctAnswer,
        difficulty,
        wrongAnswersSource,
        wrongAnswers,
        status: "pending",
        submittedAt: serverTimestamp(),
      };

      const user = auth.currentUser;
      if (user) {
        payload.submitterUid = user.uid;
        payload.submitterDisplayName = displayNameFromUser(user);
      }

      await addDoc(collection(db, "trivia_question_submissions"), payload);
      statusEl.style.color = "#8fd68f";
      statusEl.textContent = "Thanks! Your question was submitted for review.";
      submitBtn.disabled = true;
      form
        .querySelectorAll("input, textarea, select, button")
        .forEach((el) => {
          if (el.type !== "button" && el.id !== "triviaSubmitCancel")
            el.disabled = true;
        });
      setTimeout(() => closeModal(), 2200);
    } catch (err) {
      console.error(err);
      submitBtn.disabled = false;
      statusEl.style.color = "#e88";
      statusEl.textContent =
        err && err.message
          ? `Could not submit: ${err.message}`
          : "Could not submit. Try again later.";
    }
  });

  overlay.classList.add("trivia-submit-open");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

document
  .getElementById("triviaSubmitQuestionBtn")
  ?.addEventListener("click", () => openSubmitQuestionModal());
