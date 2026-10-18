// --- Core animation engine ---------------------------------------------------
//
// One Effect instance owns one animation event: everything spawned for a single
// message. It takes that message's full list of emoji, holds whatever state the
// event shares across its particles (a firework's shells, a vortex's axis, a
// worm's path) and owns their DOM elements for its lifetime.
//
// Taking the whole message at once is what lets an effect scale itself to how
// many emoji were used, and spread those emoji across its particles.
//
// Subclasses implement:
//   setup()             — once per event, before any particle exists. Shared state on `this`.
//   particleCount()     — optional, how many particles to spawn. Default: per-emoji scaling.
//   initParticle(p, i)  — once per particle. Randomise it, set its size.
//   stepParticle(p, dt) — every frame. Move it. Return false when it's finished.
//   stepShared(dt)      — optional, every frame, before the particles.
//   particleDelay(i)    — optional, seconds before particle i starts. Default: random stagger.
//
// Subclasses must not use class field initialisers for state: those run *after*
// the base constructor, so they'd clobber whatever setup()/initParticle() wrote.
// Per-event state goes on `this` in setup(), per-particle state on `p`.

const container = document.getElementById('animatedEmojis');

// Cached rather than read per particle per frame. Reading window.innerWidth can
// flush pending layout, and the step loop is writing styles continuously, so
// reading it inside the loop risks a flush on every particle.
let viewW = window.innerWidth;
let viewH = window.innerHeight;
window.addEventListener('resize', () => {
  viewW = window.innerWidth;
  viewH = window.innerHeight;
});

// vw and vh aren't interchangeable — 10vh of travel is a different distance on
// screen than 10vw. Convert whenever an effect needs genuinely angular motion,
// and mind the direction: these are inverses, and using the wrong one squashes
// the motion by (w/h)² rather than leaving it alone.
const vh2vw = (v) => v * viewH / viewW;
const vw2vh = (v) => v * viewW / viewH;

const rand = (min, variance) => min + Math.random() * variance;
const randSign = () => (Math.random() < 0.5 ? -1 : 1);

const shuffled = (items) => {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const setSize = (p, px) => {
  p.el.style.fontSize = `${px}px`;
  p.el.style.width = `${px}px`;
  p.el.style.height = `${px}px`;
};

// Transform order is fixed at translate → rotate → scale so effects stay consistent.
const place = (p, x, y, { scale = 1, scaleY = null, rot = 0, opacity = 1 } = {}) => {
  let t = `translate(${x}vw, ${y}vh)`;
  if (rot) t += ` rotate(${rot}deg)`;
  if (scaleY !== null) t += ` scale(${scale}, ${scaleY})`;
  else if (scale !== 1) t += ` scale(${scale})`;
  p.el.style.transform = t;

  // Most effects hold a constant opacity for most of a particle's life — only
  // the fades change it — so this skips about two thirds of the writes.
  if (p.appliedOpacity !== opacity) {
    p.el.style.opacity = `${opacity}`;
    p.appliedOpacity = opacity;
  }
};

class Effect {
  static label = 'Effect';
  static count = 8; // particles per emoji in the message
  static maxCount = 150; // ceiling, for messages that are mostly emoji
  static spawnSpread = 2.0;

  constructor(emojis) {
    this.particles = [];
    // Shuffled so round-robin assignment below doesn't always lead with the
    // same emoji, and so repeated runs of one message vary.
    this.emojis = shuffled(Array.isArray(emojis) ? emojis : [emojis]);

    this.setup();
    this.count = this.particleCount();

    for (let i = 0; i < this.count; i++) {
      const el = document.createElement('div');
      el.classList.add('animatedEmoji');
      // Round-robin over the shuffled list, so any contiguous run of particles —
      // one firework shell, one stretch of worm — gets an even spread of the
      // message's emoji rather than clumping one per region.
      el.innerHTML = this.emojis[i % this.emojis.length];
      el.style.display = 'none';
      container.appendChild(el);

      const p = {
        el, i, age: 0, delay: this.particleDelay(i), alive: true, started: false,
        appliedOpacity: null, // forces the first write, see place()
      };
      this.initParticle(p, i);
      this.particles.push(p);
    }
  }

  setup() {}
  stepShared() {}
  initParticle() {}
  stepParticle() { return false; }

  // Scale with the number of emoji by default, which keeps the on-screen density
  // of a busy message roughly where it was when each emoji spawned its own effect.
  particleCount() {
    return Math.min(this.constructor.count * this.emojis.length, this.constructor.maxCount);
  }

  particleDelay() {
    return Math.random() * this.constructor.spawnSpread;
  }

  // Returns false once every particle has finished, at which point the engine
  // drops this effect.
  step(dt) {
    this.stepShared(dt);

    let anyAlive = false;
    // A plain loop rather than forEach: this runs for every particle of every
    // live effect on every frame, and the callback would be reallocated each time.
    for (const p of this.particles) {
      if (!p.alive) continue;

      // Still waiting to spawn — alive, but not yet moving or visible. Falls
      // through on the frame the delay runs out, so a particle timed to appear
      // as another disappears does so on the same frame.
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay > 0) {
          anyAlive = true;
          continue;
        }
      }
      if (!p.started) {
        p.started = true;
        p.el.style.display = '';
      }

      p.age += dt;
      if (this.stepParticle(p, dt)) {
        anyAlive = true;
      } else {
        p.alive = false;
        container.removeChild(p.el);
      }
    }

    return anyAlive;
  }
}

