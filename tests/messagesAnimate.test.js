// messagesAnimate.js drives the DOM directly and has no exports, so it's loaded
// into a vm context with a stub `document` (same approach as quips.test.js) and
// its effects are stepped by hand.
//
// These are mostly invariants rather than exact values: the effects are heavily
// randomised, so each one is run several times and checked for things that
// should never happen at any setting — NaN positions, particles that outlive
// their effect, elements left in the DOM, motion that reverses direction.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../static/messagesAnimate.js'), 'utf8');

// addEventListener is here because the engine caches the viewport size and
// refreshes it on resize.
const VIEWPORT = { innerWidth: 1920, innerHeight: 1080, addEventListener() {} };
const DT = 1 / 60;
const RUNS = 8; // per effect, to cover the randomisation
const MAX_SECONDS = 60; // anything still going by here is stuck

// A fresh engine per test, so leaked elements can't carry between them.
const makeEngine = () => {
  const live = new Set();
  const container = {
    appendChild: (el) => live.add(el),
    removeChild: (el) => {
      assert.ok(live.has(el), 'removeChild called on an element not in the container');
      live.delete(el);
    },
  };
  const frames = [];
  const sandbox = {
    document: {
      getElementById: () => container,
      createElement: () => ({ style: {}, classList: { add() {} }, innerHTML: '' }),
    },
    window: VIEWPORT,
    requestAnimationFrame: (fn) => frames.push(fn),
    Math,
    console,
  };
  const ctx = vm.createContext(sandbox);
  const api = vm.runInContext(`${SOURCE}\n;({ animations, animateEmojis })`, sandbox);
  // ctx is handed back so a test can peek at module-level state (the rAF loop
  // and its effect list aren't exported).
  return { ...api, live, frames, ctx };
};

const emojiList = (n) => Array.from({ length: n }, (_, i) => `<i>${i}</i>`);

const parse = (transform) => {
  const move = /translate\((-?[\d.e-]+)vw, (-?[\d.e-]+)vh\)/.exec(transform);
  const rot = /rotate\((-?[\d.e-]+)deg\)/.exec(transform);
  const scale = /scale\((-?[\d.e-]+)(?:, (-?[\d.e-]+))?\)/.exec(transform);
  return {
    x: parseFloat(move[1]),
    y: parseFloat(move[2]),
    rot: rot ? parseFloat(rot[1]) : 0,
    scale: scale ? parseFloat(scale[1]) : 1,
  };
};

// Steps an effect to completion, calling back with every live particle each
// frame. Returns the elapsed simulated seconds.
const run = (effect, onFrame) => {
  let t = 0;
  let alive = true;
  while (alive) {
    assert.ok(t < MAX_SECONDS, 'effect did not finish');
    alive = effect.step(DT);
    t += DT;
    if (!onFrame) continue;
    for (const p of effect.particles) {
      // age only advances once a particle's spawn delay has expired
      if (p.alive && p.age > 0) onFrame(p, parse(p.el.style.transform), t);
    }
  }
  return t;
};

