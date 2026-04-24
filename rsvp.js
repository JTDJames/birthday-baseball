import { db } from "./firebase-init.js";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  onSnapshot,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const form = document.getElementById("rsvpForm");
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

if (form) {
  form.addEventListener("submit", async function (e) {
    e.preventDefault();

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

    const submissionRef = doc(collection(db, "rsvp_submissions"));
    const splashRef = doc(db, "stats", "splash_game");

    setStatus("Saving…");
    try {
      const now = Timestamp.now();
      const payload = {
        firstName,
        lastName,
        email,
        phone,
        submittedAt: now,
      };

      const batch = writeBatch(db);
      batch.set(submissionRef, payload);

      const splashSnap = await getDoc(splashRef);
      if (!splashSnap.exists()) {
        batch.set(splashRef, { count: 1 });
      } else {
        const c = Number(splashSnap.data().count || 0);
        batch.update(splashRef, { count: c + 1 });
      }

      await batch.commit();
      setStatus("Thanks — your game RSVP is saved. JJ will follow up about tickets.");
      form.reset();
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