let runningEffects = [];
let lastTs = 0;

const animate = (ts) => {
  // rAF stalls while the tab is backgrounded; without a clamp the first frame
  // back teleports everything off screen.
  const elapsed = lastTs > 0 ? Math.min((ts - lastTs) / 1000.0, 0.1) : 0.001;
  lastTs = ts;

  runningEffects = runningEffects.filter((e) => e.step(elapsed));

  if (runningEffects.length > 0) {
    requestAnimationFrame(animate);
  } else {
    lastTs = 0; // next run starts fresh rather than against a stale timestamp
  }
};

// --- Bounce ------------------------------------------------------------------

const BOUNCE_GRAVITY = 17.0;
const BOUNCE_REBOUND = 0.9;
const BOUNCE_DAMP = 0.02;
const BOUNCE_SIZE_MIN = 60;
const BOUNCE_SIZE_VAR = 20;
const BOUNCE_VEL_X_MIN = 6.0;
const BOUNCE_VEL_X_VAR = 8.0;
const BOUNCE_VEL_Y_MIN = -35.0;
const BOUNCE_VEL_Y_VAR = 20.0;
const BOUNCE_X = -8.0;
const BOUNCE_X_VAR = 6.0;
const BOUNCE_Y = 50.0;
const BOUNCE_FADE = 1.0;
const BOUNCE_LIFETIME_MIN = 9.0;
const BOUNCE_LIFETIME_VAR = 4.0;

class BounceEffect extends Effect {
  static label = 'Bounce';
  static count = 8;
  static spawnSpread = 0.4;

  initParticle(p) {
    p.x = rand(BOUNCE_X, BOUNCE_X_VAR);
    p.y = BOUNCE_Y;
    p.velX = rand(BOUNCE_VEL_X_MIN, BOUNCE_VEL_X_VAR);
    p.velY = rand(BOUNCE_VEL_Y_MIN, BOUNCE_VEL_Y_VAR);
    p.lifetime = rand(BOUNCE_LIFETIME_MIN, BOUNCE_LIFETIME_VAR);

    const size = rand(BOUNCE_SIZE_MIN, BOUNCE_SIZE_VAR);
    setSize(p, size);
    p.bottom = 100.0 - (size * 100.0 / viewH);
  }

  stepParticle(p, dt) {
    const remaining = p.lifetime - p.age;
    if (remaining <= 0) return false;

    p.velY += dt * BOUNCE_GRAVITY;
    p.velX *= 1.0 - (BOUNCE_DAMP * dt);
    p.velY *= 1.0 - (BOUNCE_DAMP * dt);

    p.x += p.velX * dt;
    p.y += p.velY * dt;

    if (p.y > p.bottom) {
      p.y = p.bottom * 2.0 - p.y;
      p.velY *= -BOUNCE_REBOUND;
    }

    const opacity = remaining < BOUNCE_FADE ? remaining / BOUNCE_FADE : 1.0;
    place(p, p.x, p.y, { opacity });
    return true;
  }
}

// --- Bubble ------------------------------------------------------------------

const BUBBLE_BUOY_MIN = 3.0;
const BUBBLE_BUOY_VAR = 6.0;
const BUBBLE_BROWNIAN = 0.2;
const BUBBLE_SIZE = 80;
const BUBBLE_PULSE_MIN = 0.85;
const BUBBLE_PULSE_MAX = 1.15;
const BUBBLE_PULSE_RATE_MIN = 1.0;
const BUBBLE_PULSE_RATE_VAR = 5.0;
const BUBBLE_Y_MIN = 80.0;
const BUBBLE_Y_VAR = 15.0;
const BUBBLE_GROW = 0.5;
const BUBBLE_BURST_SCALE = 0.1;
const BUBBLE_BURST_DURATION = 0.15;
const BUBBLE_LIFETIME_MIN = 9.0;
const BUBBLE_LIFETIME_VAR = 5.0;

class BubbleEffect extends Effect {
  static label = 'Bubble';
  static count = 8;
  static spawnSpread = 2.0;

  initParticle(p) {
    p.x = Math.random() * 90;
    p.y = rand(BUBBLE_Y_MIN, BUBBLE_Y_VAR);
    p.velX = 0;
    p.pulseDeg = 0;
    p.pulseRate = rand(BUBBLE_PULSE_RATE_MIN, BUBBLE_PULSE_RATE_VAR);
    p.buoy = rand(BUBBLE_BUOY_MIN, BUBBLE_BUOY_VAR);
    p.lifetime = rand(BUBBLE_LIFETIME_MIN, BUBBLE_LIFETIME_VAR);
    p.bursting = false;
    p.burstTime = 0;
    setSize(p, BUBBLE_SIZE);
  }

