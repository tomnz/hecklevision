// --- Core animation engine ---------------------------------------------------

class AnimatedEl {
  constructor(el, stepFn) {
    this.el = el;
    this.stepFn = stepFn; // (elapsed) => boolean — true = alive, false = done
  }
}

class Animation {
  constructor(stepFactory, options = {}) {
    this.stepFactory = stepFactory; // (el) => (elapsed) => boolean
    this.spawnSpread = options.spawnSpread ?? 2.0;
    this.count = options.count ?? 6;
  }
}

let animatedEls = [];
const container = document.getElementById('animatedEmojis');

const animate = (lastTs) => (ts) => {
  let elapsed = 0.001;
  if (lastTs > 0) {
    elapsed = (ts - lastTs) / 1000.0;
  }

  const alive = [];
  animatedEls.forEach((a) => {
    if (a.stepFn(elapsed)) {
      alive.push(a);
    } else {
      container.removeChild(a.el);
    }
  });
  animatedEls = alive;

  if (animatedEls.length > 0) {
    requestAnimationFrame(animate(ts));
  }
};

const w = () => window.innerWidth;
const h = () => window.innerHeight;

// --- Bounce ------------------------------------------------------------------

const BOUNCE_GRAVITY = 22.0;
const BOUNCE_REBOUND = 0.9;
const BOUNCE_DAMP = 0.02;
const BOUNCE_SIZE_MIN = 60;
const BOUNCE_SIZE_VAR = 20;
const BOUNCE_VEL_X_MIN = 8.0;
const BOUNCE_VEL_X_VAR = 10.0;
const BOUNCE_VEL_Y_MIN = -40.0;
const BOUNCE_VEL_Y_VAR = 20.0;
const BOUNCE_X = -8.0;
const BOUNCE_X_VAR = 6.0;
const BOUNCE_Y = 50.0;
const BOUNCE_FADE = 1.0;
const BOUNCE_LIFETIME_MIN = 7.0;
const BOUNCE_LIFETIME_VAR = 3.0;

const animateBounce = (el) => {
  let x = BOUNCE_X + Math.random() * BOUNCE_X_VAR;
  let y = BOUNCE_Y;
  let velX = BOUNCE_VEL_X_MIN + Math.random() * BOUNCE_VEL_X_VAR;
  let velY = BOUNCE_VEL_Y_MIN + Math.random() * BOUNCE_VEL_Y_VAR;
  const size = BOUNCE_SIZE_MIN + Math.random() * BOUNCE_SIZE_VAR;
  const lifetime = BOUNCE_LIFETIME_MIN + Math.random() * BOUNCE_LIFETIME_VAR;
  let age = 0;

  el.style.fontSize = `${size}px`;
  el.style.height = `${size}px`;
  el.style.width = `${size}px`;

  const bottom = 100.0 - (size * 100.0 / h());

  return (elapsed) => {
    age += elapsed;
    const remaining = lifetime - age;
    if (remaining <= 0) return false;

    velY += elapsed * BOUNCE_GRAVITY;
    velX *= 1.0 - (BOUNCE_DAMP * elapsed);
    velY *= 1.0 - (BOUNCE_DAMP * elapsed);

    x += velX * elapsed;
    y += velY * elapsed;

    if (y > bottom) {
      y = bottom * 2.0 - y;
      velY *= -BOUNCE_REBOUND;
    }

    let opacity = 1.0;
    if (remaining < BOUNCE_FADE) {
      opacity = remaining / BOUNCE_FADE;
    }

    el.style.transform = `translate(${x}vw, ${y}vh)`;
    el.style.opacity = `${opacity}`;
    return true;
  };
};

// --- Bubble ------------------------------------------------------------------

const BUBBLE_BUOY_MIN = 4.0;
const BUBBLE_BUOY_VAR = 8.0;
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
const BUBBLE_LIFETIME_MIN = 7.0;
const BUBBLE_LIFETIME_VAR = 4.0;

