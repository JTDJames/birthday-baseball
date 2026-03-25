(function () {
  /** Compact table — more open playfield (pinball-sized). */
  const BOARD_WIDTH = 320;
  const BOARD_HEIGHT = 480;
  const PITCH_INTERVAL_MS = 4600;
  const PITCH_WARNING_MS = 700;
  const INNING_BREAK_MS = 1400;
  const MAX_ACTIVE_BALLS = 1;
  const MAX_INNINGS = 3;
  const MAX_EXTRA_INNINGS = 2;
  const PITCH_ORIGIN_X = BOARD_WIDTH / 2;
  const PITCH_ORIGIN_Y = 158;
  /** Full circular pitcher’s mound (world units). */
  const MOUND_RADIUS = 14;
  /** Launch hole centered on mound. */
  const PITCH_HOLE_OFFSET_Y = 0;
  /** Visual radius of the metal hole bezel (ball is larger; reads as popping out). */
  const PITCH_HOLE_VISUAL_R = 4;
  /**
   * Baseball diamond metaphor (from home / mound):
   * 2B left (shortstop), 1B right (first), 3B up the middle (behind 2nd),
   * HR deepest center — behind 3B toward the fence.
   */
  const FIELD_LAYOUT = {
    double: { x: PITCH_ORIGIN_X - 100, y: 138, r: 12, label: "2B", type: "double" },
    single: { x: PITCH_ORIGIN_X + 100, y: 138, r: 12, label: "1B", type: "single" },
    triple: { x: PITCH_ORIGIN_X, y: 114, r: 10, label: "3B", type: "triple" },
    homerun: { x: PITCH_ORIGIN_X, y: 56, r: 8, label: "HR", type: "homerun" },
    homerunLeft: { x: 42, y: 50, r: 8, label: "HR", type: "homerun" },
    homerunRight: { x: BOARD_WIDTH - 42, y: 50, r: 8, label: "HR", type: "homerun" },
  };
  /**
   * Circular pop bumpers. Lower side pair must sit far enough from vertical walls
   * (wall inner faces ~x=10 and ~x=310) that gap > ball diameter — otherwise the ball
   * wedges between wall and bumper arc.
   */
  const SIDE_POP_X_INSET = 36;
  const POP_BUMPER_LAYOUT = [
    { x: PITCH_ORIGIN_X - 58, y: 82, r: 10 },
    { x: PITCH_ORIGIN_X + 58, y: 82, r: 10 },
    { x: SIDE_POP_X_INSET, y: 236, r: 10 },
    { x: BOARD_WIDTH - SIDE_POP_X_INSET, y: 236, r: 10 },
  ];
  const BALL_RADIUS = 7;
  /** Bottom edge of top wall body (center y=22, height 44) — ball must stay below this + radius. */
  const TOP_WALL_BOTTOM = 44;
  const BAT_LENGTH = 100;
  const BAT_THICKNESS = 14;
  /** Distance from flipper pivot (left hinge) to body center along the bat — true pinball-style. */
  const BAT_PIVOT_TO_CENTER = BAT_LENGTH / 2;
  /** Side outlanes (x < this or x > width - this) when ball sinks. */
  const SIDE_GUTTER_X = 30;
  /** Center drain between slings (narrow band at bottom). */
  const CENTER_DRAIN_HALF_W = 20;
  const BAT_REST_ANGLE = 0.22;
  const BAT_MIN_ANGLE = BAT_REST_ANGLE - 0.72;
  const BAT_MAX_ANGLE = BAT_REST_ANGLE + 0.06;
  const DIFFICULTY_MODES = [
    { name: "Easy", speedScale: 0.9, timingScale: 1.2 },
    { name: "Classic", speedScale: 1, timingScale: 1 },
    { name: "Hard", speedScale: 1.12, timingScale: 0.88 },
  ];

  const GiantsTheme = {
    orange: "#FD5A1E",
    black: "#111111",
    cream: "#F7F3E8",
    grass: "#2d5a27",
    dirt: "#c2b280",
  };

  const { Engine, Render, Runner, World, Bodies, Body, Events, Sleeping } = Matter;

  const LEADERBOARD_KEY = "bbPinballLeaderboardV1";
  const LEGACY_HIGH_KEY = "bbPinballHighScore";
  const LEADERBOARD_MAX = 10;

  const playBallBtn = document.getElementById("playBallBtn");
  const closeGameBtn = document.getElementById("closeGame");
  const gameModal = document.getElementById("gameModal");
  const gameContainer = document.getElementById("gameContainer");
  const leaderboardBtn = document.getElementById("leaderboardBtn");
  const leaderboardModal = document.getElementById("leaderboardModal");
  const leaderboardList = document.getElementById("leaderboardList");
  const leaderboardEmpty = document.getElementById("leaderboardEmpty");
  const leaderboardClose = document.getElementById("leaderboardClose");
  const highScoreEntry = document.getElementById("highScoreEntry");
  const hsScoreLine = document.getElementById("hsScoreLine");
  const hsInitials = document.getElementById("hsInitials");
  const hsSave = document.getElementById("hsSave");
  const hsSkip = document.getElementById("hsSkip");

  /**
   * Dev visibility toggle:
   * - localhost always shows the mini-game
   * - ?devgame=1 forces show on any host
   * - ?devgame=0 forces hide on any host
   */
  const devGameParam = new URLSearchParams(window.location.search).get("devgame");
  const isLocalHost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const shouldShowMiniGame =
    devGameParam === "1" || (devGameParam !== "0" && isLocalHost);
  if (shouldShowMiniGame) {
    document.body.classList.remove("mini-game-hidden");
  }

  if (!playBallBtn || !closeGameBtn || !gameModal || !gameContainer) {
    return;
  }

  let engine = null;
  let render = null;
  let runner = null;
  let pitchTimer = null;
  let pendingPitchTimeout = null;
  let inningBreakTimeout = null;
  let gameStarted = false;
  let gameEnded = false;
  let isPaused = false;
  let canSwing = true;
  let isSwinging = false;
  /** Flipper held while click/touch or Space is active (tracked separately so global pointerup doesn’t cancel Space). */
  let swingHoldPointer = false;
  let swingHoldSpace = false;
  let batTargetAngle = BAT_REST_ANGLE;
  /** Measured flipper angular speed in rad/s (from frame-to-frame angle delta). */
  let batAngularSpeed = 0;
  let pitchesThisInning = 0;
  let inningsLimit = MAX_INNINGS;
  let extraInningsAwarded = 0;
  let audioContext = null;
  let pitchCueEndsAt = 0;
  let lastWindupMs = PITCH_WARNING_MS;
  let isInningBreak = false;
  let highScore = 0;
  let specialLit = false;
  let reducedMotion = false;
  let difficultyIndex = 1;
  let initialsOpen = false;

  function getLeaderboard() {
    try {
      const raw = window.localStorage.getItem(LEADERBOARD_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function setLeaderboard(entries) {
    window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries));
  }

  function syncHighFromStorage() {
    const board = getLeaderboard();
    const bestBoard = board.length ? Math.max(...board.map((e) => e.score || 0)) : 0;
    const legacy = Number(window.localStorage.getItem(LEGACY_HIGH_KEY) || "0");
    highScore = Math.max(bestBoard, legacy);
  }

  function normalizeInitials(str) {
    const letters = (str || "").toUpperCase().replace(/[^A-Z]/g, "");
    return (letters + "???").slice(0, 3);
  }

  async function saveLeaderboardEntry(initials, score) {
    const clean = normalizeInitials(initials);
    const entry = {
      initials: clean,
      score: Math.max(0, Math.floor(score)),
      at: Date.now(),
    };
    const next = [...getLeaderboard(), entry].sort((a, b) => b.score - a.score).slice(0, LEADERBOARD_MAX);
    setLeaderboard(next);
    if (entry.score > highScore) {
      highScore = entry.score;
      window.localStorage.setItem(LEGACY_HIGH_KEY, String(highScore));
    }
    syncHighFromStorage();
    populateLeaderboardList();

    const api = window.bbPinballLeaderboard;
    if (api) {
      try {
        await api.submit({ initials: entry.initials, score: entry.score });
        const remote = await api.fetchTop(LEADERBOARD_MAX);
        if (remote.length > 0) {
          setLeaderboard(remote);
          syncHighFromStorage();
          populateLeaderboardList();
        }
      } catch (e) {
        console.warn("Pinball leaderboard save (cloud):", e);
      }
    }
    if (overlay) updateOverlay(feedbackText);
  }

  async function initLeaderboardFromCloud() {
    syncHighFromStorage();
    populateLeaderboardList();
    const api = window.bbPinballLeaderboard;
    if (!api) return;
    try {
      const remote = await api.fetchTop(LEADERBOARD_MAX);
      if (remote.length > 0) {
        setLeaderboard(remote);
        syncHighFromStorage();
        populateLeaderboardList();
      }
    } catch (e) {
      console.warn("Pinball leaderboard load (cloud):", e);
    }
  }

  function populateLeaderboardList() {
    if (!leaderboardList || !leaderboardEmpty) return;
    const rows = getLeaderboard().slice(0, LEADERBOARD_MAX);
    leaderboardList.innerHTML = "";
    if (rows.length === 0) {
      leaderboardEmpty.style.display = "block";
      return;
    }
    leaderboardEmpty.style.display = "none";
    rows.forEach((row, i) => {
      const li = document.createElement("li");
      const dateStr =
        row.at != null
          ? new Date(row.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
          : "";
      li.textContent = `${i + 1}. ${row.initials || "???"} — ${row.score}${dateStr ? `  (${dateStr})` : ""}`;
      leaderboardList.appendChild(li);
    });
  }

  function openLeaderboardModal() {
    if (!leaderboardModal) return;
    populateLeaderboardList();
    leaderboardModal.style.display = "flex";
  }

  function closeLeaderboardModal() {
    if (!leaderboardModal) return;
    leaderboardModal.style.display = "none";
  }

  function showInitialsPanel(finalScore, perfects) {
    if (!highScoreEntry || !hsScoreLine) return;
    initialsOpen = true;
    if (hsInitials) {
      hsInitials.value = "";
      hsInitials.maxLength = 3;
    }
    hsScoreLine.textContent = `Final score: ${finalScore}  ·  Perfects: ${perfects}`;
    highScoreEntry.style.display = "flex";
    window.setTimeout(() => hsInitials && hsInitials.focus(), 80);
  }

  function hideInitialsPanel() {
    if (!highScoreEntry) return;
    initialsOpen = false;
    highScoreEntry.style.display = "none";
    if (hsInitials) hsInitials.value = "";
  }

  // Gameplay tuning checklist (append new bullets as the game evolves):
  // 1) Flipper travel stays constrained and returns cleanly to rest.
  // 2) Pitch cadence allows reaction time and avoids ball spam.
  // 3) Target order is intuitive: Single -> Double -> Triple -> Home Run.
  // 4) Classic pinball readability: clear cues, readable labels, strong contrast.
  // 5) Giants theme consistency: orange/black/cream with park-inspired field colors.
  // 6) Add pinball reward moments (skill shots, streak bonuses) for replay value.
  // 7) Keep timing help visible on-playfield, not only in top HUD text.
  // 8) Add machine-like audio callouts/chimes for outcomes and anticipation.
  // 9) Preserve classic baseball-pinball progression (earned extra innings).
  // 10) Keep controls flexible: pause, difficulty tuning, reduced motion.
  // 11) Use "special when lit" style rewards for classic pinball drama.
  // 12) Layer infield/mound UNDER bodies (destination-over), not on top, so the ball stays visible.
  // 13) Scoring uses hole sensors + gutters (side outlanes + center drain) + slingshot bumpers.
  // 14) Field holes follow diamond logic (2B L / 1B R / 3B up / HR deep center); DMD-style HUD + top fascia.

  const gameState = {
    score: 0,
    inning: 1,
    outs: 0,
    bases: [0, 0, 0], // [1st, 2nd, 3rd]
    hitStreak: 0,
    perfectHits: 0,
  };

  let overlay = null;
  /** Bump when field art changes so the bitmap rebuilds (no stale brown fan, etc.). */
  const INF_FIELD_CACHE_VERSION = 6;
  /** Pre-rendered mound + hole; blitted under the ball. */
  let infieldLayerCache = null;
  let bat = null;
  let batAnchor = null;
  let activeBalls = new Set();
  let targetSensors = [];
  let slingBumperBodies = [];
  let popBumperBodies = [];
  let moundCueVisible = false;
  let moundCueText = "";
  let swingCueVisible = false;
  let feedbackText = "";
  let feedbackUntil = 0;
  let homerunBurstUntil = 0;
  let pendingFinalScore = 0;
  let pendingPerfects = 0;

  function createOverlay() {
    overlay = document.createElement("div");
    overlay.style.width = BOARD_WIDTH + "px";
    overlay.style.margin = "0 auto 6px";
    overlay.style.padding = "8px 10px";
    overlay.style.boxSizing = "border-box";
    overlay.style.background = "linear-gradient(180deg, #1e1e1e 0%, #0c0c0c 100%)";
    overlay.style.border = "3px solid #fd5a1e";
    overlay.style.borderRadius = "4px";
    overlay.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.06), 0 3px 10px rgba(0,0,0,0.45)";
    overlay.style.fontFamily = '"Consolas","Courier New",monospace';
    overlay.style.fontSize = "11px";
    overlay.style.textAlign = "left";
    overlay.style.lineHeight = "1.45";
    overlay.style.letterSpacing = "0.06em";
    overlay.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;color:#8a8a8a;">
        <span>SCORE <strong id="dmd-score" style="color:#ffb347;font-size:13px;">0</strong></span>
        <span>HIGH <strong id="dmd-best" style="color:#cc7722;">0</strong></span>
        <span>INN <strong id="dmd-inn-pair" style="color:#ffb347;">1/3</strong></span>
        <span>OUT <strong id="dmd-outs" style="color:#ffb347;">0</strong></span>
      </div>
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #2a2a2a;color:#8a8a8a;">
        BASES <strong id="dmd-bases" style="color:#ffb347;letter-spacing:0.12em;">0 0 0</strong>
        <span id="dmd-msg" style="margin-left:8px;color:#e8e0d0;font-weight:600;max-width:280px;display:inline-block;vertical-align:top;"></span>
      </div>`;
    gameContainer.innerHTML = "";
    gameContainer.appendChild(overlay);
    updateOverlay("TAP TO SWING");
  }

  function updateOverlay(message) {
    if (!overlay) return;
    const $ = (id) => overlay.querySelector("#" + id);
    const s = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };
    s("dmd-score", String(gameState.score));
    s("dmd-best", String(highScore));
    s("dmd-inn-pair", `${gameState.inning}/${inningsLimit}`);
    s("dmd-outs", String(gameState.outs));
    s("dmd-bases", gameState.bases.join(" "));
    s("dmd-msg", message || "");
  }

  function setPaused(shouldPause) {
    if (!runner || !engine) return;
    if (shouldPause) {
      isPaused = true;
      Runner.stop(runner);
      resetSwingHold();
      updateOverlay("Paused. Press P to resume.");
      return;
    }
    isPaused = false;
    Runner.run(runner, engine);
    updateOverlay(`Resumed. Difficulty: ${DIFFICULTY_MODES[difficultyIndex].name}`);
  }

  function setFeedback(message, durationMs) {
    feedbackText = message;
    feedbackUntil = Date.now() + durationMs;
  }

  function ensureAudioContext() {
    if (!window.AudioContext && !window.webkitAudioContext) return null;
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }

  function playTone(frequency, durationMs, type, volume) {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    gain.gain.setValueAtTime(volume || 0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000);
  }

  function playSfx(eventName) {
    if (eventName === "windup") {
      playTone(440, 80, "triangle", 0.03);
      window.setTimeout(() => playTone(523, 70, "triangle", 0.03), 95);
      return;
    }
    if (eventName === "single") return playTone(620, 120, "square", 0.04);
    if (eventName === "double") {
      playTone(620, 90, "square", 0.04);
      window.setTimeout(() => playTone(740, 100, "square", 0.04), 110);
      return;
    }
    if (eventName === "triple") {
      playTone(660, 80, "square", 0.04);
      window.setTimeout(() => playTone(784, 80, "square", 0.04), 90);
      window.setTimeout(() => playTone(932, 120, "square", 0.04), 180);
      return;
    }
    if (eventName === "homerun") {
      playTone(660, 90, "sawtooth", 0.05);
      window.setTimeout(() => playTone(784, 90, "sawtooth", 0.05), 110);
      window.setTimeout(() => playTone(988, 130, "sawtooth", 0.05), 220);
      window.setTimeout(() => playTone(1175, 170, "sawtooth", 0.05), 360);
      return;
    }
    if (eventName === "out") return playTone(220, 220, "triangle", 0.05);
    if (eventName === "bumper") {
      playTone(880, 45, "square", 0.035);
      window.setTimeout(() => playTone(740, 35, "square", 0.03), 40);
      return;
    }
    if (eventName === "perfect") {
      playTone(988, 80, "triangle", 0.045);
      window.setTimeout(() => playTone(1318, 120, "triangle", 0.045), 95);
    }
  }

  function setupWorld() {
    engine = Engine.create();
    engine.gravity.y = 0.95;
    engine.enableSleeping = false;
    engine.positionIterations = 12;
    engine.velocityIterations = 12;
    if (typeof engine.constraintIterations === "number") engine.constraintIterations = 8;

    render = Render.create({
      element: gameContainer,
      engine,
      options: {
        width: BOARD_WIDTH,
        height: BOARD_HEIGHT,
        wireframes: false,
        background: GiantsTheme.grass,
      },
    });

    runner = Runner.create();

    const wallOptions = {
      isStatic: true,
      render: { visible: false },
      friction: 0.2,
      restitution: 0.2,
    };

    const wallThin = 10;
    const leftWall = Bodies.rectangle(wallThin / 2, BOARD_HEIGHT / 2, wallThin, BOARD_HEIGHT, wallOptions);
    const rightWall = Bodies.rectangle(
      BOARD_WIDTH - wallThin / 2,
      BOARD_HEIGHT / 2,
      wallThin,
      BOARD_HEIGHT,
      wallOptions
    );
    const topWall = Bodies.rectangle(
      BOARD_WIDTH / 2,
      TOP_WALL_BOTTOM / 2,
      BOARD_WIDTH,
      TOP_WALL_BOTTOM,
      wallOptions
    );
    const floor = Bodies.rectangle(
      BOARD_WIDTH / 2,
      BOARD_HEIGHT + 8,
      BOARD_WIDTH,
      16,
      wallOptions
    );

    const batLength = BAT_LENGTH;
    const batThickness = BAT_THICKNESS;
    const batX = BOARD_WIDTH / 2 - 22;
    const batY = BOARD_HEIGHT - 58;

    /**
     * Fixed pivot at left hinge (world space). Body center orbits the pivot so the slope
     * is physical — ball rolls toward the tip (right) when not swung.
     */
    const pivotX = batX - Math.cos(BAT_REST_ANGLE) * BAT_PIVOT_TO_CENTER;
    const pivotY = batY - Math.sin(BAT_REST_ANGLE) * BAT_PIVOT_TO_CENTER;
    batAnchor = { x: pivotX, y: pivotY };

    /**
     * Kinematic flipper (static body, pivot-correct pose each frame): dynamic+constraint was unstable
     * (self-oscillation). Static keeps motion predictable while we tune further.
     */
    bat = Bodies.rectangle(batX, batY, batLength, batThickness, {
      isStatic: true,
      friction: 0.55,
      restitution: 0.14,
      render: { fillStyle: GiantsTheme.orange },
      chamfer: { radius: 6 },
    });
    Body.setAngle(bat, BAT_REST_ANGLE);
    batTargetAngle = BAT_REST_ANGLE;

    targetSensors = createTargets();

    /** Scalene slingshot triangles (base along gutter rail, long face into play) — classic lower-sling placement. */
    const slingCommon = {
      isStatic: true,
      friction: 0.06,
      restitution: 1.22,
      label: "bumper",
      render: { fillStyle: GiantsTheme.orange, strokeStyle: "#2a1000", lineWidth: 1.5 },
    };
    const slingY = batY - 24;
    const leftSlingVerts = [
      { x: 0, y: 0 },
      { x: 0, y: 66 },
      { x: 56, y: 12 },
    ];
    const rightSlingVerts = [
      { x: 0, y: 0 },
      { x: 0, y: 66 },
      { x: -56, y: 12 },
    ];
    let leftBumper;
    let rightBumper;
    try {
      if (typeof Bodies.fromVertices !== "function") throw new Error("fromVertices missing");
      leftBumper = Bodies.fromVertices(
        SIDE_GUTTER_X + 28,
        slingY,
        [leftSlingVerts],
        slingCommon
      );
      rightBumper = Bodies.fromVertices(
        BOARD_WIDTH - SIDE_GUTTER_X - 28,
        slingY,
        [rightSlingVerts],
        slingCommon
      );
      leftBumper.plugin = {
        ...(leftBumper.plugin || {}),
        bumperKind: "sling",
        visualRadius: 0,
        lastHitAt: 0,
      };
      rightBumper.plugin = {
        ...(rightBumper.plugin || {}),
        bumperKind: "sling",
        visualRadius: 0,
        lastHitAt: 0,
      };
    } catch (err) {
      leftBumper = Bodies.polygon(SIDE_GUTTER_X + 34, slingY, 3, 26, slingCommon);
      Body.setAngle(leftBumper, Math.PI / 2 + 0.32);
      rightBumper = Bodies.polygon(BOARD_WIDTH - SIDE_GUTTER_X - 34, slingY, 3, 26, slingCommon);
      Body.setAngle(rightBumper, Math.PI / 2 - 0.32);
      leftBumper.plugin = {
        ...(leftBumper.plugin || {}),
        bumperKind: "sling",
        visualRadius: 0,
        lastHitAt: 0,
      };
      rightBumper.plugin = {
        ...(rightBumper.plugin || {}),
        bumperKind: "sling",
        visualRadius: 0,
        lastHitAt: 0,
      };
    }
    slingBumperBodies = [leftBumper, rightBumper];
    const popBumpers = POP_BUMPER_LAYOUT.map((slot) => {
      const body = Bodies.circle(slot.x, slot.y, slot.r, {
        isStatic: true,
        friction: 0.04,
        restitution: 1.42,
        label: "bumper",
        render: { fillStyle: GiantsTheme.orange, strokeStyle: "#2a1000", lineWidth: 1.5 },
      });
      body.plugin = { ...(body.plugin || {}), bumperKind: "pop", visualRadius: slot.r, lastHitAt: 0 };
      return body;
    });
    popBumperBodies = popBumpers;
    const bx = BOARD_WIDTH / 2;

    const drainGuideOpts = {
      isStatic: true,
      render: { visible: false },
      friction: 0.2,
      restitution: 0.15,
    };
    const leftDrainGuide = Bodies.rectangle(
      bx - 34,
      BOARD_HEIGHT - 36,
      10,
      64,
      { ...drainGuideOpts, angle: 0.38 }
    );
    const rightDrainGuide = Bodies.rectangle(
      bx + 34,
      BOARD_HEIGHT - 36,
      10,
      64,
      { ...drainGuideOpts, angle: -0.38 }
    );

    World.add(engine.world, [
      leftWall,
      rightWall,
      topWall,
      floor,
      leftDrainGuide,
      rightDrainGuide,
      leftBumper,
      rightBumper,
      ...popBumpers,
      bat,
      ...targetSensors.map((t) => t.body),
    ]);

    Events.on(engine, "collisionStart", onCollisionStart);
    Events.on(engine, "beforeUpdate", beforeUpdateWorld);
  }

  function createTargets() {
    const keys = ["double", "single", "triple", "homerun", "homerunLeft", "homerunRight"];
    return keys.map((key) => {
      const slot = FIELD_LAYOUT[key];
      const hole = Bodies.circle(slot.x, slot.y, slot.r, {
        isStatic: true,
        isSensor: true,
        label: `target:${slot.type}`,
        render: { visible: false },
      });
      return {
        label: slot.label,
        x: slot.x,
        y: slot.y,
        radius: slot.r,
        type: slot.type,
        body: hole,
      };
    });
  }

  function getPitchProfile() {
    const profiles = [
      { name: "Floater", xVel: 0.05, yVel: 1.35 },
      { name: "Changeup", xVel: 0.15, yVel: 1.85 },
      { name: "Two-Seam", xVel: 0.3, yVel: 2.35 },
      { name: "Heater", xVel: 0.5, yVel: 3.0 },
    ];
    const base = profiles[Math.floor(Math.random() * profiles.length)];
    const inningScale = 1 + (gameState.inning - 1) * 0.08;
    const difficulty = DIFFICULTY_MODES[difficultyIndex];
    return {
      ...base,
      xVel: base.xVel * inningScale * difficulty.speedScale,
      yVel: base.yVel * inningScale * difficulty.speedScale,
    };
  }

  function spawnBall(profile) {
    if (!engine) return;
    const holeY = PITCH_ORIGIN_Y + PITCH_HOLE_OFFSET_Y;
    const startX = PITCH_ORIGIN_X + (Math.random() - 0.5) * 4;
    const ball = Bodies.circle(startX, holeY, BALL_RADIUS, {
      label: "baseball",
      restitution: 0.38,
      friction: 0.1,
      frictionAir: 0.0015,
      density: 0.002,
      render: {
        fillStyle: "#FFFFFF",
        strokeStyle: GiantsTheme.black,
        lineWidth: 1.5,
      },
    });
    ball.plugin = {
      isSkillPitch: pitchesThisInning === 0,
    };

    activeBalls.add(ball.id);
    World.add(engine.world, ball);
    const driftDirection = Math.random() < 0.5 ? -1 : 1;
    Body.setVelocity(ball, {
      x: driftDirection * profile.xVel * (0.6 + Math.random() * 0.5),
      y: profile.yVel + Math.random() * 0.2,
    });
    pitchesThisInning += 1;
    updateOverlay(`${profile.name} delivered!`);
  }

  function queuePitch() {
    if (!gameStarted || gameEnded || !engine || isInningBreak || isPaused) return;
    if (pendingPitchTimeout || activeBalls.size >= MAX_ACTIVE_BALLS) return;

    const pitchProfile = getPitchProfile();
    moundCueVisible = true;
    moundCueText = "And the windup...";
    const warningMs = reducedMotion ? Math.round(PITCH_WARNING_MS * 0.5) : PITCH_WARNING_MS;
    lastWindupMs = warningMs;
    pitchCueEndsAt = Date.now() + warningMs;
    playSfx("windup");
    updateOverlay(
      `And the windup... ${pitchProfile.name} | ${DIFFICULTY_MODES[difficultyIndex].name}`
    );
    pendingPitchTimeout = window.setTimeout(() => {
      pendingPitchTimeout = null;
      moundCueVisible = false;
      pitchCueEndsAt = 0;
      spawnBall(pitchProfile);
    }, warningMs);
  }

  function syncSwingHoldState() {
    const held = swingHoldPointer || swingHoldSpace;
    if (held) {
      batTargetAngle = BAT_MIN_ANGLE;
      isSwinging = true;
      canSwing = false;
    } else {
      batTargetAngle = BAT_REST_ANGLE;
      isSwinging = false;
      canSwing = true;
    }
  }

  function addSwingHoldPointer() {
    if (!bat || gameModal.style.display === "none" || isPaused) return;
    if (swingHoldPointer) return;
    if (!canSwing) return;
    swingHoldPointer = true;
    syncSwingHoldState();
  }

  function releaseSwingHoldPointer() {
    if (!swingHoldPointer) return;
    swingHoldPointer = false;
    syncSwingHoldState();
  }

  function addSwingHoldSpace() {
    if (!bat || gameModal.style.display === "none" || isPaused) return;
    if (swingHoldSpace) return;
    if (!swingHoldPointer && !canSwing) return;
    swingHoldSpace = true;
    syncSwingHoldState();
  }

  function releaseSwingHoldSpace() {
    if (!swingHoldSpace) return;
    swingHoldSpace = false;
    syncSwingHoldState();
  }

  function resetSwingHold() {
    swingHoldPointer = false;
    swingHoldSpace = false;
    syncSwingHoldState();
  }

  function advanceRunners(basesEarned) {
    if (basesEarned === 4) {
      const runs = 1 + gameState.bases.reduce((a, b) => a + b, 0);
      gameState.score += runs;
      gameState.bases = [0, 0, 0];
      updateOverlay(`Home Run! ${runs} run${runs > 1 ? "s" : ""} scored.`);
      return;
    }

    const nextBases = [0, 0, 0];
    for (let i = 2; i >= 0; i -= 1) {
      if (gameState.bases[i]) {
        const next = i + basesEarned;
        if (next >= 3) {
          gameState.score += 1;
        } else {
          nextBases[next] = 1;
        }
      }
    }

    nextBases[basesEarned - 1] = 1;
    gameState.bases = nextBases;
  }

  function awardStreakBonus() {
    if (gameState.hitStreak > 0 && gameState.hitStreak % 3 === 0) {
      gameState.score += 1;
      updateOverlay(`Streak Bonus! ${gameState.hitStreak} hits in a row.`);
      return true;
    }
    return false;
  }

  function getContactBonus(ballBody) {
    if (!bat) return 0;
    const timingScale = DIFFICULTY_MODES[difficultyIndex].timingScale;
    const batTipX = bat.position.x + Math.cos(bat.angle) * BAT_PIVOT_TO_CENTER;
    const offset = Math.abs(ballBody.position.x - batTipX);
    if (offset <= 9 * timingScale) return 1;
    return 0;
  }

  function handleTargetHit(targetType, ballBody) {
    if (targetType === "single") {
      advanceRunners(1);
      gameState.hitStreak += 1;
      if (!specialLit && gameState.hitStreak >= 2) {
        specialLit = true;
        setFeedback("SPECIAL LIT", 1100);
      }
      playSfx("single");
      const gotBonus = awardStreakBonus();
      if (!gotBonus) updateOverlay(`Single! Streak ${gameState.hitStreak}`);
      return;
    }
    if (targetType === "double") {
      advanceRunners(2);
      gameState.hitStreak += 1;
      if (!specialLit && gameState.hitStreak >= 2) {
        specialLit = true;
        setFeedback("SPECIAL LIT", 1100);
      }
      playSfx("double");
      const gotBonus = awardStreakBonus();
      if (!gotBonus) updateOverlay(`Double! Streak ${gameState.hitStreak}`);
      return;
    }
    if (targetType === "triple") {
      advanceRunners(3);
      gameState.hitStreak += 1;
      if (!specialLit && gameState.hitStreak >= 2) {
        specialLit = true;
        setFeedback("SPECIAL LIT", 1100);
      }
      playSfx("triple");
      const gotBonus = awardStreakBonus();
      if (!gotBonus) updateOverlay(`Triple! Streak ${gameState.hitStreak}`);
      return;
    }
    if (targetType === "homerun") {
      advanceRunners(4);
      gameState.hitStreak += 1;
      playSfx("homerun");
      setFeedback("¡Adiós pelota!", 1200);
      homerunBurstUntil = Date.now() + 900;
      let message = `Home Run! Streak ${gameState.hitStreak}`;
      if (ballBody && ballBody.plugin && ballBody.plugin.isSkillPitch) {
        gameState.score += 1;
        message = "Super Home Run! Skill shot bonus run!";
        if (extraInningsAwarded < MAX_EXTRA_INNINGS) {
          inningsLimit += 1;
          extraInningsAwarded += 1;
          message = `Super Home Run! Extra inning awarded (${inningsLimit} total).`;
        }
      }
      if (specialLit) {
        gameState.score += 2;
        specialLit = false;
        message = `${message} | SPECIAL cash-in +2`;
      }
      const gotBonus = awardStreakBonus();
      if (!gotBonus) updateOverlay(message);
    }
  }

  function removeBall(ballBody) {
    if (!engine || !ballBody) return;
    activeBalls.delete(ballBody.id);
    World.remove(engine.world, ballBody);
  }

  function getBallAndTarget(bodyA, bodyB) {
    const aBall = bodyA.label === "baseball";
    const bBall = bodyB.label === "baseball";
    const aTarget = bodyA.label && bodyA.label.startsWith("target:");
    const bTarget = bodyB.label && bodyB.label.startsWith("target:");

    if (aBall && bTarget) return { ball: bodyA, target: bodyB };
    if (bBall && aTarget) return { ball: bodyB, target: bodyA };
    return null;
  }

  function boostHitBall(ballBody, swingSpeed = 0) {
    // Impulse scales with flipper speed so a held, stationary flipper does not "auto-hit".
    const speedFactor = Math.max(0, Math.min(1.8, (swingSpeed - 1.15) / 5.25));
    const upSpeed = 7.2 + speedFactor * 5.8 + Math.random() * 1.6;
    const sideSpeed = (Math.random() - 0.5) * (4.2 + speedFactor * 3.2);
    Body.setVelocity(ballBody, { x: sideSpeed, y: -upSpeed });
    Body.setAngularVelocity(ballBody, (Math.random() - 0.5) * 1.2);
  }

  /**
   * Anti-tunneling assist for fast flipper motion:
   * if a ball is close to the bat segment during a swing, force a contact response.
   */
  function enforceSwingContact() {
    if (!engine || !bat || !isSwinging) return;
    // Only assist tunneling while the flipper is actually moving quickly.
    if (batAngularSpeed < 1.15) return;
    const now = Date.now();
    const halfW = BAT_LENGTH / 2;
    const halfH = BAT_THICKNESS / 2;
    const cos = Math.cos(bat.angle);
    const sin = Math.sin(bat.angle);
    const ax = bat.position.x - cos * halfW;
    const ay = bat.position.y - sin * halfW;
    const bx = bat.position.x + cos * halfW;
    const by = bat.position.y + sin * halfW;
    const vx = bx - ax;
    const vy = by - ay;
    const segLenSq = vx * vx + vy * vy;
    if (segLenSq < 1e-6) return;
    const nx = -sin;
    const ny = cos;
    const contactPad = BALL_RADIUS + halfH + 2.2;

    engine.world.bodies.forEach((ball) => {
      if (ball.label !== "baseball") return;
      const lastAssist = ball.plugin && ball.plugin.lastBatAssistAt ? ball.plugin.lastBatAssistAt : 0;
      if (now - lastAssist < 95) return;

      const px = ball.position.x;
      const py = ball.position.y;
      const wx = px - ax;
      const wy = py - ay;
      let t = (wx * vx + wy * vy) / segLenSq;
      if (t < 0 || t > 1) return;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + vx * t;
      const qy = ay + vy * t;
      const dx = px - qx;
      const dy = py - qy;
      const distSq = dx * dx + dy * dy;
      if (distSq > contactPad * contactPad) return;

      const normalSign = (dx * nx + dy * ny) >= 0 ? 1 : -1;
      const push = contactPad + 0.6;
      Body.setPosition(ball, { x: qx + nx * push * normalSign, y: qy + ny * push * normalSign });

      if (!ball.plugin) ball.plugin = {};
      ball.plugin.lastBatAssistAt = now;
      boostHitBall(ball, batAngularSpeed);
    });
  }

  function onCollisionStart(event) {
    if (!engine) return;
    event.pairs.forEach((pair) => {
      const a = pair.bodyA;
      const b = pair.bodyB;
      if (
        (a.label === "bumper" && b.label === "baseball") ||
        (b.label === "bumper" && a.label === "baseball")
      ) {
        const ball = a.label === "baseball" ? a : b;
        const bumperBody = a.label === "bumper" ? a : b;
        const bumperKind = bumperBody.plugin && bumperBody.plugin.bumperKind ? bumperBody.plugin.bumperKind : "generic";
        if (bumperBody.plugin) bumperBody.plugin.lastHitAt = Date.now();
        const isPopBumper = bumperKind === "pop";
        const isSling = bumperKind === "sling";
        const bump = isPopBumper
          ? 3.9 + Math.random() * 1.9
          : isSling
            ? 3.15 + Math.random() * 1.6
            : 2.7 + Math.random() * 1.3;
        const vxScale = isPopBumper ? 1.26 : isSling ? 1.22 : 1.15;
        const vyScale = isPopBumper ? 1.24 : isSling ? 1.2 : 1.1;
        Body.setVelocity(ball, {
          x: ball.velocity.x * vxScale + (Math.random() - 0.5) * bump,
          y: ball.velocity.y * vyScale - Math.abs(ball.velocity.y) * 0.24 - 0.34,
        });
        playSfx("bumper");
      }

      const batAndBall =
        (pair.bodyA === bat && pair.bodyB.label === "baseball" && pair.bodyB) ||
        (pair.bodyB === bat && pair.bodyA.label === "baseball" && pair.bodyA);
      if (batAndBall && isSwinging && batAngularSpeed > 1.15) {
        const contactBonus = getContactBonus(batAndBall);
        if (contactBonus > 0) {
          gameState.score += contactBonus;
          gameState.perfectHits += 1;
          playSfx("perfect");
          updateOverlay("Contact! Bonus run awarded. Drive it to the targets!");
        } else {
          updateOverlay("Contact! Drive it to the targets!");
        }
        boostHitBall(batAndBall, batAngularSpeed);
      }

      const hit = getBallAndTarget(pair.bodyA, pair.bodyB);
      if (!hit) return;
      const targetType = hit.target.label.split(":")[1];
      handleTargetHit(targetType, hit.ball);
      removeBall(hit.ball);
    });
  }

  function cleanupMissedBalls() {
    if (!engine) return;
    const bodies = engine.world.bodies;
    bodies.forEach((body) => {
      if (body.label !== "baseball") return;
      if (body.position.y > BOARD_HEIGHT - 14) {
        removeBall(body);
        gameState.outs += 1;
        gameState.hitStreak = 0;
        specialLit = false;
        let gutterNote = "";
        if (Math.abs(body.position.x - BOARD_WIDTH / 2) < CENTER_DRAIN_HALF_W) {
          gutterNote = "Center drain!";
        }
        if (gameState.outs >= 3) {
          gameState.inning += 1;
          gameState.outs = 0;
          gameState.bases = [0, 0, 0];
          pitchesThisInning = 0;
          isInningBreak = true;
          specialLit = false;

          if (gameState.inning > inningsLimit) {
            gameEnded = true;
            if (pitchTimer) {
              window.clearInterval(pitchTimer);
              pitchTimer = null;
            }
            if (pendingPitchTimeout) {
              window.clearTimeout(pendingPitchTimeout);
              pendingPitchTimeout = null;
            }
            if (gameState.score > highScore) {
              highScore = gameState.score;
              window.localStorage.setItem(LEGACY_HIGH_KEY, String(highScore));
            }
            pendingFinalScore = gameState.score;
            pendingPerfects = gameState.perfectHits;
            updateOverlay("BALLGAME — Enter initials or SKIP");
            showInitialsPanel(pendingFinalScore, pendingPerfects);
          } else {
            updateOverlay(`Side retired. Inning ${gameState.inning} in a moment...`);
            if (inningBreakTimeout) window.clearTimeout(inningBreakTimeout);
            inningBreakTimeout = window.setTimeout(() => {
              isInningBreak = false;
              updateOverlay(`Inning ${gameState.inning} - play ball!`);
              queuePitch();
            }, INNING_BREAK_MS);
          }
        } else {
          playSfx("out");
          updateOverlay(gutterNote ? `${gutterNote} Out!` : "Out!");
        }
      }
    });
  }

  function constrainBatMotion() {
    if (!bat || !batAnchor) return;
    const prevAngle = bat.angle;

    const constrainedTarget = Math.min(BAT_MAX_ANGLE, Math.max(BAT_MIN_ANGLE, batTargetAngle));
    const ease = isSwinging ? 0.58 : 0.2;
    const nextAngle = bat.angle + (constrainedTarget - bat.angle) * ease;
    const clampedAngle = Math.min(BAT_MAX_ANGLE, Math.max(BAT_MIN_ANGLE, nextAngle));
    const cos = Math.cos(clampedAngle);
    const sin = Math.sin(clampedAngle);
    Body.setPosition(bat, {
      x: batAnchor.x + cos * BAT_PIVOT_TO_CENTER,
      y: batAnchor.y + sin * BAT_PIVOT_TO_CENTER,
    });
    Body.setAngle(bat, clampedAngle);

    let dAngle = clampedAngle - prevAngle;
    while (dAngle > Math.PI) dAngle -= Math.PI * 2;
    while (dAngle < -Math.PI) dAngle += Math.PI * 2;
    const dtMs = engine && engine.timing && engine.timing.lastDelta ? engine.timing.lastDelta : 16.666;
    batAngularSpeed = Math.abs(dAngle) / Math.max(0.001, dtMs / 1000);
  }

  /**
   * Matter’s friction on static surfaces often won’t start the ball rolling along a gentle slope.
   * Nudge along the bat toward the tip when the ball is settled on the flipper (not during a swing).
   */
  function applyBallSlideOnBat() {
    if (!engine || !bat || isSwinging) return;
    const halfW = BAT_LENGTH / 2;
    const halfH = BAT_THICKNESS / 2;
    const surfaceLocalY = -halfH - BALL_RADIUS;
    const tx = Math.cos(bat.angle);
    const ty = Math.sin(bat.angle);

    engine.world.bodies.forEach((ball) => {
      if (ball.label !== "baseball") return;
      if (Sleeping && Sleeping.set) Sleeping.set(ball, false);
      const dx = ball.position.x - bat.position.x;
      const dy = ball.position.y - bat.position.y;
      const localX = dx * Math.cos(bat.angle) + dy * Math.sin(bat.angle);
      const localY = -dx * Math.sin(bat.angle) + dy * Math.cos(bat.angle);
      if (localX < -halfW - BALL_RADIUS - 3 || localX > halfW + BALL_RADIUS + 3) return;
      if (localY < surfaceLocalY - 5 || localY > surfaceLocalY + 12) return;
      const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
      if (speed > 13) return;
      const slip = 0.00022 * (ball.mass || 1);
      // Downhill along the bat: gravity (0,1) projected onto tangent (tx,ty) toward tip.
      const gDot = ty;
      const dir = gDot >= 0 ? 1 : -1;
      Body.applyForce(ball, ball.position, { x: tx * slip * dir, y: ty * slip * dir });
    });
  }

  function updateSwingCueState() {
    if (!engine || !bat) {
      swingCueVisible = false;
      return;
    }
    const zoneTop = bat.position.y - 38;
    const zoneBottom = bat.position.y - 8;
    const zoneLeft = bat.position.x - 10;
    const zoneRight = bat.position.x + BAT_LENGTH * 0.58;

    swingCueVisible = engine.world.bodies.some((body) => {
      if (body.label !== "baseball") return false;
      return (
        body.position.y >= zoneTop &&
        body.position.y <= zoneBottom &&
        body.position.x >= zoneLeft &&
        body.position.x <= zoneRight
      );
    });
  }

  function keepBallInPlayfield() {
    if (!engine) return;
    const minY = TOP_WALL_BOTTOM + BALL_RADIUS + 1;
    const minX = BALL_RADIUS + 3;
    const maxX = BOARD_WIDTH - BALL_RADIUS - 3;
    engine.world.bodies.forEach((body) => {
      if (body.label !== "baseball") return;
      if (body.position.y < minY) {
        Body.setPosition(body, { x: body.position.x, y: minY });
        Body.setVelocity(body, {
          x: body.velocity.x * 0.88,
          y: Math.max(0.8, Math.abs(body.velocity.y) * 0.5 + 0.4),
        });
      }
      if (body.position.x < minX) {
        Body.setPosition(body, { x: minX, y: body.position.y });
        Body.setVelocity(body, { x: Math.abs(body.velocity.x) * 0.65, y: body.velocity.y });
      } else if (body.position.x > maxX) {
        Body.setPosition(body, { x: maxX, y: body.position.y });
        Body.setVelocity(body, { x: -Math.abs(body.velocity.x) * 0.65, y: body.velocity.y });
      }
    });
  }

  function beforeUpdateWorld() {
    cleanupMissedBalls();
    keepBallInPlayfield();
    constrainBatMotion();
    enforceSwingContact();
    applyBallSlideOnBat();
    updateSwingCueState();
  }

  /**
   * Builds static field art once: full-circle mound + pinball hole (no large brown fan).
   * Each frame we composite under Matter bodies via destination-over.
   */
  function ensureInfieldLayerCache() {
    if (infieldLayerCache && infieldLayerCache._v === INF_FIELD_CACHE_VERSION) return infieldLayerCache;
    const c = document.createElement("canvas");
    c.width = BOARD_WIDTH;
    c.height = BOARD_HEIGHT;
    c._v = INF_FIELD_CACHE_VERSION;
    const ix = c.getContext("2d");

    const mx = PITCH_ORIGIN_X;
    const my = PITCH_ORIGIN_Y;

    ix.fillStyle = GiantsTheme.dirt;
    ix.beginPath();
    ix.arc(mx, my, MOUND_RADIUS, 0, Math.PI * 2);
    ix.fill();
    ix.strokeStyle = "rgba(60,48,28,0.4)";
    ix.lineWidth = 1.5;
    ix.beginPath();
    ix.arc(mx, my, MOUND_RADIUS, 0, Math.PI * 2);
    ix.stroke();
    ix.strokeStyle = "rgba(0,0,0,0.12)";
    ix.lineWidth = 1;
    ix.beginPath();
    ix.arc(mx, my, MOUND_RADIUS - 0.5, 0, Math.PI * 2);
    ix.stroke();
    ix.fillStyle = "rgba(255,255,255,0.06)";
    ix.beginPath();
    ix.arc(mx, my - 3, MOUND_RADIUS * 0.55, 0, Math.PI * 2);
    ix.fill();

    const hx = mx;
    const hy = my + PITCH_HOLE_OFFSET_Y;
    ix.fillStyle = "#4a4a58";
    ix.beginPath();
    ix.arc(hx, hy, PITCH_HOLE_VISUAL_R + 3, 0, Math.PI * 2);
    ix.fill();
    ix.strokeStyle = "rgba(255,255,255,0.22)";
    ix.lineWidth = 1;
    ix.beginPath();
    ix.arc(hx, hy, PITCH_HOLE_VISUAL_R + 3, -Math.PI * 0.65, -Math.PI * 0.15);
    ix.stroke();
    ix.fillStyle = "#1e1e28";
    ix.beginPath();
    ix.arc(hx, hy, PITCH_HOLE_VISUAL_R + 0.5, 0, Math.PI * 2);
    ix.fill();
    ix.fillStyle = "#0b0b10";
    ix.beginPath();
    ix.arc(hx, hy, Math.max(2, PITCH_HOLE_VISUAL_R - 2), 0, Math.PI * 2);
    ix.fill();

    // Faint background path inspired by a baseball-diamond sketch (purely decorative).
    const { single, double, triple } = FIELD_LAYOUT;
    const leftMidX = 56;
    const rightMidX = BOARD_WIDTH - 56;
    const midY = 255;
    const homeY = BOARD_HEIGHT - 72;
    ix.strokeStyle = "rgba(247,243,232,0.2)";
    ix.lineWidth = 2;
    ix.lineJoin = "round";
    ix.lineCap = "round";

    // Outer "diamond path" contour.
    ix.beginPath();
    ix.moveTo(hx - 8, hy + 14);
    ix.lineTo(double.x - 14, double.y + 46);
    ix.lineTo(leftMidX, midY);
    ix.lineTo(hx - 14, homeY);
    ix.lineTo(hx + 14, homeY);
    ix.lineTo(rightMidX, midY);
    ix.lineTo(single.x + 14, single.y + 46);
    ix.lineTo(hx + 8, hy + 14);
    ix.stroke();

    // Top cap around 3B/center lane.
    ix.beginPath();
    ix.moveTo(hx - 28, triple.y - 10);
    ix.quadraticCurveTo(hx, triple.y - 16, hx + 28, triple.y - 10);
    ix.lineTo(hx + 27, triple.y + 20);
    ix.quadraticCurveTo(hx, triple.y + 14, hx - 27, triple.y + 20);
    ix.closePath();
    ix.stroke();

    // Side base boxes (1B / 2B pads in the sketch style).
    const boxW = 48;
    const boxH = 34;
    ix.strokeRect(double.x - 56, single.y + 66, boxW, boxH);
    ix.strokeRect(single.x + 8, single.y + 66, boxW, boxH);

    // Home plate marker.
    ix.beginPath();
    ix.moveTo(hx - 16, homeY);
    ix.lineTo(hx + 16, homeY);
    ix.lineTo(hx + 12, homeY + 24);
    ix.lineTo(hx, homeY + 32);
    ix.lineTo(hx - 12, homeY + 24);
    ix.closePath();
    ix.stroke();

    infieldLayerCache = c;
    return infieldLayerCache;
  }

  /**
   * Infield + mound drawn AFTER Matter bodies with destination-over so pixels sit UNDER
   * the ball/bat/targets.
   */
  function drawInfieldUnderBodies() {
    const context = render.context;
    context.save();
    context.globalCompositeOperation = "destination-over";
    context.drawImage(ensureInfieldLayerCache(), 0, 0);
    context.restore();
  }

  function drawPlayfieldOverlay() {
    const context = render.context;
    drawInfieldUnderBodies();

    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";

    if (moundCueVisible) {
      context.strokeStyle = GiantsTheme.orange;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(PITCH_ORIGIN_X, PITCH_ORIGIN_Y, MOUND_RADIUS + 1, 0, Math.PI * 2);
      context.stroke();

      context.fillStyle = GiantsTheme.cream;
      context.font = "bold 11px Arial";
      context.fillText(moundCueText, PITCH_ORIGIN_X, PITCH_ORIGIN_Y - MOUND_RADIUS - 12);

      if (pitchCueEndsAt > 0 && !reducedMotion) {
        const remaining = Math.max(0, pitchCueEndsAt - Date.now());
        const progress = 1 - remaining / Math.max(1, lastWindupMs);
        context.strokeStyle = GiantsTheme.cream;
        context.lineWidth = 2;
        const holeY = PITCH_ORIGIN_Y + PITCH_HOLE_OFFSET_Y;
        context.beginPath();
        context.arc(
          PITCH_ORIGIN_X,
          holeY,
          PITCH_HOLE_VISUAL_R + 8,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * progress
        );
        context.stroke();
      }
    }

    // Pop bumper pulse animation on hit (expand + retract).
    const now = Date.now();
    popBumperBodies.forEach((bumper) => {
      const hitAt = bumper.plugin && bumper.plugin.lastHitAt ? bumper.plugin.lastHitAt : 0;
      const elapsed = now - hitAt;
      if (elapsed < 0 || elapsed > 210) return;
      const t = elapsed / 210;
      const pulse = Math.sin(t * Math.PI);
      const cx = bumper.position.x;
      const cy = bumper.position.y;
      const baseR = (bumper.plugin && bumper.plugin.visualRadius) || 10;
      const ringR = baseR + 1 + pulse * 6.5;

      context.strokeStyle = `rgba(253,90,30,${0.58 * (1 - t)})`;
      context.lineWidth = 2 + pulse * 1.2;
      context.beginPath();
      context.arc(cx, cy, ringR, 0, Math.PI * 2);
      context.stroke();
    });

    // Triangle sling pulse animation on hit.
    slingBumperBodies.forEach((bumper) => {
      const hitAt = bumper.plugin && bumper.plugin.lastHitAt ? bumper.plugin.lastHitAt : 0;
      const elapsed = now - hitAt;
      if (elapsed < 0 || elapsed > 190) return;
      const t = elapsed / 190;
      const pulse = Math.sin(t * Math.PI);
      const cx = bumper.position.x;
      const cy = bumper.position.y;
      const verts = bumper.vertices || [];
      if (verts.length < 3) return;

      context.strokeStyle = `rgba(253,90,30,${0.52 * (1 - t)})`;
      context.lineWidth = 2.4 + pulse * 1.4;
      context.beginPath();
      verts.forEach((v, i) => {
        const ox = v.x - cx;
        const oy = v.y - cy;
        const s = 1 + pulse * 0.18;
        const px = cx + ox * s;
        const py = cy + oy * s;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.closePath();
      context.stroke();
    });

    targetSensors.forEach((target) => {
      const r = target.radius;
      context.fillStyle = "#1a1208";
      context.beginPath();
      context.arc(target.x, target.y, r, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = GiantsTheme.orange;
      context.lineWidth = 2;
      context.stroke();
      context.strokeStyle = "rgba(247,243,232,0.35)";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(target.x, target.y, Math.max(2, r - 4), 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = GiantsTheme.cream;
      context.font = "bold 8px Arial";
      context.fillText(target.label, target.x, target.y + r + 9);
    });

    if (specialLit) {
      const hrTargets = targetSensors.filter((target) => target.type === "homerun");
      hrTargets.forEach((hrTarget) => {
        context.strokeStyle = GiantsTheme.orange;
        context.lineWidth = 3;
        context.beginPath();
        context.arc(hrTarget.x, hrTarget.y, hrTarget.radius + 4, 0, Math.PI * 2);
        context.stroke();
      });
    }

    if (swingCueVisible) {
      context.fillStyle = GiantsTheme.cream;
      context.font = "bold 12px Arial";
      context.fillText("SWING!", bat.position.x + 28, bat.position.y - 48);
    }

    if (feedbackText && Date.now() < feedbackUntil) {
      context.fillStyle = GiantsTheme.cream;
      context.font = "bold 14px Arial";
      context.fillText(feedbackText, BOARD_WIDTH / 2, BOARD_HEIGHT - 120);
    }

    // Comic-book homerun burst (separate from standard feedback line).
    if (Date.now() < homerunBurstUntil) {
      const remaining = Math.max(0, homerunBurstUntil - Date.now());
      const duration = 900;
      const t = 1 - remaining / duration;
      const scale = 0.88 + Math.sin(Math.min(1, t) * Math.PI) * 0.24;
      const alpha = 1 - t * 0.85;
      const bx = BOARD_WIDTH / 2;
      const by = BOARD_HEIGHT * 0.46;

      context.save();
      context.translate(bx, by);
      context.scale(scale, scale);
      context.globalAlpha = Math.max(0, alpha);

      context.fillStyle = "rgba(253,90,30,0.22)";
      context.beginPath();
      const burstR = 54;
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        const r = i % 2 === 0 ? burstR : burstR * 0.62;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();

      context.lineWidth = 4;
      context.strokeStyle = "rgba(17,17,17,0.95)";
      context.fillStyle = GiantsTheme.orange;
      context.font = "900 28px Arial Black, Impact, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.strokeText("¡ADIOS PELOTA!", 0, 0);
      context.fillText("¡ADIOS PELOTA!", 0, 0);

      context.restore();
    }
    if (isPaused) {
      context.fillStyle = GiantsTheme.cream;
      context.font = "bold 20px Arial";
      context.fillText("PAUSED", BOARD_WIDTH / 2, BOARD_HEIGHT / 2);
      context.font = "bold 12px Arial";
      context.fillText("Press P to resume", BOARD_WIDTH / 2, BOARD_HEIGHT / 2 + 24);
    }

    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#0a0a0a";
    context.fillRect(0, 0, BOARD_WIDTH, 13);
    context.strokeStyle = GiantsTheme.orange;
    context.lineWidth = 2;
    context.strokeRect(1.5, 1.5, BOARD_WIDTH - 3, 10);
    context.fillStyle = "rgba(253,90,30,0.15)";
    context.fillRect(4, 3, BOARD_WIDTH - 8, 3);

    context.restore();
  }

  function startGame() {
    if (gameEnded) {
      hideInitialsPanel();
      gameEnded = false;
      gameState.score = 0;
      gameState.inning = 1;
      gameState.outs = 0;
      gameState.bases = [0, 0, 0];
      gameState.hitStreak = 0;
      gameState.perfectHits = 0;
      pitchesThisInning = 0;
      inningsLimit = MAX_INNINGS;
      extraInningsAwarded = 0;
      isInningBreak = false;
      specialLit = false;
      isPaused = false;
      updateOverlay("New game! Watch for the pitch cue.");
    }

    if (gameStarted) {
      gameModal.style.display = "flex";
      syncHighFromStorage();
      if (!pitchTimer) {
        queuePitch();
        pitchTimer = window.setInterval(queuePitch, PITCH_INTERVAL_MS);
      }
      updateOverlay("Game resumed. Watch for the pitch cue.");
      return;
    }

    gameModal.style.display = "flex";
    ensureAudioContext();
    syncHighFromStorage();
    createOverlay();
    setupWorld();

    gameContainer.style.width = `${BOARD_WIDTH}px`;
    gameContainer.style.height = `${BOARD_HEIGHT + 48}px`;

    Events.on(render, "afterRender", drawPlayfieldOverlay);

    Render.run(render);
    Runner.run(runner, engine);

    gameStarted = true;
    updateOverlay("Play ball! Watch for the pitch cue.");
    queuePitch();
    pitchTimer = window.setInterval(queuePitch, PITCH_INTERVAL_MS);
  }

  function stopGame() {
    gameModal.style.display = "none";
    hideInitialsPanel();
    closeLeaderboardModal();
    isPaused = false;
    if (pitchTimer) {
      window.clearInterval(pitchTimer);
      pitchTimer = null;
    }
    if (pendingPitchTimeout) {
      window.clearTimeout(pendingPitchTimeout);
      pendingPitchTimeout = null;
    }
    if (inningBreakTimeout) {
      window.clearTimeout(inningBreakTimeout);
      inningBreakTimeout = null;
    }
    moundCueVisible = false;
    moundCueText = "";
    pitchCueEndsAt = 0;
    isInningBreak = false;
    specialLit = false;
    resetSwingHold();
  }

  function pitchNowFromButton() {
    if (gameEnded) {
      startGame();
      return;
    }
    if (!gameStarted) {
      startGame();
      return;
    }
    queuePitch();
  }

  // Populate leaderboard: local first, then merge global top scores from Firestore.
  void initLeaderboardFromCloud();

  playBallBtn.addEventListener("click", pitchNowFromButton);
  closeGameBtn.addEventListener("click", stopGame);

  if (leaderboardBtn) {
    leaderboardBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openLeaderboardModal();
    });
  }
  if (leaderboardClose) {
    leaderboardClose.addEventListener("click", () => closeLeaderboardModal());
  }
  if (leaderboardModal) {
    leaderboardModal.addEventListener("click", (e) => {
      if (e.target === leaderboardModal) closeLeaderboardModal();
    });
  }
  if (hsSave) {
    hsSave.addEventListener("click", () => {
      const raw = hsInitials ? hsInitials.value : "";
      void (async () => {
        await saveLeaderboardEntry(raw, pendingFinalScore);
        hideInitialsPanel();
        syncHighFromStorage();
        updateOverlay("Saved! Tap PLAY BALL (WIP) for a new game.");
      })();
    });
  }
  if (hsSkip) {
    hsSkip.addEventListener("click", () => {
      hideInitialsPanel();
      updateOverlay("Tap PLAY BALL (WIP) for a new game.");
    });
  }
  if (hsInitials) {
    hsInitials.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (hsSave) hsSave.click();
      }
    });
  }

  gameModal.addEventListener("click", (event) => {
    if (event.target === gameModal) {
      stopGame();
    }
  });

  function shouldIgnoreSwingTarget(event) {
    if (event.target === closeGameBtn) return true;
    if (event.target.closest && event.target.closest("#highScoreEntry")) return true;
    if (event.target.closest && event.target.closest("#leaderboardModal")) return true;
    if (event.target.closest && event.target.closest("#playBallBtn")) return true;
    if (event.target.closest && event.target.closest("#leaderboardBtn")) return true;
    return false;
  }

  function trySwingPointerDown(event) {
    if (!gameStarted || gameModal.style.display === "none" || isPaused) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (shouldIgnoreSwingTarget(event)) return;
    if (initialsOpen) return;
    ensureAudioContext();
    const started = addSwingHoldPointer();
    if (started && event.pointerId != null && gameContainer.setPointerCapture) {
      try {
        gameContainer.setPointerCapture(event.pointerId);
      } catch (e) {
        /* ignore */
      }
    }
  }

  function trySwingPointerUp(event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (event.pointerId != null && gameContainer.releasePointerCapture) {
      try {
        gameContainer.releasePointerCapture(event.pointerId);
      } catch (e) {
        /* ignore */
      }
    }
    releaseSwingHoldPointer();
  }

  gameModal.addEventListener("pointerdown", trySwingPointerDown, true);
  gameModal.addEventListener("pointerup", trySwingPointerUp, true);
  gameModal.addEventListener("pointercancel", trySwingPointerUp, true);

  document.addEventListener("keydown", (event) => {
    if (hsInitials && document.activeElement === hsInitials) return;
    if (!gameStarted || gameModal.style.display === "none") return;
    if (event.code === "Space" || event.key === " ") {
      if (event.repeat) return;
      event.preventDefault();
      if (initialsOpen) return;
      ensureAudioContext();
      addSwingHoldSpace();
      return;
    }
    if (event.key === "p" || event.key === "P") {
      setPaused(!isPaused);
      return;
    }
    if (event.key === "d" || event.key === "D") {
      difficultyIndex = (difficultyIndex + 1) % DIFFICULTY_MODES.length;
      updateOverlay(`Difficulty: ${DIFFICULTY_MODES[difficultyIndex].name}`);
      return;
    }
    if (event.key === "r" || event.key === "R") {
      reducedMotion = !reducedMotion;
      updateOverlay(`Reduced motion: ${reducedMotion ? "ON" : "OFF"}`);
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      releaseSwingHoldSpace();
    }
  });
})();