  stepParticle(p, dt) {
    const remaining = p.lifetime - p.age;

    p.velX += (Math.random() * BUBBLE_BROWNIAN * 2 - BUBBLE_BROWNIAN);
    p.x += p.velX * dt;
    p.y -= p.buoy * dt;

    if (!p.bursting && remaining < BUBBLE_BURST_DURATION) {
      p.bursting = true;
      p.burstTime = 0;
    }

    if (p.bursting) {
      p.burstTime += dt;
      const t = Math.min(p.burstTime / BUBBLE_BURST_DURATION, 1.0);
      const scale = 1.0 + t * (BUBBLE_BURST_SCALE - 1.0);
      const opacity = 1.0 - t;

      place(p, p.x, p.y, { scale, opacity });
      return opacity > 0;
    }

    let scale;
    if (p.age < BUBBLE_GROW) {
      const t = p.age / BUBBLE_GROW;
      scale = 1.0 - (1.0 - t) * (1.0 - t); // ease-out quad
    } else {
      // Pulse oscillates between PULSE_MIN and PULSE_MAX, centered on 1.0.
      // Start at PI/2 so cos(PI/2)=0 → pulseAmt=0.5 → scale=1.0,
      // matching the end of the grow phase with no discontinuity.
      p.pulseDeg += dt * p.pulseRate;
      const pulseAmt = (Math.cos(p.pulseDeg + Math.PI / 2) + 1.0) / 2.0;
      scale = BUBBLE_PULSE_MIN + pulseAmt * (BUBBLE_PULSE_MAX - BUBBLE_PULSE_MIN);
    }

    place(p, p.x, p.y, { scale });
    return true;
  }
}

// --- Spiral ------------------------------------------------------------------

const SPIRAL_RADIUS_MIN = 35.0;
const SPIRAL_RADIUS_VAR = 10.0;
const SPIRAL_SPEED_MIN = 0.8;
const SPIRAL_SPEED_VAR = 1.8;
const SPIRAL_SIZE = 70;
const SPIRAL_CONVERGE_MIN = 0.34;
const SPIRAL_CONVERGE_VAR = 0.29;
const SPIRAL_POP_RADIUS = 3.0;
const SPIRAL_POP_SCALE = 1.8;
const SPIRAL_POP_FADE = 1.5;
const SPIRAL_POP_SPEED_MIN = 15;
const SPIRAL_POP_SPEED_VAR = 10;

class SpiralEffect extends Effect {
  static label = 'Spiral';
  static count = 8;
  static spawnSpread = 0.8;

  initParticle(p) {
    p.angle = Math.random() * Math.PI * 2;
    p.radius = rand(SPIRAL_RADIUS_MIN, SPIRAL_RADIUS_VAR);
    p.speed = rand(SPIRAL_SPEED_MIN, SPIRAL_SPEED_VAR);
    p.converge = rand(SPIRAL_CONVERGE_MIN, SPIRAL_CONVERGE_VAR);
    p.popping = false;
    p.popTime = 0;
    p.popDir = 0;
    p.popStartX = 0;
    p.popStartY = 0;
    p.popSpeed = rand(SPIRAL_POP_SPEED_MIN, SPIRAL_POP_SPEED_VAR);
    setSize(p, SPIRAL_SIZE);
  }

  stepParticle(p, dt) {
    if (!p.popping) {
      p.angle += p.speed * dt;
      p.radius *= Math.pow(p.converge, dt);

      const x = 50 + Math.cos(p.angle) * p.radius;
      const y = 50 + Math.sin(p.angle) * p.radius;

      if (p.radius < SPIRAL_POP_RADIUS) {
        p.popping = true;
        p.popTime = 0;
        p.popDir = p.angle;
        p.popStartX = x;
        p.popStartY = y;
      }

      place(p, x, y);
      return true;
    }

    p.popTime += dt;
    const t = Math.min(p.popTime / SPIRAL_POP_FADE, 1.0);
    const scale = 1.0 + t * (SPIRAL_POP_SCALE - 1.0);
    const opacity = 1.0 - t;
    const dist = p.popSpeed * p.popTime;
    const px = p.popStartX + Math.cos(p.popDir) * dist;
    const py = p.popStartY + Math.sin(p.popDir) * dist;

    place(p, px, py, { scale, opacity });
    return opacity > 0;
  }
}

// --- Rain/confetti -----------------------------------------------------------

const RAIN_VEL_Y_MIN = 11.5;
const RAIN_VEL_Y_VAR = 19.0;
const RAIN_SWAY_AMP = 3.0;
const RAIN_SWAY_FREQ_MIN = 1.5;
const RAIN_SWAY_FREQ_VAR = 2.0;
const RAIN_ROT_SPEED_MIN = 60;
const RAIN_ROT_SPEED_VAR = 180;
const RAIN_SIZE_MIN = 50;
const RAIN_SIZE_VAR = 40;
const RAIN_SPLAT = 0.3;
const RAIN_AFTER_SPLAT_LINGER = 1.3;
const RAIN_AFTER_SPLAT_FADE = 1.3;
const RAIN_BOTTOM = 95;

class RainEffect extends Effect {
  static label = 'Rain';
  static count = 8;
  static spawnSpread = 2.0;

  initParticle(p) {
    p.x = Math.random() * 95;
    p.y = -5;
    p.velY = rand(RAIN_VEL_Y_MIN, RAIN_VEL_Y_VAR);
    p.swayFreq = rand(RAIN_SWAY_FREQ_MIN, RAIN_SWAY_FREQ_VAR);
    p.swayPhase = Math.random() * Math.PI * 2;
    p.rotSpeed = randSign() * rand(RAIN_ROT_SPEED_MIN, RAIN_ROT_SPEED_VAR);
    p.rot = Math.random() * 360;
    p.splatting = false;
    p.splatTime = 0;
    setSize(p, rand(RAIN_SIZE_MIN, RAIN_SIZE_VAR));
  }

