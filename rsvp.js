import { db } from "./firebase-init.js";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  limit,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const form = document.getElementById("rsvpForm");
const statusEl = document.getElementById("rsvpStatus");
const splashGameEl = document.getElementById("splashGameCount");
const openGuestListBtn = document.getElementById("openGuestListBtn");
const guestListModal = document.getElementById("guestListModal");
const guestListCloseBtn = document.getElementById("guestListCloseBtn");
const guestGateCheckBtn = document.getElementById("guestGateCheckBtn");
const guestGateEmail = document.getElementById("guestGateEmail");
const guestListStatus = document.getElementById("guestListStatus");
const guestListContent = document.getElementById("guestListContent");
const guestYesHeading = document.getElementById("guestYesHeading");
const guestMaybeHeading = document.getElementById("guestMaybeHeading");
const guestYesList = document.getElementById("guestYesList");
const guestMaybeList = document.getElementById("guestMaybeList");

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

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
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
    const responseStatus = (
      (form.querySelector('[name="responseStatus"]') || {}).value || "yes"
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
    if (!["yes", "maybe", "no"].includes(responseStatus)) {
      setStatus("Please choose yes, maybe, or no for the game RSVP.");
      return;
    }

    const submissionRef = doc(collection(db, "rsvp_submissions"));
    const guestRef = doc(collection(db, "rsvp_guest_list"));
    const splashRef = doc(db, "stats", "splash_game");

    setStatus("Saving…");
    try {
      const now = Timestamp.now();
      const viewerKeyHash = await sha256Hex(email);
      const lastInitial = (lastName[0] || "").toUpperCase();
      const payload = {
        firstName,
        lastName,
        email,
        phone,
        responseStatus,
        viewerKeyHash,
        submittedAt: now,
      };
      const guestPayload = {
        firstName,
        lastInitial,
        responseStatus,
        viewerKeyHash,
        submittedAt: now,
      };

      const batch = writeBatch(db);
      batch.set(submissionRef, payload);
      batch.set(guestRef, guestPayload);

      if (responseStatus === "yes" || responseStatus === "maybe") {
        const splashSnap = await getDoc(splashRef);
        if (!splashSnap.exists()) {
          batch.set(splashRef, { count: 1 });
        } else {
          const c = Number(splashSnap.data().count || 0);
          batch.update(splashRef, { count: c + 1 });
        }
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

function openGuestModal() {
  if (!guestListModal) return;
  guestListModal.classList.add("open");
  guestListModal.setAttribute("aria-hidden", "false");
  if (guestListStatus) guestListStatus.textContent = "";
  if (guestListContent) guestListContent.hidden = true;
  if (guestGateEmail) guestGateEmail.focus();
}

function closeGuestModal() {
  if (!guestListModal) return;
  guestListModal.classList.remove("open");
  guestListModal.setAttribute("aria-hidden", "true");
}

function renderNameList(el, names) {
  if (!el) return;
  if (!names.length) {
    el.innerHTML = "<li>No guests yet.</li>";
    return;
  }
  el.innerHTML = names.map((n) => `<li>${n}</li>`).join("");
}

async function loadGuestList() {
  if (!guestGateEmail || !guestListStatus) return;
  const email = normalizeEmail(guestGateEmail.value || "");
  if (!isPlausibleEmail(email)) {
    guestListStatus.textContent = "Enter the same RSVP email you used.";
    return;
  }
  guestListStatus.textContent = "Checking RSVP…";
  if (guestListContent) guestListContent.hidden = true;

  try {
    const viewerKeyHash = await sha256Hex(email);
    const gateQ = query(
      collection(db, "rsvp_guest_list"),
      where("viewerKeyHash", "==", viewerKeyHash),
      limit(1)
    );
    const gateSnap = await getDocs(gateQ);
    if (gateSnap.empty) {
      guestListStatus.textContent = "RSVP first to view the list.";
      return;
    }

    const [yesSnap, maybeSnap] = await Promise.all([
      getDocs(query(collection(db, "rsvp_guest_list"), where("responseStatus", "==", "yes"))),
      getDocs(query(collection(db, "rsvp_guest_list"), where("responseStatus", "==", "maybe"))),
    ]);

    const yesNames = yesSnap.docs
      .map((d) => d.data())
      .map((d) => `${String(d.firstName || "").trim()} ${String(d.lastInitial || "").trim()}.`.trim())
      .filter((s) => s.length > 2)
      .sort((a, b) => a.localeCompare(b));
    const maybeNames = maybeSnap.docs
      .map((d) => d.data())
      .map((d) => `${String(d.firstName || "").trim()} ${String(d.lastInitial || "").trim()}.`.trim())
      .filter((s) => s.length > 2)
      .sort((a, b) => a.localeCompare(b));

    if (guestYesHeading) guestYesHeading.textContent = `Yes (${yesNames.length})`;
    if (guestMaybeHeading) guestMaybeHeading.textContent = `Maybe (${maybeNames.length})`;
    renderNameList(guestYesList, yesNames);
    renderNameList(guestMaybeList, maybeNames);
    guestListStatus.textContent = "Showing RSVP guest list.";
    if (guestListContent) guestListContent.hidden = false;
  } catch (err) {
    console.error(err);
    guestListStatus.textContent = "Could not load guest list right now.";
  }
}

openGuestListBtn?.addEventListener("click", openGuestModal);
guestListCloseBtn?.addEventListener("click", closeGuestModal);
guestGateCheckBtn?.addEventListener("click", loadGuestList);
guestGateEmail?.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    loadGuestList();
  }
});
guestListModal?.addEventListener("click", function (e) {
  if (e.target === guestListModal) closeGuestModal();
});

syncSplashGameBanner();
