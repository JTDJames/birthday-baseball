import { auth } from "./firebase-init.js";
import {
  displayNameFromUser,
  signInWithGoogle,
  signOutTrivia,
} from "./trivia-auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function syncCardAuthBar() {
  const bar = document.getElementById("triviaCardAuthBar");
  if (!bar) return;
  const u = auth.currentUser;
  if (u) {
    const nm = escapeHtml(displayNameFromUser(u));
    bar.innerHTML = `Signed in as ${nm} · <button type="button" class="trivia-callout-auth-btn" id="triviaCardSignOut">Sign out</button>`;
    const outBtn = document.getElementById("triviaCardSignOut");
    if (outBtn)
      outBtn.onclick = () => {
        signOutTrivia().catch((err) => console.warn("Sign out failed:", err));
      };
  } else {
    bar.innerHTML = `Sign in with Google to count toward the leaderboard. <button type="button" class="trivia-callout-auth-btn" id="triviaCardSignIn">Sign in</button>`;
    const inBtn = document.getElementById("triviaCardSignIn");
    if (inBtn)
      inBtn.onclick = async () => {
        inBtn.disabled = true;
        try {
          await signInWithGoogle();
        } catch (err) {
          console.warn("Sign-in failed:", err);
        } finally {
          inBtn.disabled = false;
        }
      };
  }
}

onAuthStateChanged(auth, () => syncCardAuthBar());
syncCardAuthBar();
