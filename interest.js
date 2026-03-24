import { db } from "./firebase-init.js";
import {
  addDoc,
  collection,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

(function () {
  const form = document.getElementById("interestForm");
  const statusEl = document.getElementById("interestStatus");
  const hintEl = document.getElementById("interestHint");

  if (!form) return;

  function digitsOnly(s) {
    return String(s).replace(/\D/g, "");
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

    const digits = digitsOnly(phoneRaw);
    if (digits.length < 10) {
      setStatus("Please enter a valid phone number (at least 10 digits).");
      if (phoneInput) phoneInput.focus();
      return;
    }

    const body = buildMessage(name, phoneRaw);
    const hostEmail = (form.getAttribute("data-rsvp-email") || "").trim();

    setStatus("Saving…");

    try {
      await addDoc(collection(db, "interest_submissions"), {
        fullName: name,
        phone: phoneRaw,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error(err);
      setStatus(
        "Could not save right now. Check your connection or try again. You can still copy your details below."
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
