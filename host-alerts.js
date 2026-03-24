import { db } from "./firebase-init.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const countEl = document.getElementById("countValue");
const lastUpdateEl = document.getElementById("lastUpdate");
const statusEl = document.getElementById("status");
const feedEl = document.getElementById("eventFeed");

const enableNotificationsBtn = document.getElementById("enableNotifications");
const testAlertBtn = document.getElementById("testAlert");
const resetBaselineBtn = document.getElementById("resetBaseline");

const SPLASH_REF = doc(db, "stats", "splash");
const BASELINE_KEY = "hostAlerts.lastSplashCount";

let initialized = false;

function nowText() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function addFeedEvent(text) {
  if (!feedEl) return;
  const li = document.createElement("li");
  li.textContent = `[${nowText()}] ${text}`;
  feedEl.prepend(li);
  while (feedEl.children.length > 20) {
    feedEl.removeChild(feedEl.lastChild);
  }
}

function playBeep() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.value = 0.001;

  osc.connect(gain);
  gain.connect(ctx.destination);

  const t = ctx.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

  osc.start(t);
  osc.stop(t + 0.24);
}

function notifyIfAllowed(text) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  new Notification("New Splash Hit", { body: text });
}

function getBaseline() {
  const raw = localStorage.getItem(BASELINE_KEY);
  if (raw === null) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function setBaseline(n) {
  localStorage.setItem(BASELINE_KEY, String(n));
}

enableNotificationsBtn?.addEventListener("click", async function () {
  if (!("Notification" in window)) {
    setStatus("This browser does not support notifications.");
    return;
  }

  const result = await Notification.requestPermission();
  if (result === "granted") {
    setStatus("Browser notifications enabled.");
    addFeedEvent("Notifications enabled.");
  } else {
    setStatus("Notifications not enabled.");
  }
});

testAlertBtn?.addEventListener("click", function () {
  playBeep();
  notifyIfAllowed("Test notification from host alerts page.");
  addFeedEvent("Test alert triggered.");
});

resetBaselineBtn?.addEventListener("click", function () {
  localStorage.removeItem(BASELINE_KEY);
  initialized = false;
  setStatus("Baseline reset. Next update will set current count as baseline.");
  addFeedEvent("Baseline reset.");
});

onSnapshot(
  SPLASH_REF,
  function (snap) {
    const count = snap.exists() ? snap.data().count : 0;
    const safeCount = Number.isFinite(count) ? count : 0;
    const prior = getBaseline();

    if (countEl) countEl.textContent = String(safeCount);
    if (lastUpdateEl) lastUpdateEl.textContent = `Last update: ${nowText()}`;

    if (!initialized) {
      if (prior === null) {
        setBaseline(safeCount);
        addFeedEvent(`Baseline set at ${safeCount}.`);
      }
      initialized = true;
      setStatus("Connected. Watching for new submissions...");
      return;
    }

    const baseline = getBaseline();
    if (baseline === null) {
      setBaseline(safeCount);
      return;
    }

    if (safeCount > baseline) {
      const delta = safeCount - baseline;
      const message = `${delta} new submission${delta > 1 ? "s" : ""}. Total Splash Hits: ${safeCount}.`;
      playBeep();
      notifyIfAllowed(message);
      addFeedEvent(message);
      setStatus(`New activity: ${message}`);
      setBaseline(safeCount);
      return;
    }

    if (safeCount < baseline) {
      // Handle manual resets in Firestore data.
      setBaseline(safeCount);
      addFeedEvent(`Counter decreased/reset to ${safeCount}. Baseline updated.`);
    }
  },
  function (err) {
    console.error(err);
    setStatus("Could not connect to live updates.");
    addFeedEvent("Connection error while watching Splash Hits.");
  }
);