const animateBubble = (el) => {
  let x = Math.random() * 90;
  let y = BUBBLE_Y_MIN + Math.random() * BUBBLE_Y_VAR;
  let velX = 0;
  let pulseDeg = 0;
  const pulseRate = BUBBLE_PULSE_RATE_MIN + Math.random() * BUBBLE_PULSE_RATE_VAR;
  const buoy = BUBBLE_BUOY_MIN + Math.random() * BUBBLE_BUOY_VAR;
  const lifetime = BUBBLE_LIFETIME_MIN + Math.random() * BUBBLE_LIFETIME_VAR;
  let age = 0;
  let bursting = false;
  let burstTime = 0;

  el.style.fontSize = `${BUBBLE_SIZE}px`;
  el.style.height = `${BUBBLE_SIZE}px`;
  el.style.width = `${BUBBLE_SIZE}px`;

  return (elapsed) => {
    age += elapsed;
    const remaining = lifetime - age;

    velX += (Math.random() * BUBBLE_BROWNIAN * 2 - BUBBLE_BROWNIAN);
    x += velX * elapsed;
    y -= buoy * elapsed;

    if (!bursting && remaining < BUBBLE_BURST_DURATION) {
      bursting = true;
      burstTime = 0;
    }

    if (bursting) {
      burstTime += elapsed;
      const t = Math.min(burstTime / BUBBLE_BURST_DURATION, 1.0);
      const scale = 1.0 + t * (BUBBLE_BURST_SCALE - 1.0);
      const opacity = 1.0 - t;

      el.style.transform = `translate(${x}vw, ${y}vh) scale(${scale})`;
      el.style.opacity = `${opacity}`;
      return opacity > 0;
    }

    let scale;
    if (age < BUBBLE_GROW) {
      const t = age / BUBBLE_GROW;
      scale = 1.0 - (1.0 - t) * (1.0 - t); // ease-out quad
    } else {
      // Pulse oscillates between PULSE_MIN and PULSE_MAX, centered on 1.0.
      // Start at PI/2 so cos(PI/2)=0 → pulseAmt=0.5 → scale=1.0,
      // matching the end of the grow phase with no discontinuity.
      pulseDeg += elapsed * pulseRate;
      const pulseAmt = (Math.cos(pulseDeg + Math.PI / 2) + 1.0) / 2.0;
      scale = BUBBLE_PULSE_MIN + pulseAmt * (BUBBLE_PULSE_MAX - BUBBLE_PULSE_MIN);
    }

    el.style.transform = `translate(${x}vw, ${y}vh) scale(${scale})`;
    el.style.opacity = '1';
    return true;
  };
};

// --- Spiral ------------------------------------------------------------------

const SPIRAL_RADIUS_MIN = 35.0;
const SPIRAL_RADIUS_VAR = 10.0;
const SPIRAL_SPEED_MIN = 0.8;
const SPIRAL_SPEED_VAR = 1.8;
const SPIRAL_SIZE = 70;
const SPIRAL_CONVERGE_MIN = 0.25;
const SPIRAL_CONVERGE_VAR = 0.3;
const SPIRAL_POP_RADIUS = 3.0;
const SPIRAL_POP_SCALE = 1.8;
const SPIRAL_POP_FADE = 1.2;
const SPIRAL_POP_SPEED_MIN = 15;
const SPIRAL_POP_SPEED_VAR = 10;

const animateSpiral = (el) => {
  let angle = Math.random() * Math.PI * 2;
  let radius = SPIRAL_RADIUS_MIN + Math.random() * SPIRAL_RADIUS_VAR;
  const speed = SPIRAL_SPEED_MIN + Math.random() * SPIRAL_SPEED_VAR;
  const converge = SPIRAL_CONVERGE_MIN + Math.random() * SPIRAL_CONVERGE_VAR;
  let popping = false;
  let popTime = 0;
  let popDir = 0;
  let popStartX = 0;
  let popStartY = 0;
  const popSpeed = SPIRAL_POP_SPEED_MIN + Math.random() * SPIRAL_POP_SPEED_VAR;

  el.style.fontSize = `${SPIRAL_SIZE}px`;
  el.style.height = `${SPIRAL_SIZE}px`;
  el.style.width = `${SPIRAL_SIZE}px`;

  return (elapsed) => {
    if (!popping) {
      angle += speed * elapsed;
      radius *= Math.pow(converge, elapsed);

      const x = 50 + Math.cos(angle) * radius;
      const y = 50 + Math.sin(angle) * radius;

      if (radius < SPIRAL_POP_RADIUS) {
        popping = true;
        popTime = 0;
        popDir = angle;
        popStartX = x;
        popStartY = y;
      }

      el.style.transform = `translate(${x}vw, ${y}vh)`;
      el.style.opacity = '1';
      return true;
    }

    popTime += elapsed;
    const t = Math.min(popTime / SPIRAL_POP_FADE, 1.0);
    const scale = 1.0 + t * (SPIRAL_POP_SCALE - 1.0);
    const opacity = 1.0 - t;
    const dist = popSpeed * popTime;
    const px = popStartX + Math.cos(popDir) * dist;
    const py = popStartY + Math.sin(popDir) * dist;

    el.style.transform = `translate(${px}vw, ${py}vh) scale(${scale})`;
    el.style.opacity = `${opacity}`;
    return opacity > 0;
  };
};