  stepParticle(p, dt) {
    if (!p.splatting) {
      p.y += p.velY * dt;
      p.rot += p.rotSpeed * dt;
      const sway = Math.sin(p.swayFreq * (p.y / 10) + p.swayPhase) * RAIN_SWAY_AMP;

      if (p.y >= RAIN_BOTTOM) {
        p.y = RAIN_BOTTOM;
        p.splatting = true;
        p.splatTime = 0;
      }

      place(p, p.x + sway, p.y, { rot: p.rot });
      return true;
    }

    p.splatTime += dt;
    const splatProgress = Math.min(p.splatTime / RAIN_SPLAT, 1.0);
    const scaleX = 1.0 + splatProgress * 0.6;
    const scaleY = 1.0 - splatProgress * 0.4;

    let opacity = 1.0;
    const fadeStart = RAIN_SPLAT + RAIN_AFTER_SPLAT_LINGER;
    if (p.splatTime > fadeStart) {
      opacity = Math.max(0, 1.0 - (p.splatTime - fadeStart) / RAIN_AFTER_SPLAT_FADE);
    }
    if (opacity <= 0) return false;

    place(p, p.x, p.y, { rot: p.rot, scale: scaleX, scaleY, opacity });
    return true;
  }
}

// --- Drift -------------------------------------------------------------------
//
// The ambient one: a slow traverse with fake depth. Size, speed and opacity all
// key off the same `depth` value, so near emoji are big, fast and solid while far
// ones hang back small and dim.

const DRIFT_SIZE_MIN = 28;
const DRIFT_SIZE_VAR = 62;
// Slowest case has to cross ~130vw inside MESSAGE_SHOW_MS, spawn spread included,
// or the stragglers outlive the message that spawned them.
const DRIFT_SPEED_MIN = 8.5;
const DRIFT_SPEED_VAR = 11.0;
const DRIFT_OPACITY_MIN = 0.35;
const DRIFT_OPACITY_VAR = 0.65;
const DRIFT_Y_MIN = 8.0;
const DRIFT_Y_VAR = 74.0;
const DRIFT_BOB_AMP_MIN = 0.8;
const DRIFT_BOB_AMP_VAR = 2.2;
const DRIFT_BOB_FREQ_MIN = 0.25;
const DRIFT_BOB_FREQ_VAR = 0.5;
const DRIFT_MARGIN = 15.0;

class DriftEffect extends Effect {
  static label = 'Drift';
  static count = 10;
  static spawnSpread = 5.0;

  setup() {
    // One direction for the whole event, so it reads as a current rather than noise.
    this.dir = randSign();
  }

  initParticle(p) {
    const depth = Math.random(); // 0 = far away, 1 = close
    p.x = this.dir > 0 ? -DRIFT_MARGIN : 100 + DRIFT_MARGIN;
    p.y = rand(DRIFT_Y_MIN, DRIFT_Y_VAR);
    p.speed = DRIFT_SPEED_MIN + depth * DRIFT_SPEED_VAR;
    p.opacity = DRIFT_OPACITY_MIN + depth * DRIFT_OPACITY_VAR;
    p.bobAmp = rand(DRIFT_BOB_AMP_MIN, DRIFT_BOB_AMP_VAR);
    p.bobFreq = rand(DRIFT_BOB_FREQ_MIN, DRIFT_BOB_FREQ_VAR);
    p.bobPhase = Math.random() * Math.PI * 2;
    setSize(p, DRIFT_SIZE_MIN + depth * DRIFT_SIZE_VAR);
  }

  stepParticle(p, dt) {
    p.x += this.dir * p.speed * dt;
    if (p.x < -DRIFT_MARGIN || p.x > 100 + DRIFT_MARGIN) return false;

    const y = p.y + Math.sin(p.age * p.bobFreq * Math.PI * 2 + p.bobPhase) * p.bobAmp;
    place(p, p.x, y, { opacity: p.opacity });
    return true;
  }
}

// --- Firework ----------------------------------------------------------------
//
// Several shells, each telegraphed by its own launch: an emoji streaks up from
// off the bottom edge, decelerates into its apex, and breaks into a ring of
// sparks. The climb is the point — it tells the eye where to look before anything
// happens there. Shells go up one after another, so the display builds.
//
// Shell count scales with how many emoji the message had: two at minimum, one
// more for every few emoji after that. A message with a lot of emoji becomes a
// longer display rather than one bigger bang.
//
// Roles are assigned by particle index rather than by a phase machine. Particles
// are blocked PER_SHELL at a time; within each block the first is the shell and
// the rest are its sparks. Every particle's spawn delay is set so it appears
// exactly when its phase is due, so the base class's stagger does the sequencing.
//
// Sparks of one shell share an origin and detonate together, so the break forms a
// visible ring rather than a scatter. Drag is exponential, giving the
// characteristic hard snap outward followed by a slow gravity-led droop.

const FIREWORK_BURST_COUNT = 9; // sparks per shell
const FIREWORK_PER_SHELL = FIREWORK_BURST_COUNT + 1; // + the shell itself
const FIREWORK_SHELLS_MIN = 2;
const FIREWORK_SHELLS_MAX = 6;
const FIREWORK_EMOJI_PER_SHELL = 3; // one extra shell per this many emoji
const FIREWORK_ORIGIN_X_MIN = 18.0;
const FIREWORK_ORIGIN_X_VAR = 64.0;
const FIREWORK_ORIGIN_Y_MIN = 20.0;
const FIREWORK_ORIGIN_Y_VAR = 32.0;
const FIREWORK_SPEED_MIN = 18.0;
const FIREWORK_SPEED_VAR = 12.0;
// Velocity retained per second. Higher is softer: the ring keeps gliding outward
// instead of snapping to its full radius in the first half second.
const FIREWORK_DRAG = 0.45;
// Also damped by drag, so sparks settle to a slow downward drift rather than
// accelerating out of frame. Terminal speed is roughly GRAVITY / -ln(DRAG), and
// over a 4s life that drift is what decides how far the break sags — keep it low.
const FIREWORK_GRAVITY = 5.0;
const FIREWORK_SIZE_MIN = 55; // matched to Bounce, which reads well at this scale
const FIREWORK_SIZE_VAR = 25;
const FIREWORK_LIFETIME_MIN = 3.2;
const FIREWORK_LIFETIME_VAR = 1.4;
const FIREWORK_FADE_FROM = 0.35; // fraction of life before fading starts
const FIREWORK_SHRINK = 0.2; // how much a spark shrinks over its life
const FIREWORK_JITTER = 0.6; // fraction of the even angular spacing

