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
      "I'm interested in Birthday Baseball Day (May 9, 2026).\n\n" +
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
          "Submit opens your email app with a message to the host. Nothing is stored on this site.";
      } else {
        hintEl.textContent =
          "Submit copies your details so you can paste them into a text or message—nothing is stored on this site.";
      }
    }
  }

  updateHint();

  form.addEventListener("submit", function (e) {
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

    if (hostEmail) {
      const subject = encodeURIComponent(
        "Interested — Birthday Baseball Day"
      );
      const mailto =
        "mailto:" +
        encodeURIComponent(hostEmail) +
        "?subject=" +
        subject +
        "&body=" +
        encodeURIComponent(body);
      window.location.href = mailto;
      setStatus("If your mail app opened, send the message to finish. Thanks!");
      form.reset();
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(body).then(
        function () {
          setStatus(
            "Copied to clipboard! Paste into a text, note, or message to the host. Thanks!"
          );
          form.reset();
        },
        function () {
          setStatus(
            "Could not copy automatically. Your details: " +
              name +
              " / " +
              phoneRaw
          );
        }
      );
    } else {
      setStatus(
        "Copy this: " + name + " — " + phoneRaw
      );
    }
  });
})();
