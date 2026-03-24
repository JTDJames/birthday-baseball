import { db } from "./firebase-init.js";
import {
  Timestamp,
  collection,
  doc,
  increment,
  onSnapshot,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const SPLASH_DOC = doc(db, "stats", "splash");

(function () {
  const form = document.getElementById("interestForm");
  const statusEl = document.getElementById("interestStatus");
  const hintEl = document.getElementById("interestHint");
  const splashCountEl = document.getElementById("splashCount");

  if (!form) return;

  if (splashCountEl) {
    onSnapshot(
      SPLASH_DOC,
      function (snap) {
        const n = snap.exists ? snap.data().count : 0;
        splashCountEl.textContent = String(typeof n === "number" ? n : 0);
      },
      function () {
        splashCountEl.textContent = "—";
      }
    );
  }

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

  function buildMessage(name, phone) {
    return (
      "I'm interested in JJ Birthday Baseball Day (May 9, 2026).\n\n" +
      "Full name: " +
      name +
      "\n" +
      "Phone: " +
      phone
    );
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  function updateHint() {
    const hostAddressed = (form.getAttribute("data-rsvp-email") || "").trim();
    if (hintEl) {
      if (hostAddressed) {
        hintEl.textContent =
          "Submit saves your info for the host, then opens your email app so you can send a message too.";
      } else {
        hintEl.textContent =
          "Submit saves your name and phone securely so the host can follow up.";
      }
    }
  }

  updateHint();

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    setStatus("");

    const nameInput = form.querySelector('[name="name"]');
    const phoneInput = form.querySelector('[name="phone"]');
    const name = (nameInput && nameInput.value.trim()) || "";
    const phoneRaw = (phoneInput && phoneInput.value.trim()) || "";

    if (!name) {
      setStatus("Please enter your full name.");
      if (nameInput) nameInput.focus();
      return;
    }

    const normalizedPhone = normalizeUsPhone(phoneRaw);
    if (!normalizedPhone) {
      setStatus("Please enter a valid US phone number.");
      if (phoneInput) phoneInput.focus();
      return;
    }

    const body = buildMessage(name, normalizedPhone);
    const hostEmail = (form.getAttribute("data-rsvp-email") || "").trim();

    setStatus("Saving…");

    try {
      const batch = writeBatch(db);
      const submissionRef = doc(collection(db, "interest_submissions"));
      batch.set(submissionRef, {
        fullName: name,
        phone: normalizedPhone,
        submittedAt: Timestamp.now(),
      });
      batch.set(SPLASH_DOC, { count: increment(1) }, { merge: true });
      await batch.commit();
    } catch (err) {
      console.error(err);
      const code = err && err.code ? err.code : "";
      const hint =
        code === "permission-denied"
          ? " (Save was blocked—ask the host to update Firestore rules and publish them.)"
          : "";
      setStatus(
        "Could not save right now. Check your connection or try again." +
          hint +
          " You can still copy your details below."
      );
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(body).catch(function () {});
      }
      return;
    }

    if (hostEmail) {
      const subject = encodeURIComponent(
        "Interested — JJ Birthday Baseball Day"
      );
      const mailto =
        "mailto:" +
        encodeURIComponent(hostEmail) +
        "?subject=" +
        subject +
        "&body=" +
        encodeURIComponent(body);
      window.location.href = mailto;
      setStatus(
        "Got it — we saved your info. If your mail app opened, send the message to finish. Thanks!"
      );
      form.reset();
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(body);
        setStatus(
          "Thanks — your info is saved for the host. We also copied a note to your clipboard if you want to text them."
        );
      } catch {
        setStatus(
          "Thanks — your info is saved for the host."
        );
      }
    } else {
      setStatus("Thanks — your info is saved for the host.");
    }
    form.reset();
  });
})();
