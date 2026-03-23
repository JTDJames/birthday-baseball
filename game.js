(function () {
  const BOARD_WIDTH = 400;
  const BOARD_HEIGHT = 600;
  const PITCH_INTERVAL_MS = 3000;

  const GiantsTheme = {
    orange: "#FD5A1E",
    black: "#111111",
    cream: "#F7F3E8",
    grass: "#2d5a27",
    dirt: "#c2b280",
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
  let isSwinging = false;

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
        background: GiantsTheme.grass,
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
      // Keep the center lane clear so every pitch reaches the bat.
      { label: "Single", x: 60, y: 70, width: 90, height: 28, type: "single" },
      { label: "Double", x: 120, y: 160, width: 95, height: 28, type: "double" },
      { label: "Triple", x: 280, y: 160, width: 95, height: 28, type: "triple" },
      { label: "Home Run", x: 340, y: 70, width: 110, height: 30, type: "homerun" },
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
    const startX = BOARD_WIDTH / 2 + (Math.random() - 0.5) * 20;
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
    Body.setVelocity(ball, { x: (Math.random() - 0.5) * 1.1, y: 4 + Math.random() * 0.6 });
    updateOverlay("Pitch delivered!");
  }

  function swingBat() {
    if (!bat || !canSwing) return;
    canSwing = false;
    isSwinging = true;

    // Fast upward snap, then release and re-center.
    Body.setAngularVelocity(bat, -2.6);
    Body.setAngle(bat, -0.55);

    setTimeout(() => {
      if (!bat) return;
      Body.setAngularVelocity(bat, 1.45);
    }, 95);

    setTimeout(() => {
      if (!bat) return;
      Body.setAngle(bat, 0);
      Body.setAngularVelocity(bat, 0);
      isSwinging = false;
      canSwing = true;
    }, 280);
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

  function boostHitBall(ballBody) {
    const upSpeed = 11 + Math.random() * 2.5;
    const sideSpeed = (Math.random() - 0.5) * 7.2;
    Body.setVelocity(ballBody, { x: sideSpeed, y: -upSpeed });
    Body.setAngularVelocity(ballBody, (Math.random() - 0.5) * 1.2);
  }

  function onCollisionStart(event) {
    if (!engine) return;
    event.pairs.forEach((pair) => {
      const batAndBall =
        (pair.bodyA === bat && pair.bodyB.label === "baseball" && pair.bodyB) ||
        (pair.bodyB === bat && pair.bodyA.label === "baseball" && pair.bodyA);
      if (batAndBall && isSwinging) {
        boostHitBall(batAndBall);
        updateOverlay("Crack! Drive it to the targets!");
      }

      const hit = getBallAndTarget(pair.bodyA, pair.bodyB);
      if (!hit) return;
      // Only count balls hit back up toward the top targets.
      if (hit.ball.velocity.y > -0.75) return;
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
    context.fillStyle = GiantsTheme.dirt;
    context.beginPath();
    context.moveTo(BOARD_WIDTH / 2, BOARD_HEIGHT - 230);
    context.lineTo(BOARD_WIDTH - 30, BOARD_HEIGHT - 30);
    context.lineTo(30, BOARD_HEIGHT - 30);
    context.closePath();
    context.fill();

    context.beginPath();
    context.arc(BOARD_WIDTH / 2, BOARD_HEIGHT - 185, 38, 0, Math.PI * 2);
    context.fill();

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

  function trySwing(event) {
    if (!gameStarted || gameModal.style.display === "none") return;
    if (event.target === closeGameBtn) return;
    swingBat();
  }

  document.addEventListener("pointerdown", trySwing);
  document.addEventListener("click", trySwing);
})();