// Launch
const FIREWORK_LAUNCH_MIN = 0.85; // seconds from the bottom edge to the apex
const FIREWORK_LAUNCH_VAR = 0.3;
const FIREWORK_START_Y = 108.0; // just off the bottom
// How far a shell may wander horizontally on the way up (centred, so ±half).
// Keep it small — a mortar climbs near-vertically, and picking the launch point
// independently of the apex gives a shell that flies diagonally across frame.
const FIREWORK_LAUNCH_DRIFT = 16.0;
const FIREWORK_SHELL_SIZE = 46; // smaller than a spark — a compact thing that blooms
const FIREWORK_SHELL_SCALE = 0.75;
const FIREWORK_SHELL_SPIN = 150;
const FIREWORK_SHELL_FLICKER_RATE = 22.0; // fuse sparkle, radians/sec
const FIREWORK_SHELL_FLICKER_DEPTH = 0.25;
const FIREWORK_SHELL_GAP_MIN = 0.45; // between one launch and the next
const FIREWORK_SHELL_GAP_VAR = 0.55;

class FireworkEffect extends Effect {
  static label = 'Firework';
  static spawnSpread = 0; // sequencing is deterministic, see particleDelay

  setup() {
    this.shells = Math.min(
      FIREWORK_SHELLS_MIN + Math.floor(this.emojis.length / FIREWORK_EMOJI_PER_SHELL),
      FIREWORK_SHELLS_MAX,
    );

    // Each shell is independent: its own launch time, climb duration and apex.
    let at = 0;
    this.shellData = [];
    for (let s = 0; s < this.shells; s++) {
      const originX = rand(FIREWORK_ORIGIN_X_MIN, FIREWORK_ORIGIN_X_VAR);
      this.shellData.push({
        at,
        launch: rand(FIREWORK_LAUNCH_MIN, FIREWORK_LAUNCH_VAR),
        originX,
        originY: rand(FIREWORK_ORIGIN_Y_MIN, FIREWORK_ORIGIN_Y_VAR),
        startX: originX + rand(-FIREWORK_LAUNCH_DRIFT / 2, FIREWORK_LAUNCH_DRIFT),
      });
      at += rand(FIREWORK_SHELL_GAP_MIN, FIREWORK_SHELL_GAP_VAR);
    }
  }

  particleCount() {
    return this.shells * FIREWORK_PER_SHELL;
  }

  shellFor(i) {
    return this.shellData[Math.floor(i / FIREWORK_PER_SHELL)];
  }

  particleDelay(i) {
    const shell = this.shellFor(i);
    // Slot 0 is the shell itself and leaves first; its sparks wait out the climb.
    return (i % FIREWORK_PER_SHELL === 0) ? shell.at : shell.at + shell.launch;
  }

  initParticle(p, i) {
    p.shellData = this.shellFor(i);
    const slot = i % FIREWORK_PER_SHELL;

    if (slot === 0) {
      p.isShell = true;
      setSize(p, FIREWORK_SHELL_SIZE);
      return;
    }

    p.isShell = false;
    // Spread evenly around the circle, then jitter, so the break stays round
    // without looking mechanical.
    const spacing = (Math.PI * 2) / FIREWORK_BURST_COUNT;
    const angle = (slot - 1) * spacing
      + rand(-spacing * FIREWORK_JITTER / 2, spacing * FIREWORK_JITTER);
    const speed = rand(FIREWORK_SPEED_MIN, FIREWORK_SPEED_VAR);

    p.x = p.shellData.originX;
    p.y = p.shellData.originY;
    p.velX = Math.cos(angle) * speed;
    p.velY = Math.sin(angle) * speed * 0.8; // slightly flattened, reads better on 16:9
    p.lifetime = rand(FIREWORK_LIFETIME_MIN, FIREWORK_LIFETIME_VAR);
    setSize(p, rand(FIREWORK_SIZE_MIN, FIREWORK_SIZE_VAR));
  }

  stepParticle(p, dt) {
    if (p.isShell) return this.stepShell(p);

    const t = p.age / p.lifetime;
    if (t >= 1) return false;

    const drag = Math.pow(FIREWORK_DRAG, dt);
    p.velX *= drag;
    p.velY *= drag;
    p.velY += FIREWORK_GRAVITY * dt;

    p.x += p.velX * dt;
    p.y += p.velY * dt;

    const opacity = t < FIREWORK_FADE_FROM
      ? 1.0
      : 1.0 - (t - FIREWORK_FADE_FROM) / (1.0 - FIREWORK_FADE_FROM);
    place(p, p.x, p.y, { scale: 1.0 - t * FIREWORK_SHRINK, opacity });
    return true;
  }

