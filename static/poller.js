// Polling loop shared by the submit page and the messages views. Each poll is scheduled
// after the previous one finishes, so slow responses never stack up.
//
// Options:
//   poll            async function doing one round of work
//   intervalMs      delay between the end of one poll and the start of the next
//   pauseWhenHidden stop polling while the tab is hidden; catch up as soon as it's visible
//   maxLifetimeMs   stop for good this long after creation, then call onExpire
//                   (guards against tabs left open for days)
const createPoller = ({
  poll,
  intervalMs,
  pauseWhenHidden = false,
  maxLifetimeMs = null,
  onExpire = () => {},
  doc = globalThis.document,
  now = () => Date.now(),
}) => {
  const startedAt = now();
  let timer = null;
  let inFlight = false;
  let pollAgain = false;
  let expired = false;

  const paused = () => pauseWhenHidden && doc.hidden;

  const stopTimer = () => {
    clearTimeout(timer);
    timer = null;
  };

  const expire = () => {
    expired = true;
    stopTimer();
    onExpire();
  };

  const tick = async () => {
    timer = null;
    if (maxLifetimeMs !== null && now() - startedAt >= maxLifetimeMs) {
      expire();
      return;
    }
    if (paused()) {
      return;
    }

    inFlight = true;
    try {
      await poll();
    } catch (err) {
      console.warn('Poll failed', err);
    } finally {
      inFlight = false;
    }

    if (expired || paused()) {
      return;
    }
    if (pollAgain) {
      pollAgain = false;
      tick();
    } else {
      timer = setTimeout(tick, intervalMs);
    }
  };

  // Polls immediately. If a poll is already running, another follows straight after it,
  // so callers always see data fetched after their request.
  const pollNow = () => {
    if (expired) {
      return;
    }
    if (inFlight) {
      pollAgain = true;
      return;
    }
    stopTimer();
    tick();
  };

  if (pauseWhenHidden) {
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) {
        stopTimer();
      } else {
        pollNow();
      }
    });
  }

  return {
    start: pollNow,
    pollNow,
    isExpired: () => expired,
  };
};

// Fixed banner telling the viewer the page has stopped updating
const showRefreshBanner = (message) => {
  const bannerEl = document.createElement('div');
  bannerEl.setAttribute('role', 'alert');
  Object.assign(bannerEl.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    zIndex: '1000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    flexWrap: 'wrap',
    padding: '12px 16px',
    background: '#ffcc33',
    color: '#111111',
    fontFamily: 'sans-serif',
    fontSize: '16px',
    fontWeight: 'bold',
  });

  const textEl = document.createElement('span');
  textEl.textContent = message;

  const buttonEl = document.createElement('button');
  buttonEl.type = 'button';
  buttonEl.textContent = 'Refresh';
  Object.assign(buttonEl.style, {
    padding: '6px 16px',
    font: 'inherit',
    color: '#ffcc33',
    background: '#111111',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  });
  buttonEl.addEventListener('click', () => window.location.reload());

  bannerEl.appendChild(textEl);
  bannerEl.appendChild(buttonEl);
  document.body.appendChild(bannerEl);
};

if (typeof module !== 'undefined') {
  module.exports = { createPoller };
}