describe('animation engine', () => {
  test('every effect finishes, stays finite, and removes its elements', () => {
    const { animations, live } = makeEngine();

    for (const Effect of animations) {
      for (let i = 0; i < RUNS; i++) {
        const effect = new Effect(emojiList(3));

        run(effect, (p, at) => {
          for (const [key, value] of Object.entries(at)) {
            assert.ok(Number.isFinite(value), `${Effect.label}: ${key} is ${value}`);
          }
          const opacity = parseFloat(p.el.style.opacity);
          assert.ok(
            opacity >= -0.001 && opacity <= 1.001,
            `${Effect.label}: opacity ${opacity} out of range`,
          );
        });

        assert.equal(
          effect.particles.filter((p) => p.alive).length, 0,
          `${Effect.label}: finished with particles still alive`,
        );
      }
    }

    assert.equal(live.size, 0, 'elements were left in the container');
  });

  test('particle count scales with the number of emoji, up to a cap', () => {
    const { animations } = makeEngine();
    // Firework scales in whole shells rather than per emoji; it has its own test.
    const perEmoji = animations.filter((e) => e.label !== 'Firework');

    for (const Effect of perEmoji) {
      assert.equal(new Effect(emojiList(1)).count, Effect.count, `${Effect.label}: one emoji`);
      assert.equal(new Effect(emojiList(3)).count,
        Math.min(Effect.count * 3, Effect.maxCount), `${Effect.label}: three emoji`);
      assert.equal(new Effect(emojiList(500)).count,
        Effect.maxCount, `${Effect.label}: capped`);
    }
  });

  test('a message\'s emoji are spread evenly across an effect\'s particles', () => {
    const { animations } = makeEngine();

    for (const Effect of animations) {
      const emojis = emojiList(4);
      const effect = new Effect(emojis);
      const used = new Map();
      for (const p of effect.particles) {
        used.set(p.el.innerHTML, (used.get(p.el.innerHTML) ?? 0) + 1);
      }

      assert.equal(used.size, emojis.length,
        `${Effect.label}: used ${used.size} of ${emojis.length} emoji`);
      // Round-robin, so the most- and least-used can differ by at most one.
      const counts = [...used.values()];
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1,
        `${Effect.label}: uneven spread ${counts.join()}`);
    }
  });

  // The clamp lives in the rAF loop rather than in step(), so this drives the
  // loop through the stubbed requestAnimationFrame instead of stepping an
  // effect directly.
  test('the frame delta is clamped, so a stalled tab does not teleport particles', () => {
    const { animations, animateEmojis, frames, ctx } = makeEngine();
    // Worm's head has no spawn delay, so it moves on the very first frame.
    const Worm = animations.find((e) => e.label === 'Worm');
    const head = () => parse(
      vm.runInContext('runningEffects[0].particles[0].el.style.transform', ctx),
    );

    animateEmojis(emojiList(1), Worm);
    assert.equal(frames.length, 1, 'starting an effect should schedule a frame');

    frames.shift()(1000); // first frame establishes the timestamp
    const before = head();

    assert.equal(frames.length, 1, 'a running effect should schedule the next frame');
    frames.shift()(101000); // 100 seconds later, as if the tab had been hidden
    const after = head();

    // A 100s delta is clamped to 0.1s. At the fastest the worm travels (~26vw/s,
    // plus its surge) that's a few vw; unclamped it would be thousands.
    const moved = Math.abs(after.x - before.x);
    assert.ok(moved < 10, `head jumped ${moved.toFixed(0)}vw on a stalled frame`);
  });

  test('the loop stops scheduling frames once everything has finished', () => {
    const { animations, animateEmojis, frames, live } = makeEngine();
    const Swoop = animations.find((e) => e.label === 'Swoop'); // one of the shortest

    animateEmojis(emojiList(1), Swoop);
    let ts = 0;
    while (frames.length > 0) {
      ts += DT * 1000;
      assert.ok(ts < MAX_SECONDS * 1000, 'loop never stopped');
      frames.shift()(ts);
    }

    assert.equal(live.size, 0, 'elements were left behind when the loop stopped');
  });
});

describe('Firework', () => {
  test('shell count scales with the number of emoji', () => {
    const { animations } = makeEngine();
    const Firework = animations.find((e) => e.label === 'Firework');

    const shells = (n) => new Firework(emojiList(n)).shells;
    assert.equal(shells(1), 2, 'always at least two shells');
    assert.equal(shells(2), 2);
    assert.equal(shells(3), 3);
    assert.equal(shells(6), 4);
    assert.equal(shells(9), 5);
    assert.equal(shells(100), 6, 'capped');
  });

  // The launch telegraphs where the break will happen, so any gap between the
  // shell vanishing and its sparks appearing shows up as a flicker.
  test('each shell disappears on the same frame its break appears', () => {
    const { animations } = makeEngine();
    const Firework = animations.find((e) => e.label === 'Firework');
    const PER_SHELL = 10; // one shell particle + its sparks

    for (let i = 0; i < RUNS; i++) {
      const effect = new Firework(emojiList(6)); // several shells per run
      const died = new Map();
      const born = new Map();

      let frame = 0;
      let alive = true;
      while (alive) {
        assert.ok(frame < MAX_SECONDS / DT, 'effect did not finish');
        alive = effect.step(DT);
        frame += 1;
        for (const p of effect.particles) {
          const shell = Math.floor(p.i / PER_SHELL);
          if (p.i % PER_SHELL === 0) {
            if (!p.alive && !died.has(shell)) died.set(shell, frame);
          } else if (p.alive && p.age > 0 && !born.has(shell)) {
            born.set(shell, frame);
          }
        }
      }

      assert.equal(died.size, effect.shells, 'every shell should have launched and died');
      for (const [shell, deathFrame] of died) {
        const birthFrame = born.get(shell);
        assert.ok(birthFrame !== undefined, `shell ${shell} never broke`);
        // Within a frame: the spark's delay counts down by dt from the start
        // while the shell's own age accumulates separately, so rounding can put
        // later shells a single frame apart. 16ms isn't visible; a real gap is.
        assert.ok(Math.abs(birthFrame - deathFrame) <= 1,
          `shell ${shell} died on frame ${deathFrame} but broke on frame ${birthFrame}`);
      }
    }
  });
});

