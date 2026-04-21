import { db, auth } from "./firebase-init.js";
import { signInWithGoogle, signOutTrivia } from "./trivia-auth.js";
import {
  Timestamp,
  doc,
  getDoc,
  onSnapshot,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const form = document.getElementById("rsvpForm");
const authPanel = document.getElementById("rsvpAuthPanel");
const statusEl = document.getElementById("rsvpStatus");
const splashGameEl = document.getElementById("splashGameCount");

function digitsOnly(s) {
  return String(s).replace(/\D/g, "");
}

function normalizeUsPhone(raw) {
  const digits = digitsOnly(raw);
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits[0] === "1") {
    return `+${digits}`;
  }
  return "";
}

function normalizeEmail(s) {
  return String(s).trim().toLowerCase();
}

function isPlausibleEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || "";
}

function syncSplashGameBanner() {
  if (!splashGameEl) return;
  onSnapshot(
    doc(db, "stats", "splash_game"),
    function (snap) {
      const n = snap.exists() ? snap.data().count : 0;
      splashGameEl.textContent = String(typeof n === "number" ? n : 0);
    },
    function () {
      splashGameEl.textContent = "—";
    }
  );
}

function renderSignedOut() {
  if (!authPanel) return;
  authPanel.hidden = false;
  authPanel.innerHTML = `
    <p class="rsvp-lede" style="margin-bottom:0.75rem;">Sign in once so you can RSVP for the game and update your details later.</p>
    <button type="button" class="rsvp-google-btn" id="rsvpSignInGoogle">Sign in with Google</button>
  `;
  const btn = document.getElementById("rsvpSignInGoogle");
  if (btn) {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      setStatus("");
      try {
        await signInWithGoogle();
      } catch (err) {
        console.error(err);
        setStatus("Sign-in did not finish. Try again.");
      } finally {
        btn.disabled = false;
      }
    });
  }
  if (form) form.hidden = true;
}

function fillFormFromDoc(data) {
  if (!form) return;
  const first = form.querySelector('[name="firstName"]');
  const last = form.querySelector('[name="lastName"]');
  const email = form.querySelector('[name="email"]');
  const phone = form.querySelector('[name="phone"]');
  if (first) first.value = data.firstName || "";
  if (last) last.value = data.lastName || "";
  if (email) email.value = data.email || "";
  if (phone) phone.value = data.phone || "";
}

async function renderSignedIn(user) {
  if (!authPanel || !form) return;
  authPanel.hidden = false;
  const label = user.displayName || user.email || "Guest";
  authPanel.innerHTML = `
    <p class="rsvp-lede" style="margin-bottom:0.5rem;">Signed in as <strong>${escapeHtml(
      label
    )}</strong></p>
    <button type="button" class="rsvp-signout-btn" id="rsvpSignOut">Sign out</button>
  `;
  document.getElementById("rsvpSignOut")?.addEventListener("click", () => {
    signOutTrivia().catch((e) => console.warn(e));
  });

  form.hidden = false;
  setStatus("Loading your RSVP…");
  try {
    const ref = doc(db, "rsvp_submissions", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      fillFormFromDoc(snap.data());
      setStatus("Update your details anytime — saves here.");
    } else {
      form.reset();
      setStatus(
        "RSVP is for the game only (tickets). The park hang does not need an RSVP."
      );
    }
  } catch (e) {
    console.error(e);
    setStatus("Could not load your RSVP. Check connection or rules.");
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    renderSignedOut();
    setStatus("");
    return;
  }
  renderSignedIn(user);
});

if (form) {
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) {
      setStatus("Please sign in first.");
      return;
    }

    const firstName = (
      (form.querySelector('[name="firstName"]') || {}).value || ""
    ).trim();
    const lastName = (
      (form.querySelector('[name="lastName"]') || {}).value || ""
    ).trim();
    const emailRaw = (
      (form.querySelector('[name="email"]') || {}).value || ""
    ).trim();
    const phoneRaw = (
      (form.querySelector('[name="phone"]') || {}).value || ""
    ).trim();

    const email = normalizeEmail(emailRaw);

    if (!firstName) {
      setStatus("Please enter your first name.");
      form.querySelector('[name="firstName"]')?.focus();
      return;
    }
    if (!lastName) {
      setStatus("Please enter your last name.");
      form.querySelector('[name="lastName"]')?.focus();
      return;
    }
    if (!email || !isPlausibleEmail(email)) {
      setStatus("Please enter a valid email (for your ticket).");
      form.querySelector('[name="email"]')?.focus();
      return;
    }
    const phone = normalizeUsPhone(phoneRaw);
    if (!phone) {
      setStatus("Please enter a valid US phone number (for Venmo).");
      form.querySelector('[name="phone"]')?.focus();
      return;
    }

    const rsvpRef = doc(db, "rsvp_submissions", user.uid);
    const splashRef = doc(db, "stats", "splash_game");

    setStatus("Saving…");
    try {
      const priorSnap = await getDoc(rsvpRef);
      const isFirstRsvp = !priorSnap.exists();

      const now = Timestamp.now();
      const submittedAt = priorSnap.exists()
        ? priorSnap.data().submittedAt
        : now;

      const payload = {
        ownerUid: user.uid,
        firstName,
        lastName,
        email,
        phone,
        submittedAt,
        updatedAt: now,
      };

      const batch = writeBatch(db);
      batch.set(rsvpRef, payload);

      if (isFirstRsvp) {
        const splashSnap = await getDoc(splashRef);
        if (!splashSnap.exists()) {
          batch.set(splashRef, { count: 1 });
        } else {
          const c = Number(splashSnap.data().count || 0);
          batch.update(splashRef, { count: c + 1 });
        }
      }

      await batch.commit();
      setStatus("Saved — thanks! You can edit anytime while signed in.");
    } catch (err) {
      console.error(err);
      const code = err && err.code ? err.code : "";
      const hint =
        code === "permission-denied"
          ? " (Blocked by Firestore rules — deploy latest rules or ask the host.)"
          : "";
      setStatus("Could not save right now. Check your connection and try again." + hint);
    }
  });
}

syncSplashGameBanner();