  // The telegraph: rises from off the bottom edge and slows into the apex, like a
  // mortar running out of momentum. Dies exactly as its own break spawns.
  stepShell(p) {
    const { launch, startX, originX, originY } = p.shellData;
    const t = p.age / launch;
    if (t >= 1) return false;

    const ease = 1.0 - (1.0 - t) * (1.0 - t); // ease-out quad — decelerate into the apex
    const x = startX + (originX - startX) * ease;
    const y = FIREWORK_START_Y + (originY - FIREWORK_START_Y) * ease;

    const flicker = 1.0 - FIREWORK_SHELL_FLICKER_DEPTH
      * (Math.sin(p.age * FIREWORK_SHELL_FLICKER_RATE) + 1.0) / 2.0;

    place(p, x, y, {
      scale: FIREWORK_SHELL_SCALE,
      rot: p.age * FIREWORK_SHELL_SPIN,
      opacity: flicker,
    });
    return true;
  }
}

// --- Swoop -------------------------------------------------------------------
//
// Fakes a z-axis: starts tiny near the centre and rushes the camera on a cubic
// curve, so it crawls while "distant" then blows past in the last few frames.
// Short, loud, and over quickly — the opposite end of the range from Drift.
//
// The cluster scatters around the centre *along the rays it will fly out on*, so
// the whole group reads as one thing coming apart. Scattering position and
// direction independently makes them cross over each other through the middle.

const SWOOP_START_SPREAD = 10.0; // max offset from centre, along the fly-out ray
const SWOOP_SIZE = 70;
const SWOOP_SCALE_MIN = 0.08;
const SWOOP_SCALE_MAX = 3.6;
const SWOOP_EXIT_MARGIN = 16.0; // clearance past the edge, so a big one fully leaves
const SWOOP_DURATION_MIN = 2.1;
const SWOOP_DURATION_VAR = 0.8;
const SWOOP_SPIN = 45;
const SWOOP_FADE_IN = 0.15;
const SWOOP_FADE_OUT = 0.2;
const SWOOP_STAGGER = 0.18; // gap between one launch and the next
const SWOOP_STAGGER_JITTER = 0.08; // so the trickle isn't metronomic
// Ceiling on the whole spawn sequence. Without it a message that's mostly emoji
// would trickle for half a minute; past this the gaps tighten instead.
const SWOOP_SPAWN_WINDOW_MAX = 4.0;

class SwoopEffect extends Effect {
  static label = 'Swoop';
  static count = 8;
  static spawnSpread = 0; // stagger is deterministic, see particleDelay

  // A steady trickle rather than a clump: they arrive one after another, so the
  // effect reads as a sustained flurry instead of a single volley.
  particleDelay(i) {
    const step = Math.min(SWOOP_STAGGER, SWOOP_SPAWN_WINDOW_MAX / Math.max(this.count - 1, 1));
    return i * step + Math.random() * SWOOP_STAGGER_JITTER;
  }

  initParticle(p) {
    p.angle = Math.random() * Math.PI * 2;
    // Offset along the same ray it flies out on, so it only ever moves outward.
    const offset = Math.random() * SWOOP_START_SPREAD;
    p.startX = 50 + Math.cos(p.angle) * offset;
    p.startY = 50 + vw2vh(Math.sin(p.angle) * offset);
    p.distance = this.escapeDistance(p.startX, p.startY, p.angle);
    p.duration = rand(SWOOP_DURATION_MIN, SWOOP_DURATION_VAR);
    p.spin = randSign() * SWOOP_SPIN;
    setSize(p, SWOOP_SIZE);
  }

  // How far along its ray a particle has to travel to clear the viewport. Giving
  // every particle a fixed travel distance instead means the ones aimed up or
  // down leave frame early and small — the screen is shorter than it is wide, so
  // a vertical exit is a shorter trip than a horizontal one.
  escapeDistance(startX, startY, angle) {
    const dx = Math.cos(angle);
    const dy = vw2vh(Math.sin(angle)); // vh travelled per unit of ray distance

    const toX = Math.abs(dx) < 1e-6
      ? Infinity
      : ((dx > 0 ? 100 + SWOOP_EXIT_MARGIN : -SWOOP_EXIT_MARGIN) - startX) / dx;
    const toY = Math.abs(dy) < 1e-6
      ? Infinity
      : ((dy > 0 ? 100 + SWOOP_EXIT_MARGIN : -SWOOP_EXIT_MARGIN) - startY) / dy;

    return Math.min(toX, toY);
  }

  stepParticle(p) {
    const t = p.age / p.duration;
    if (t >= 1) return false;

    const k = t * t * t; // cubic ease-in — distance and scale accelerate together
    const scale = SWOOP_SCALE_MIN + k * (SWOOP_SCALE_MAX - SWOOP_SCALE_MIN);
    const dist = k * p.distance;
    const x = p.startX + Math.cos(p.angle) * dist;
    const y = p.startY + vw2vh(Math.sin(p.angle) * dist);

    let opacity = 1.0;
    if (t < SWOOP_FADE_IN) opacity = t / SWOOP_FADE_IN;
    else if (t > 1 - SWOOP_FADE_OUT) opacity = (1 - t) / SWOOP_FADE_OUT;

    place(p, x, y, { scale, rot: p.age * p.spin, opacity });
    return true;
  }
}

// --- Vortex ------------------------------------------------------------------
//
// A column of emoji orbiting a shared vertical axis that drifts sideways. There's
// no z-index to play with (the whole layer sits behind the messages), so depth is
// faked entirely with scale and opacity driven off cos(phase).