describe('Swoop', () => {
  test('particles only ever move outward from the centre', () => {
    const { animations } = makeEngine();
    const Swoop = animations.find((e) => e.label === 'Swoop');
    // In pixels, so the vw/vh asymmetry doesn't make radial motion look negative.
    const radius = (at) => Math.hypot(
      (at.x - 50) * VIEWPORT.innerWidth / 100,
      (at.y - 50) * VIEWPORT.innerHeight / 100,
    );

    for (let i = 0; i < RUNS; i++) {
      const previous = new Map();
      run(new Swoop(emojiList(2)), (p, at) => {
        const r = radius(at);
        const was = previous.get(p.i);
        if (was !== undefined) {
          assert.ok(r >= was - 0.5,
            `particle ${p.i} moved back toward the centre (${was.toFixed(1)} → ${r.toFixed(1)}px)`);
        }
        previous.set(p.i, r);
      });
    }
  });

  // Regression: travel distance is denominated in vw, so the vertical component
  // needs converting to vh on the way out. Getting that backwards squashes the
  // burst into an ellipse. Measured in pixels, because the conversion is
  // precisely what's under test — viewport units would hide a mismatch.
  test('each particle flies out at the angle it was given', () => {
    const { animations } = makeEngine();
    const Swoop = animations.find((e) => e.label === 'Swoop');

    for (let i = 0; i < RUNS; i++) {
      run(new Swoop(emojiList(2)), (p, at) => {
        const dx = (at.x - p.startX) * VIEWPORT.innerWidth / 100;
        const dy = (at.y - p.startY) * VIEWPORT.innerHeight / 100;
        if (Math.hypot(dx, dy) < 20) return; // too close to the start to measure

        const actual = Math.atan2(dy, dx);
        const off = Math.abs(Math.atan2(Math.sin(actual - p.angle), Math.cos(actual - p.angle)));
        assert.ok(off < 0.02,
          `particle ${p.i} flew at ${(actual * 180 / Math.PI).toFixed(0)}° `
          + `instead of ${(p.angle * 180 / Math.PI).toFixed(0)}°`);
      });
    }
  });

  test('every particle leaves frame at full scale, whatever its angle', () => {
    const { animations } = makeEngine();
    const Swoop = animations.find((e) => e.label === 'Swoop');
    const SCALE_MAX = 3.6;

    for (let i = 0; i < RUNS; i++) {
      const last = new Map();
      run(new Swoop(emojiList(2)), (p, at) => last.set(p.i, at));

      for (const [i2, at] of last) {
        assert.ok(at.scale > SCALE_MAX * 0.95,
          `particle ${i2} ended at scale ${at.scale.toFixed(2)}, short of ${SCALE_MAX}`);
        const off = at.x < -5 || at.x > 105 || at.y < -5 || at.y > 105;
        assert.ok(off, `particle ${i2} was still on screen at ${at.x.toFixed(0)},${at.y.toFixed(0)}`);
      }
    }
  });
});

describe('Worm', () => {
  test('never crawls backwards, however deep the pulse', () => {
    const { animations } = makeEngine();
    const Worm = animations.find((e) => e.label === 'Worm');

    for (let i = 0; i < RUNS; i++) {
      const effect = new Worm(emojiList(3));
      const previous = new Map();
      run(effect, (p, at) => {
        const forward = at.x * effect.dir;
        const was = previous.get(p.i);
        assert.ok(was === undefined || forward >= was - 1e-6,
          `segment ${p.i} moved backwards`);
        previous.set(p.i, forward);
      });
    }
  });

  // Regression: the facing angle came from a raw atan2, so a leftward worm sat
  // at the ±180° wrap and flipped orientation every time the undulation crossed
  // zero. Both directions should stay within a modest lean of upright.
  test('segments stay near upright travelling either way', () => {
    const { animations } = makeEngine();
    const Worm = animations.find((e) => e.label === 'Worm');
    const seen = new Set();

    for (let i = 0; i < 60 && seen.size < 2; i++) {
      const effect = new Worm(emojiList(3));
      seen.add(effect.dir);
      run(effect, (p, at) => {
        assert.ok(Math.abs(at.rot) < 60,
          `segment rotated ${at.rot.toFixed(0)}° travelling ${effect.dir > 0 ? 'right' : 'left'}`);
      });
    }

    assert.equal(seen.size, 2, 'expected to see worms travelling both directions');
  });
});