// --- Rain/confetti -----------------------------------------------------------

const RAIN_VEL_Y_MIN = 15.0;
const RAIN_VEL_Y_VAR = 25.0;
const RAIN_SWAY_AMP = 3.0;
const RAIN_SWAY_FREQ_MIN = 1.5;
const RAIN_SWAY_FREQ_VAR = 2.0;
const RAIN_ROT_SPEED_MIN = 60;
const RAIN_ROT_SPEED_VAR = 180;
const RAIN_SIZE_MIN = 50;
const RAIN_SIZE_VAR = 40;
const RAIN_SPLAT = 0.3;
const RAIN_AFTER_SPLAT_LINGER = 1.0;
const RAIN_AFTER_SPLAT_FADE = 1.0;

const animateRain = (el) => {
  const x = Math.random() * 95;
  let y = -5;
  const velY = RAIN_VEL_Y_MIN + Math.random() * RAIN_VEL_Y_VAR;
  const swayFreq = RAIN_SWAY_FREQ_MIN + Math.random() * RAIN_SWAY_FREQ_VAR;
  const swayPhase = Math.random() * Math.PI * 2;
  const rotSpeed = (Math.random() < 0.5 ? 1 : -1) * (RAIN_ROT_SPEED_MIN + Math.random() * RAIN_ROT_SPEED_VAR);
  const size = RAIN_SIZE_MIN + Math.random() * RAIN_SIZE_VAR;
  let rot = Math.random() * 360;
  let splatting = false;
  let splatTime = 0;
  const bottom = 95;

  el.style.fontSize = `${size}px`;
  el.style.height = `${size}px`;
  el.style.width = `${size}px`;

  return (elapsed) => {
    if (!splatting) {
      y += velY * elapsed;
      rot += rotSpeed * elapsed;
      const sway = Math.sin(swayFreq * (y / 10) + swayPhase) * RAIN_SWAY_AMP;

      if (y >= bottom) {
        y = bottom;
        splatting = true;
        splatTime = 0;
      }

      el.style.transform = `translate(${x + sway}vw, ${y}vh) rotate(${rot}deg)`;
    } else {
      splatTime += elapsed;
      const splatProgress = Math.min(splatTime / RAIN_SPLAT, 1.0);
      const scaleX = 1.0 + splatProgress * 0.6;
      const scaleY = 1.0 - splatProgress * 0.4;
      el.style.transform = `translate(${x}vw, ${y}vh) rotate(${rot}deg) scale(${scaleX}, ${scaleY})`;
    }

    let opacity = 1.0;
    if (splatting) {
      const fadeStart = RAIN_SPLAT + RAIN_AFTER_SPLAT_LINGER;
      if (splatTime > fadeStart) {
        opacity = Math.max(0, 1.0 - (splatTime - fadeStart) / RAIN_AFTER_SPLAT_FADE);
      }
      if (opacity <= 0) return false;
    }
    el.style.opacity = `${opacity}`;
    return true;
  };
};

// --- Animation definitions ---------------------------------------------------

const animations = [
  new Animation(animateBounce, { spawnSpread: 0.3 }),
  new Animation(animateBubble, { spawnSpread: 1.5 }),
  new Animation(animateSpiral, { spawnSpread: 0.6 }),
  new Animation(animateRain,   { spawnSpread: 1.5 }),
];

// --- Emoji spawner -----------------------------------------------------------

const animateEmoji = (emojiHTML, animation) => {
  const triggerAnimationFrame = (animatedEls.length === 0);

  if (!animation) {
    animation = animations[Math.floor(Math.random() * animations.length)];
  }

  for (let i = 0; i < animation.count; i++) {
    const delay = Math.random() * animation.spawnSpread;

    const el = document.createElement('div');
    el.classList.add('animatedEmoji');
    el.innerHTML = emojiHTML;
    el.style.display = 'none';
    container.appendChild(el);

    const innerStep = animation.stepFactory(el);
    let delayRemaining = delay;

    const step = (elapsed) => {
      if (delayRemaining > 0) {
        delayRemaining -= elapsed;
        return true;
      }
      if (el.style.display === 'none') {
        el.style.display = '';
      }
      return innerStep(elapsed);
    };

    animatedEls.push(new AnimatedEl(el, step));
  }

  if (triggerAnimationFrame) {
    requestAnimationFrame(animate(0));
  }
};
