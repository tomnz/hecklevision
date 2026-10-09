const { test, describe, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const { createPoller } = require('../static/poller.js');

// Minimal stand-in for `document` visibility
const fakeDocument = () => {
  const listeners = [];
  return {
    hidden: false,
    addEventListener: (type, fn) => listeners.push(fn),
    setHidden(hidden) {
      this.hidden = hidden;
      listeners.forEach((fn) => fn());
    },
  };
};

// Let pending promise callbacks (the async poll) run
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('createPoller', () => {
  let clock;
  let doc;
  let polls;

  const make = (options = {}) => createPoller({
    poll: async () => { polls += 1; },
    intervalMs: 1000,
    doc,
    now: () => clock,
    ...options,
  });

  // Advance mocked setTimeout and our clock together
  const advance = async (ms) => {
    clock += ms;
    mock.timers.tick(ms);
    await flush();
  };

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
    clock = 0;
    doc = fakeDocument();
    polls = 0;
  });

  afterEach(() => mock.timers.reset());

  test('polls immediately on start, then every interval', async () => {
    make().start();
    await flush();
    assert.equal(polls, 1);
    await advance(1000);
    assert.equal(polls, 2);
    await advance(1000);
    assert.equal(polls, 3);
  });

  test('keeps polling after a failed poll', async () => {
    const warn = mock.method(console, 'warn', () => {});
    make({ poll: async () => { polls += 1; throw new Error('network'); } }).start();
    await flush();
    await advance(1000);
    assert.equal(polls, 2);
    warn.mock.restore();
  });

  test('ignores visibility unless pauseWhenHidden is set', async () => {
    make().start();
    await flush();
    doc.setHidden(true);
    await advance(1000);
    assert.equal(polls, 2);
  });

  test('pauses while hidden and catches up when visible', async () => {
    make({ pauseWhenHidden: true }).start();
    await flush();
    doc.setHidden(true);
    await advance(10000);
    assert.equal(polls, 1);

    doc.setHidden(false);
    await flush();
    assert.equal(polls, 2);
    await advance(1000);
    assert.equal(polls, 3);
  });

  test('stops for good after its lifetime and calls onExpire once', async () => {
    let expiredCount = 0;
    const poller = make({ maxLifetimeMs: 3000, onExpire: () => { expiredCount += 1; } });
    poller.start();
    await flush();
    await advance(1000);
    await advance(1000);
    assert.equal(polls, 3);

    await advance(1000);
    assert.equal(polls, 3);
    assert.equal(expiredCount, 1);
    assert.ok(poller.isExpired());

    poller.pollNow();
    await advance(5000);
    assert.equal(polls, 3);
    assert.equal(expiredCount, 1);
  });

  test('expires on return if the lifetime passed while hidden', async () => {
    let expiredCount = 0;
    make({ pauseWhenHidden: true, maxLifetimeMs: 3000, onExpire: () => { expiredCount += 1; } }).start();
    await flush();
    doc.setHidden(true);
    await advance(60000);

    doc.setHidden(false);
    await flush();
    assert.equal(polls, 1);
    assert.equal(expiredCount, 1);
  });

  test('pollNow during an in-flight poll runs another straight after it', async () => {
    let release;
    const poller = make({
      poll: () => { polls += 1; return new Promise((resolve) => { release = resolve; }); },
    });
    poller.start();
    assert.equal(polls, 1);

    poller.pollNow();
    assert.equal(polls, 1);

    release();
    await flush();
    assert.equal(polls, 2);
  });
});