const VORTEX_AXIS_X_MIN = 30.0;
const VORTEX_AXIS_X_VAR = 40.0;
const VORTEX_DRIFT_MIN = 1.0;
const VORTEX_DRIFT_VAR = 2.5;
const VORTEX_AXIS_BOUND_LOW = 15.0;
const VORTEX_AXIS_BOUND_HIGH = 85.0;
const VORTEX_RADIUS_MIN = 8.0;
const VORTEX_RADIUS_VAR = 10.0;
const VORTEX_SPIN_MIN = 1.4;
const VORTEX_SPIN_VAR = 1.6;
const VORTEX_RISE_MIN = 8.0;
const VORTEX_RISE_VAR = 7.0;
const VORTEX_SIZE = 55;
const VORTEX_START_Y_MIN = 100.0;
const VORTEX_START_Y_VAR = 25.0;
const VORTEX_SCALE_MIN = 0.65;
const VORTEX_SCALE_VAR = 0.7;
const VORTEX_OPACITY_MIN = 0.4;
const VORTEX_OPACITY_VAR = 0.6;
const VORTEX_FADE_TOP = 18.0; // vh over which it fades out at the top

class VortexEffect extends Effect {
  static label = 'Vortex';
  static count = 12;
  static spawnSpread = 1.5;

  setup() {
    this.axisX = rand(VORTEX_AXIS_X_MIN, VORTEX_AXIS_X_VAR);
    this.drift = randSign() * rand(VORTEX_DRIFT_MIN, VORTEX_DRIFT_VAR);
  }

  stepShared(dt) {
    this.axisX += this.drift * dt;
    if (this.axisX < VORTEX_AXIS_BOUND_LOW || this.axisX > VORTEX_AXIS_BOUND_HIGH) {
      this.drift = -this.drift;
      this.axisX = Math.min(Math.max(this.axisX, VORTEX_AXIS_BOUND_LOW), VORTEX_AXIS_BOUND_HIGH);
    }
  }

  initParticle(p) {
    p.phase = Math.random() * Math.PI * 2;
    p.radius = rand(VORTEX_RADIUS_MIN, VORTEX_RADIUS_VAR);
    p.spin = rand(VORTEX_SPIN_MIN, VORTEX_SPIN_VAR);
    p.rise = rand(VORTEX_RISE_MIN, VORTEX_RISE_VAR);
    p.y = rand(VORTEX_START_Y_MIN, VORTEX_START_Y_VAR);
    setSize(p, VORTEX_SIZE);
  }

  stepParticle(p, dt) {
    p.phase += p.spin * dt;
    p.y -= p.rise * dt;
    if (p.y < -VORTEX_FADE_TOP) return false;

    // Funnel shape: narrow at the base, flaring as it rises.
    const widen = 0.45 + (1.0 - Math.min(Math.max(p.y, 0) / 100, 1)) * 0.55;
    const near = (Math.cos(p.phase) + 1.0) / 2.0; // 0 = far side, 1 = near side

    const x = this.axisX + Math.sin(p.phase) * p.radius * widen;
    const scale = VORTEX_SCALE_MIN + near * VORTEX_SCALE_VAR;
    let opacity = VORTEX_OPACITY_MIN + near * VORTEX_OPACITY_VAR;
    if (p.y < 0) {
      opacity *= 1.0 - (-p.y / VORTEX_FADE_TOP);
    }

    place(p, x, p.y, { scale, opacity });
    return true;
  }
}

// --- Worm --------------------------------------------------------------------
//
// A conga line along a shared curve. Every particle walks the *same* path
// function; the only difference is that particle i starts SPACING * i seconds
// later, so it traces exactly where its predecessor has been. No trail buffer
// needed — the stagger does all the work.
//
// The pulse falls out of that for free. Adding a sine to the *along-path*
// position makes the body surge and ease rather than travel at a constant rate,
// and because each segment samples the same function at its own age, the gaps
// between neighbours open and close as the wave passes down the body. That's
// peristalsis: no per-segment bookkeeping, just one term in path().

const WORM_SPACING = 0.13; // seconds between segments
const WORM_SPEED_MIN = 17.0;
const WORM_SPEED_VAR = 9.0;
const WORM_BASE_Y_MIN = 22.0;
const WORM_BASE_Y_VAR = 48.0;
const WORM_AMP_A_MIN = 8.0;
const WORM_AMP_A_VAR = 10.0;
const WORM_FREQ_A_MIN = 0.85;
const WORM_FREQ_A_VAR = 0.6;
const WORM_AMP_B_MIN = 3.0;
const WORM_AMP_B_VAR = 6.0;
const WORM_FREQ_B_MIN = 2.0;
const WORM_FREQ_B_VAR = 1.3;
const WORM_SIZE_HEAD = 68;
const WORM_SIZE_TAIL = 34;
const WORM_OPACITY_TAIL = 0.55;
const WORM_MARGIN = 14.0;
const WORM_TILT = 0.55; // emoji are upright, so only lean part way into the curve
// Wavelength, expressed in segments rather than as a rate: one compression wave
// per this many segments. Since segments are spaced evenly in time, a longer
// wavelength is automatically a slower pulse, and it stays consistent whatever
// length the worm happens to be.
const WORM_PULSE_SEGMENTS_MIN = 14;
const WORM_PULSE_SEGMENTS_VAR = 8;
// Peak surge as a fraction of mean speed. Must stay below 1: at 1 the body comes
// to a true dead stop each cycle, and above it the segments crawl backwards.
// This close to the limit the body bunches hard at the trough — which is the
// point, but it's why the facing angle is taken from the un-surged line below.
const WORM_PULSE_SURGE = 0.9;
const WORM_PULSE_BULGE = 0.12; // how much a segment fattens as it bunches up

