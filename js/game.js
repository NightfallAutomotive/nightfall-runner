(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;

  const overlay = document.getElementById("game-overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMessage = document.getElementById("overlay-message");
  const startButton = document.getElementById("start-button");
  const hudDistance = document.getElementById("hud-distance");
  const hudBest = document.getElementById("hud-best");
  const distanceStat = document.getElementById("distance-stat");
  const bestStat = document.getElementById("best-stat");

  const W = canvas.width;
  const H = canvas.height;
  const GROUND = 414;
  const CAR_X = 150;
  const CAR_W = 104;
  const CAR_H = 42;
  const STORAGE_KEY = "nightfall-runner-best-v1";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Speed tuning: speed steps up every LEVEL_DISTANCE points.
  const BASE_SPEED = 330;
  const SPEED_STEP = 40;        // added per level
  const MAX_SPEED = 690;        // cap (reached at level 9)
  const LEVEL_DISTANCE = 1000;  // score needed per level
  const SPEED_EASE = 2.5;       // how quickly speed glides to the new target

  let state = "ready";
  let rafId = null;
  let lastTime = 0;
  let elapsed = 0;
  let distance = 0;
  let best = readBest();
  let speed = BASE_SPEED;
  let level = 0;
  let banner = 0;
  let spawnTimer = 1.1;
  let roadOffset = 0;
  let shake = 0;
  let flash = 0;
  let obstacles = [];
  let particles = [];
  let stars = createStars();
  let keys = { down: false };
  let audioContext = null;
  let soundEnabled = false;
  let shownScore = -1;
  let shownBest = -1;

  const car = { x: CAR_X, y: GROUND - CAR_H, vy: 0, w: CAR_W, h: CAR_H, grounded: true, ducking: false };

  function readBest() {
    try { return Math.max(0, Number(localStorage.getItem(STORAGE_KEY)) || 0); }
    catch (_) { return 0; }
  }

  function formatScore(value) {
    return String(Math.floor(value)).padStart(5, "0");
  }

  // Only touches the DOM when a displayed number actually changes.
  function updateScoreUI(force = false) {
    const score = Math.floor(distance);
    if (force || score !== shownScore) {
      shownScore = score;
      const text = formatScore(score);
      hudDistance.textContent = text;
      distanceStat.textContent = text;
    }
    if (force || best !== shownBest) {
      shownBest = best;
      const text = formatScore(best);
      hudBest.textContent = text;
      bestStat.textContent = text;
    }
  }

  function createStars() {
    let seed = 240404;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    return Array.from({ length: 95 }, () => ({
      x: random() * W, y: 35 + random() * 300,
      r: .4 + random() * 1.5, a: .18 + random() * .68,
      phase: random() * Math.PI * 2
    }));
  }

  function targetSpeed() {
    return Math.min(MAX_SPEED, BASE_SPEED + Math.floor(distance / LEVEL_DISTANCE) * SPEED_STEP);
  }

  function startGame() {
    if (state === "running") return;
    unlockAudio();
    state = "running";
    elapsed = 0;
    distance = 0;
    speed = BASE_SPEED;
    level = 0;
    banner = 0;
    spawnTimer = .7;
    roadOffset = 0;
    shake = 0;
    flash = 0;
    lastTime = 0;
    obstacles = [];
    particles = [];
    car.y = GROUND - CAR_H;
    car.vy = 0;
    car.grounded = true;
    car.ducking = false;
    overlay.classList.add("hidden");
    canvas.focus({ preventScroll: true });
    updateScoreUI(true);
    playTone(420, .06, "sine", .035);
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function endGame() {
    if (state !== "running") return;
    state = "over";
    banner = 0;
    shake = reducedMotion ? 0 : 11;
    flash = reducedMotion ? 0 : .35;
    burst(CAR_X + 80, car.y + 18, 26, "#b48ead");
    burst(CAR_X + 55, car.y + 28, 18, "#88c0d0");
    playTone(120, .22, "sawtooth", .05);

    const finalScore = Math.floor(distance);
    const newBest = finalScore > best;
    if (newBest) {
      best = finalScore;
      try { localStorage.setItem(STORAGE_KEY, String(best)); } catch (_) {}
    }
    updateScoreUI(true);
    overlayTitle.innerHTML = "RUN <span>ENDED</span>";
    overlayMessage.innerHTML = `You covered <strong>${formatScore(finalScore)} m</strong>.<br>${newBest ? "New personal best. Nice driving." : "The road is still waiting."}`;
    startButton.innerHTML = 'TRY AGAIN <span>↻</span>';
    overlay.classList.remove("hidden");
  }

  function jump() {
    if (state === "ready" || state === "over") {
      startGame();
      return;
    }
    if (state !== "running") return;
    if (car.grounded) {
      car.vy = -665;
      car.grounded = false;
      burst(car.x + 25, GROUND - 4, 7, "#88c0d0", true);
      playTone(270, .07, "triangle", .025);
    }
  }

  function duck(on) {
    const wasDown = keys.down;
    keys.down = on;
    car.ducking = on && !car.grounded;
    if (on && !wasDown && state === "running" && !car.grounded) car.vy += 30;
  }

  function spawnObstacle() {
    const roll = Math.random();
    let type = "cone";
    if (distance > 80 && roll > .72) type = "toolbox";
    else if (distance > 180 && roll > .87) type = "barrier";
    const dims = {
      cone: { w: 30, h: 44 },
      toolbox: { w: 43, h: 35 },
      barrier: { w: 62, h: 49 }
    }[type];
    obstacles.push({ x: W + 20, y: GROUND - dims.h, ...dims, type, passed: false, phase: Math.random() * 6 });
    const difficulty = Math.min(.48, distance / 1600);
    spawnTimer = Math.max(.72, 1.28 + Math.random() * .55 - difficulty);
  }

  function update(dt) {
    elapsed += dt;
    distance += speed * dt / 10;

    // Stepped speed: every LEVEL_DISTANCE points the target goes up,
    // and the actual speed glides toward it.
    const newLevel = Math.floor(distance / LEVEL_DISTANCE);
    if (newLevel > level) {
      level = newLevel;
      if (targetSpeed() > speed + 1) {
        banner = 1.4;
        playTone(660, .1, "square", .03);
      }
    }
    const target = targetSpeed();
    speed += (target - speed) * Math.min(1, dt * SPEED_EASE);

    roadOffset = (roadOffset + speed * dt) % 100;

    car.ducking = keys.down && !car.grounded;
    car.vy += 1750 * dt;
    car.y += car.vy * dt;
    if (car.y + car.h >= GROUND) {
      car.y = GROUND - car.h;
      car.vy = 0;
      car.grounded = true;
      car.ducking = false;
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) spawnObstacle();

    const carBox = {
      x: car.x + 14, y: car.y + (car.ducking ? 20 : 8),
      w: car.w - 24, h: car.ducking ? 18 : car.h - 12
    };

    for (const ob of obstacles) {
      ob.x -= speed * dt;
      ob.phase += dt * 5;
      if (!ob.passed && ob.x + ob.w < car.x) {
        ob.passed = true;
        burst(ob.x + ob.w, GROUND - 4, 3, "#a3be8c", true);
      }
      const obBox = { x: ob.x + 5, y: ob.y + 5, w: ob.w - 10, h: ob.h - 5 };
      if (overlaps(carBox, obBox)) {
        endGame();
        break;
      }
    }
    obstacles = obstacles.filter(ob => ob.x + ob.w > -40);
    updateEffects(dt);
    updateScoreUI();
  }

  // Runs during play and after a crash so the death effects can finish.
  function updateEffects(dt) {
    if (shake > 0) shake = Math.max(0, shake - dt * 32);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (banner > 0) banner = Math.max(0, banner - dt);
    updateParticles(dt);
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function burst(x, y, count, color, dust = false) {
    for (let i = 0; i < count; i++) {
      const angle = dust ? Math.PI + Math.random() * Math.PI : Math.random() * Math.PI * 2;
      const force = dust ? 30 + Math.random() * 90 : 35 + Math.random() * 210;
      const life = .35 + Math.random() * .65;
      particles.push({
        x, y, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force - (dust ? 0 : 40),
        life, maxLife: life,
        size: 1 + Math.random() * 3, color, gravity: dust ? 90 : 280
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    particles = particles.filter(p => p.life > 0);
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    drawBackground();
    drawRoad();
    drawObstacles();
    drawCar();
    drawParticles();
    drawBanner();
    if (flash > 0) {
      ctx.fillStyle = `rgba(180,142,173,${flash * .45})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function drawBanner() {
    if (banner <= 0) return;
    const fadeIn = Math.min(1, (1.4 - banner) * 6);
    const fadeOut = Math.min(1, banner * 2);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(fadeIn, fadeOut));
    ctx.textAlign = "center";
    ctx.shadowColor = "#88c0d0";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#88c0d0";
    ctx.font = "bold 30px monospace";
    ctx.fillText("SPEED UP", W / 2, 110);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#b48ead";
    ctx.font = "bold 14px monospace";
    ctx.fillText(`LEVEL ${level + 1}`, W / 2, 134);
    ctx.restore();
  }

  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, "#080c19");
    sky.addColorStop(.58, "#11182b");
    sky.addColorStop(1, "#25203b");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * .68, 235, 15, W * .68, 235, 310);
    glow.addColorStop(0, "rgba(180,142,173,.19)");
    glow.addColorStop(1, "rgba(180,142,173,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, GROUND);

    for (const star of stars) {
      const twinkle = reducedMotion ? 1 : .7 + Math.sin(elapsed * 1.5 + star.phase) * .3;
      ctx.globalAlpha = star.a * twinkle;
      ctx.fillStyle = "#d8e8ff";
      ctx.fillRect(star.x, star.y, star.r, star.r);
    }
    ctx.globalAlpha = 1;

    drawCityLayer(.12, 324, "#17182d", 110, 190, false);
    drawCityLayer(.25, 365, "#20203b", 64, 145, true);

    // distant neon moon
    ctx.save();
    ctx.shadowColor = "#b48ead";
    ctx.shadowBlur = 24;
    ctx.strokeStyle = "rgba(180,142,173,.72)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(735, 142, 38, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(180,142,173,.18)";
    ctx.beginPath(); ctx.arc(735, 142, 47, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // road-side neon perspective lines
    ctx.save();
    ctx.strokeStyle = "rgba(136,192,208,.24)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 11; i++) {
      const x = (i * 118 - (roadOffset * .65) % 118);
      ctx.beginPath(); ctx.moveTo(x, 350); ctx.lineTo(x - 100, GROUND); ctx.stroke();
    }
    ctx.restore();
  }

  function drawCityLayer(factor, baseY, color, minW, maxH, windows) {
    const totalWidth = W + 200;
    const offset = (roadOffset * factor * 2.2) % totalWidth;
    ctx.fillStyle = color;
    let x = -offset - 20;
    let i = 0;
    while (x < W + 40) {
      const width = minW * .55 + ((i * 37 + 43) % minW);
      const height = 38 + ((i * 53 + 21) % maxH);
      ctx.fillRect(x, baseY - height, width, height);
      if (windows) {
        ctx.fillStyle = i % 2 ? "rgba(136,192,208,.28)" : "rgba(180,142,173,.28)";
        for (let wy = baseY - height + 12; wy < baseY - 8; wy += 17) {
          for (let wx = x + 9; wx < x + width - 5; wx += 14) {
            if ((Math.floor(wx + wy) % 3) !== 0) ctx.fillRect(wx, wy, 3, 5);
          }
        }
        ctx.fillStyle = color;
      }
      x += width + 8;
      i++;
    }
  }

  function drawRoad() {
    const road = ctx.createLinearGradient(0, GROUND, 0, H);
    road.addColorStop(0, "#141a2b");
    road.addColorStop(1, "#080c15");
    ctx.fillStyle = road;
    ctx.fillRect(0, GROUND, W, H - GROUND);

    ctx.save();
    ctx.shadowColor = "#88c0d0";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#88c0d0";
    ctx.fillRect(0, GROUND, W, 2);
    ctx.restore();
    ctx.fillStyle = "rgba(180,142,173,.65)";
    ctx.fillRect(0, GROUND + 5, W, 1);

    for (let i = 0; i < 12; i++) {
      const x = i * 100 - roadOffset % 100;
      ctx.fillStyle = "rgba(136,192,208,.55)";
      ctx.fillRect(x, GROUND + 44, 48, 3);
      ctx.fillStyle = "rgba(180,142,173,.22)";
      ctx.fillRect(x + 8, GROUND + 53, 34, 1);
    }

    // roadside lamps
    for (let i = 0; i < 6; i++) {
      const x = i * 210 - (roadOffset * .85) % 210 + 70;
      ctx.strokeStyle = "rgba(136,192,208,.45)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x, 280); ctx.stroke();
      ctx.save();
      ctx.shadowColor = "#88c0d0"; ctx.shadowBlur = 14;
      ctx.fillStyle = "#88c0d0"; ctx.fillRect(x - 4, 278, 8, 3);
      ctx.restore();
    }
  }

  function drawCar() {
    const x = car.x;
    const y = car.y + (car.ducking ? 13 : 0);
    const bob = car.grounded && state === "running" && !reducedMotion ? Math.sin(elapsed * 25) * 1.3 : 0;
    const yy = y + bob;

    // ground shadow
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.beginPath(); ctx.ellipse(x + 53, GROUND + 2, 58, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // underglow
    ctx.save();
    ctx.shadowColor = "#88c0d0";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(136,192,208,.45)";
    ctx.fillRect(x + 13, yy + 34, 80, 5);
    ctx.restore();

    // rear spoiler and boot
    ctx.fillStyle = "#b48ead";
    ctx.fillRect(x + 14, yy + 7, 4, 10);
    ctx.fillRect(x + 9, yy + 6, 18, 3);
    // body silhouette
    ctx.save();
    ctx.shadowColor = "#88c0d0";
    ctx.shadowBlur = 12;
    const body = ctx.createLinearGradient(x, yy + 7, x, yy + 39);
    body.addColorStop(0, "#c3f3ff");
    body.addColorStop(.35, "#88c0d0");
    body.addColorStop(1, "#467e99");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x + 8, yy + 31);
    ctx.lineTo(x + 14, yy + 18);
    ctx.lineTo(x + 34, yy + 14);
    ctx.lineTo(x + 48, yy + 3);
    ctx.lineTo(x + 72, yy + 3);
    ctx.lineTo(x + 87, yy + 17);
    ctx.lineTo(x + 99, yy + 21);
    ctx.lineTo(x + 103, yy + 32);
    ctx.lineTo(x + 98, yy + 37);
    ctx.lineTo(x + 12, yy + 37);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // windows
    ctx.fillStyle = "#11182b";
    ctx.beginPath();
    ctx.moveTo(x + 39, yy + 14); ctx.lineTo(x + 50, yy + 6);
    ctx.lineTo(x + 69, yy + 6); ctx.lineTo(x + 80, yy + 16);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(214,169,255,.8)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 59, yy + 7); ctx.lineTo(x + 59, yy + 16); ctx.stroke();

    // front splitter and lights
    ctx.fillStyle = "#b48ead";
    ctx.fillRect(x + 84, yy + 34, 18, 3);
    ctx.save();
    ctx.fillStyle = "#eceff4";
    ctx.shadowColor = "#eceff4"; ctx.shadowBlur = 10;
    ctx.fillRect(x + 95, yy + 23, 6, 4);
    ctx.restore();
    ctx.fillStyle = "#bf616a";
    ctx.fillRect(x + 11, yy + 25, 4, 5);

    // wheels
    drawWheel(x + 29, yy + 35);
    drawWheel(x + 81, yy + 35);
    // door line and tiny NF logo
    ctx.strokeStyle = "rgba(46,52,64,.65)";
    ctx.beginPath(); ctx.moveTo(x + 61, yy + 19); ctx.lineTo(x + 61, yy + 31); ctx.stroke();
    ctx.fillStyle = "#263448";
    ctx.font = "bold 7px monospace";
    ctx.fillText("NF", x + 66, yy + 28);
  }

  function drawWheel(x, y) {
    ctx.save();
    ctx.fillStyle = "#070a11";
    ctx.strokeStyle = "#88c0d0";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#b48ead";
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(236,239,244,.65)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.stroke();
    ctx.restore();
  }

  function drawObstacles() {
    for (const ob of obstacles) {
      const pulse = .7 + Math.sin(ob.phase) * .3;
      ctx.save();
      if (ob.type === "cone") {
        ctx.shadowColor = "#b48ead"; ctx.shadowBlur = 12;
        ctx.fillStyle = "#b48ead";
        ctx.beginPath(); ctx.moveTo(ob.x + ob.w / 2, ob.y); ctx.lineTo(ob.x + ob.w, ob.y + ob.h); ctx.lineTo(ob.x, ob.y + ob.h); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#eceff4";
        ctx.beginPath(); ctx.moveTo(ob.x + 10, ob.y + 24); ctx.lineTo(ob.x + ob.w - 10, ob.y + 24); ctx.lineTo(ob.x + ob.w - 7, ob.y + 31); ctx.lineTo(ob.x + 7, ob.y + 31); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#d6a9ff"; ctx.fillRect(ob.x - 3, ob.y + ob.h - 3, ob.w + 6, 4);
      } else if (ob.type === "toolbox") {
        ctx.shadowColor = "#88c0d0"; ctx.shadowBlur = 10;
        ctx.fillStyle = "#496b87";
        ctx.fillRect(ob.x, ob.y + 7, ob.w, ob.h - 7);
        ctx.fillStyle = "#88c0d0"; ctx.fillRect(ob.x - 2, ob.y + 5, ob.w + 4, 5);
        ctx.fillStyle = "#263448"; ctx.fillRect(ob.x + 5, ob.y + 16, ob.w - 10, 2);
        ctx.fillStyle = "#b48ead"; ctx.fillRect(ob.x + 7, ob.y + 23, ob.w - 14, 3);
        ctx.fillStyle = "#eceff4"; ctx.fillRect(ob.x + 10, ob.y + 29, 4, 2); ctx.fillRect(ob.x + ob.w - 14, ob.y + 29, 4, 2);
      } else {
        ctx.shadowColor = "#b48ead"; ctx.shadowBlur = 13;
        ctx.fillStyle = "#30364c";
        ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
        ctx.fillStyle = `rgba(180,142,173,${pulse})`;
        ctx.fillRect(ob.x + 2, ob.y + 3, ob.w - 4, 4);
        ctx.fillStyle = "#ebcb8b";
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(ob.x + 5 + i * 20, ob.y + ob.h - 3);
          ctx.lineTo(ob.x + 17 + i * 20, ob.y + 13);
          ctx.lineTo(ob.x + 25 + i * 20, ob.y + 13);
          ctx.lineTo(ob.x + 13 + i * 20, ob.y + ob.h - 3);
          ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = "#88c0d0"; ctx.lineWidth = 1;
        ctx.strokeRect(ob.x, ob.y, ob.w, ob.h);
      }
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawReadyScene() {
    elapsed += .016;
    roadOffset = (roadOffset + .8) % 100;
    draw();
  }

  function loop(now) {
    rafId = null;
    const dt = Math.min(.032, (now - (lastTime || now)) / 1000);
    lastTime = now;

    if (state === "running") update(dt);
    else updateEffects(dt);
    draw();

    // Keep going while playing, and after a crash until the effects finish.
    if (state === "running" || particles.length || shake > 0 || flash > 0) {
      rafId = requestAnimationFrame(loop);
    } else {
      lastTime = 0;
    }
  }

  function unlockAudio() {
    if (!soundEnabled) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          audioContext = new AudioCtx();
          soundEnabled = true;
        }
      } catch (_) { soundEnabled = false; }
    }
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
  }

  function playTone(freq, duration, type = "sine", volume = .025) {
    if (!soundEnabled || !audioContext) return;
    try {
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioContext.currentTime);
      gain.gain.setValueAtTime(volume, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
      osc.connect(gain); gain.connect(audioContext.destination);
      osc.start(); osc.stop(audioContext.currentTime + duration);
    } catch (_) {}
  }

  function handleKeyDown(event) {
    // Leave browser shortcuts and focused links/buttons alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest("a, button")) return;

    const key = event.key.toLowerCase();
    if ([" ", "arrowup", "arrowdown", "enter", "w", "s"].includes(key)) event.preventDefault();
    if (event.repeat) return;
    if ([" ", "arrowup", "w"].includes(key)) jump();
    if (["arrowdown", "s"].includes(key)) duck(true);
    if (key === "enter" && state !== "running") startGame();
  }

  function handleKeyUp(event) {
    const key = event.key.toLowerCase();
    if (["arrowdown", "s"].includes(key)) duck(false);
  }

  window.addEventListener("keydown", handleKeyDown, { passive: false });
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", () => duck(false));
  canvas.addEventListener("pointerdown", event => {
    event.preventDefault();
    jump();
  });
  startButton.addEventListener("click", startGame);

  updateScoreUI(true);
  drawReadyScene();
})();
