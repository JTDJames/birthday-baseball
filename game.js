(function () {
  const BOARD_WIDTH = 400;
  const BOARD_HEIGHT = 600;
  const PITCH_INTERVAL_MS = 3000;

  const GiantsTheme = {
    orange: "#FD5A1E",
    black: "#111111",
    cream: "#F7F3E8",
    dark: "#27251F",
  };

  const { Engine, Render, Runner, World, Bodies, Body, Constraint, Events } =
    Matter;

  const playBallBtn = document.getElementById("playBallBtn");
  const closeGameBtn = document.getElementById("closeGame");
  const gameModal = document.getElementById("gameModal");
  const gameContainer = document.getElementById("gameContainer");

  if (!playBallBtn || !closeGameBtn || !gameModal || !gameContainer) {
    return;
  }

  let engine = null;
  let render = null;
  let runner = null;
  let pitchTimer = null;
  let gameStarted = false;
  let canSwing = true;

  const gameState = {
    score: 0,
    outs: 0,
    bases: [0, 0, 0], // [1st, 2nd, 3rd]
  };

  let overlay = null;
  let bat = null;
  let activeBalls = new Set();
  let targetSensors = [];

  function createOverlay() {
    overlay = document.createElement("div");
    overlay.style.width = BOARD_WIDTH + "px";
    overlay.style.margin = "0 auto 8px";
    overlay.style.color = GiantsTheme.cream;
    overlay.style.fontFamily = "Arial, Helvetica, sans-serif";
    overlay.style.fontWeight = "700";
    overlay.style.textAlign = "center";
    gameContainer.innerHTML = "";
    gameContainer.appendChild(overlay);
    updateOverlay("Tap/click to swing the bat.");
  }

  function updateOverlay(message) {
    if (!overlay) return;
    const baseText = `Bases: [${gameState.bases.join(", ")}]`;
    overlay.textContent = `Score: ${gameState.score} | Outs: ${gameState.outs} | ${baseText}${message ? ` | ${message}` : ""}`;
  }

  function setupWorld() {
    engine = Engine.create();
    engine.gravity.y = 0.95;

    render = Render.create({
      element: gameContainer,
      engine,
      options: {
        width: BOARD_WIDTH,
        height: BOARD_HEIGHT,
        wireframes: false,
        background: GiantsTheme.dark,
      },
    });

    runner = Runner.create();

    const wallOptions = {
      isStatic: true,
      render: { fillStyle: GiantsTheme.black },
      friction: 0.2,
      restitution: 0.2,
    };

    const leftWall = Bodies.rectangle(0, BOARD_HEIGHT / 2, 20, BOARD_HEIGHT, wallOptions);
    const rightWall = Bodies.rectangle(
      BOARD_WIDTH,
      BOARD_HEIGHT / 2,
      20,
      BOARD_HEIGHT,
      wallOptions
    );
    const topWall = Bodies.rectangle(BOARD_WIDTH / 2, 0, BOARD_WIDTH, 20, wallOptions);
    const floor = Bodies.rectangle(
      BOARD_WIDTH / 2,
      BOARD_HEIGHT + 10,
      BOARD_WIDTH,
      20,
      wallOptions
    );

    const batLength = 120;
    const batThickness = 18;
    const batX = BOARD_WIDTH / 2;
    const batY = BOARD_HEIGHT - 75;

    bat = Bodies.rectangle(batX, batY, batLength, batThickness, {
      density: 0.004,
      frictionAir: 0.02,
      friction: 0.8,
      restitution: 0.45,
      render: { fillStyle: GiantsTheme.orange },
      chamfer: { radius: 8 },
    });

    const batPivot = Constraint.create({
      bodyA: bat,
      pointA: { x: -batLength / 2 + 8, y: 0 },
      pointB: { x: batX - batLength / 2 + 8, y: batY },
      stiffness: 1,
      length: 0,
      render: { visible: false },
    });

    targetSensors = createTargets();

    World.add(engine.world, [
      leftWall,
      rightWall,
      topWall,
      floor,
      bat,
      batPivot,
      ...targetSensors.map((t) => t.body),
    ]);

    Events.on(engine, "collisionStart", onCollisionStart);
    Events.on(engine, "beforeUpdate", cleanupMissedBalls);
  }

  function createTargets() {
    const targetDefs = [
      { label: "Single", x: 70, y: 90, width: 90, height: 28, type: "single" },
      { label: "Double", x: 165, y: 125, width: 90, height: 28, type: "double" },
      { label: "Triple", x: 260, y: 90, width: 90, height: 28, type: "triple" },
      { label: "Home Run", x: 330, y: 140, width: 110, height: 30, type: "homerun" },
    ];

    return targetDefs.map((target) => {
      const cup = Bodies.rectangle(target.x, target.y, target.width, target.height, {
        isStatic: true,
        isSensor: true,
        label: `target:${target.type}`,
        render: {
          fillStyle: GiantsTheme.cream,
          strokeStyle: GiantsTheme.orange,
          lineWidth: 2,
        },
      });

      return { ...target, body: cup };
    });
  }

  function spawnBall() {
    if (!engine) return;
    const startX = 140 + Math.random() * 120;
    const ball = Bodies.circle(startX, 28, 11, {
      label: "baseball",
      restitution: 0.55,
      friction: 0.002,
      frictionAir: 0.0008,
      density: 0.0016,
      render: {
        fillStyle: "#FFFFFF",
        strokeStyle: GiantsTheme.black,
        lineWidth: 1.5,
      },
    });

    activeBalls.add(ball.id);
    World.add(engine.world, ball);
    Body.setVelocity(ball, { x: (Math.random() - 0.5) * 2.4, y: 3.4 + Math.random() * 0.8 });
    updateOverlay("Pitch delivered!");
  }

  function swingBat() {
    if (!bat || !canSwing) return;
    canSwing = false;

    // Fast upward snap, then release and re-center.
    Body.setAngularVelocity(bat, -1.55);
    Body.setAngle(bat, -0.35);

    setTimeout(() => {
      if (!bat) return;
      Body.setAngularVelocity(bat, 1.05);
    }, 110);

    setTimeout(() => {
      if (!bat) return;
      Body.setAngle(bat, 0);
      Body.setAngularVelocity(bat, 0);
      canSwing = true;
    }, 260);
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

  function handleTargetHit(targetType) {
    if (targetType === "single") {
      advanceRunners(1);
      updateOverlay("Single!");
      return;
    }
    if (targetType === "double") {
      advanceRunners(2);
      updateOverlay("Double!");
      return;
    }
    if (targetType === "triple") {
      advanceRunners(3);
      updateOverlay("Triple!");
      return;
    }
    if (targetType === "homerun") {
      advanceRunners(4);
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

  function onCollisionStart(event) {
    if (!engine) return;
    event.pairs.forEach((pair) => {
      const hit = getBallAndTarget(pair.bodyA, pair.bodyB);
      if (!hit) return;
      const targetType = hit.target.label.split(":")[1];
      handleTargetHit(targetType);
      removeBall(hit.ball);
    });
  }

  function cleanupMissedBalls() {
    if (!engine) return;
    const bodies = engine.world.bodies;
    bodies.forEach((body) => {
      if (body.label !== "baseball") return;
      if (body.position.y > BOARD_HEIGHT - 18) {
        removeBall(body);
        gameState.outs += 1;
        updateOverlay("Out!");
      }
    });
  }

  function drawTargetLabels() {
    const context = render.context;
    context.save();
    context.font = "bold 12px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = GiantsTheme.black;

    targetSensors.forEach((target) => {
      context.fillText(target.label, target.x, target.y);
    });
    context.restore();
  }

  function startGame() {
    if (gameStarted) {
      gameModal.style.display = "flex";
      updateOverlay("Game resumed.");
      return;
    }

    gameModal.style.display = "flex";
    createOverlay();
    setupWorld();

    gameContainer.style.width = `${BOARD_WIDTH}px`;
    gameContainer.style.height = `${BOARD_HEIGHT + 30}px`;

    Events.on(render, "afterRender", drawTargetLabels);

    Render.run(render);
    Runner.run(runner, engine);

    // Immediate opening pitch, then every 3 seconds.
    spawnBall();
    pitchTimer = window.setInterval(spawnBall, PITCH_INTERVAL_MS);

    gameStarted = true;
    updateOverlay("Play ball!");
  }

  function stopGame() {
    gameModal.style.display = "none";
  }

  function pitchNowFromButton() {
    if (!gameStarted) {
      startGame();
      return;
    }
    spawnBall();
  }

  playBallBtn.addEventListener("click", pitchNowFromButton);
  closeGameBtn.addEventListener("click", stopGame);

  gameModal.addEventListener("click", (event) => {
    if (event.target === gameModal) {
      stopGame();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!gameStarted || gameModal.style.display === "none") return;
    if (event.target === closeGameBtn) return;
    swingBat();
  });
})();