class WormEffect extends Effect {
  static label = 'Worm';
  static count = 10;
  // Segments are strung out in time, not scattered in space, so unlike the other
  // effects a big emoji count here means one absurdly long worm. Cap it: beyond
  // this the tail is still entering as the head leaves.
  static maxCount = 26;
  static spawnSpread = 0; // the stagger is deterministic, see particleDelay

  setup() {
    this.dir = randSign();
    this.startX = this.dir > 0 ? -WORM_MARGIN : 100 + WORM_MARGIN;
    this.speed = rand(WORM_SPEED_MIN, WORM_SPEED_VAR);
    this.baseY = rand(WORM_BASE_Y_MIN, WORM_BASE_Y_VAR);
    // Two summed sines so the curve doesn't read as a plain sine wave.
    this.ampA = rand(WORM_AMP_A_MIN, WORM_AMP_A_VAR);
    this.freqA = rand(WORM_FREQ_A_MIN, WORM_FREQ_A_VAR);
    this.ampB = rand(WORM_AMP_B_MIN, WORM_AMP_B_VAR);
    this.freqB = rand(WORM_FREQ_B_MIN, WORM_FREQ_B_VAR);
    this.phase = Math.random() * Math.PI * 2;

    const wavelength = rand(WORM_PULSE_SEGMENTS_MIN, WORM_PULSE_SEGMENTS_VAR) * WORM_SPACING;
    this.pulseOmega = (Math.PI * 2) / wavelength;
    this.pulsePhase = Math.random() * Math.PI * 2;
    // Sized against omega so the surge term's derivative never exceeds the mean
    // speed — otherwise the worm would briefly reverse.
    this.pulseAmp = WORM_PULSE_SURGE * this.speed / this.pulseOmega;
  }

  particleDelay(i) {
    return i * WORM_SPACING;
  }

  // The line the body travels along, before the pulse is applied: a steady
  // crawl with the vertical undulation on top.
  baseLine(t) {
    return {
      x: this.startX + this.dir * this.speed * t,
      y: this.baseY
        + Math.sin(this.freqA * t + this.phase) * this.ampA
        + Math.sin(this.freqB * t + this.phase * 1.7) * this.ampB,
    };
  }

  // Position along the shared curve at time t. Deterministic, so a particle `d`
  // seconds behind sits exactly where the one ahead of it was `d` seconds ago.
  path(t) {
    const base = this.baseLine(t);
    const surge = Math.sin(this.pulseOmega * t + this.pulsePhase) * this.pulseAmp;
    return { x: base.x + this.dir * surge, y: base.y };
  }

  initParticle(p, i) {
    const taper = i / Math.max(this.count - 1, 1);
    p.opacity = 1.0 - taper * (1.0 - WORM_OPACITY_TAIL);
    setSize(p, WORM_SIZE_HEAD - taper * (WORM_SIZE_HEAD - WORM_SIZE_TAIL));
  }

  stepParticle(p) {
    const { x, y } = this.path(p.age);
    if (x < -WORM_MARGIN * 2 || x > 100 + WORM_MARGIN * 2) return false;

    // Face along the un-surged line, not the instantaneous direction of travel.
    // Near the bottom of a surge the body barely advances while the undulation
    // keeps going, so the true tangent swings almost vertical — segments would
    // pitch hard every cycle. The underlying line keeps the facing steady.
    // Emoji are upright glyphs, so only lean part of the way regardless, or they
    // read as drunk rather than crawling.
    // Both components are taken relative to the direction of travel, which folds
    // the angle into [-90°, 90°] — the body is an undirected line, and a
    // leftward worm would otherwise come out near atan2's ±180° and get rotated
    // onto its side.
    const here = this.baseLine(p.age);
    const ahead = this.baseLine(p.age + 0.05);
    const rot = Math.atan2(
      vh2vw(ahead.y - here.y) * this.dir,
      (ahead.x - here.x) * this.dir,
    ) * WORM_TILT * 180 / Math.PI;

    // Fattest where the body is most bunched up — the surge is slowest when
    // cos is -1, which is exactly where the segments have closed up.
    const scale = 1.0 - WORM_PULSE_BULGE * Math.cos(this.pulseOmega * p.age + this.pulsePhase);

    place(p, x, y, { rot, scale, opacity: p.opacity });
    return true;
  }
}

// --- Effect registry ---------------------------------------------------------

const animations = [
  BounceEffect,
  BubbleEffect,
  SpiralEffect,
  RainEffect,
  DriftEffect,
  FireworkEffect,
  SwoopEffect,
  VortexEffect,
  WormEffect,
];

// --- Emoji spawner -----------------------------------------------------------

// Takes every emoji in one message at once: effects scale themselves to how many
// there are, and spread them across their particles. Accepts a bare string too,
// for a single emoji.
const animateEmojis = (emojis, effect) => {
  const triggerAnimationFrame = (runningEffects.length === 0);

  const EffectClass = effect || animations[Math.floor(Math.random() * animations.length)];
  runningEffects.push(new EffectClass(emojis));

  if (triggerAnimationFrame) {
    requestAnimationFrame(animate);
  }
};
