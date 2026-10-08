window.addEventListener('load', () => {
  const options = {
    autoplay: 'play',
    controls: true,
    fill: true,
    responsive: true,
    liveui: true,
    techOrder: ['chromecast', 'html5'],
    chromecast: {
      requestTitleFn: () => 'Hecklevision',
      // The plugin marks the stream LIVE only if Video.js has already detected it as
      // live, which resets when casting swaps techs. The stream is always live, so
      // force it, and drop the start time so the receiver joins at the live edge.
      modifyLoadRequestFn: (request) => {
        request.media.streamType = chrome.cast.media.StreamType.LIVE;
        request.currentTime = undefined;
        return request;
      },
    },
    html5: {
      vhs: {
        playlistExclusionDuration: 10,
        bandwidth: 1128000,
        useBandwidthFromLocalStorage: true,
        overrideNative: !videojs.browser.IS_ANY_SAFARI,
        // Live-edge tuning. Defaults: liveSyncDurationCount=3,
        // liveMaxLatencyDurationCount=liveSyncDurationCount+1. Pairing with
        // hls_fragment 1s + hls_playlist_length 12s in the server config,
        // target live edge is now ~2s behind, with catchup kicking in at ~3s.
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 3,
      },
      nativeAudioTracks: !videojs.browser.IS_ANY_SAFARI,
      nativeVideoTracks: !videojs.browser.IS_ANY_SAFARI,
    },
    plugins: {
      chromecast: {
        buttonPositionIndex: -2,
        // Glue Cast app
        receiverAppID: 'B42E7286',
      },
      airPlay: {},
    },
  };

  // Same-origin HLS URL — SWAG on the current host proxies /live/* to the
  // local nginx-rtmp container. Works for any hostname the page is served
  // from (heckle.tom.kiwi, stream.tom.kiwi, etc.) without rebuilding.
  const srcUrl = new URL('/live/movie.m3u8', window.location.origin);

  videojs(document.querySelector('#video'), options, function() {
    this.src({
      src: srcUrl.href,
      type: 'application/x-mpegURL',
    });
    this.qualityLevels();
    this.hlsQualitySelector({
      displayCurrentQuality: true,
    });
    adoptBrowserCastSessions(this);
  });
});

// The Chromecast plugin only loads media onto the receiver when casting starts from its
// own button. Sessions started from the browser's Cast menu launch the receiver app but
// leave it idle, so watch for those and hand them to the plugin the same way.
const adoptBrowserCastSessions = (player) => {
  const whenCastReady = (fn, triesLeft = 30) => {
    if (player.chromecastSessionManager) {
      fn(player.chromecastSessionManager);
    } else if (triesLeft > 0) {
      setTimeout(() => whenCastReady(fn, triesLeft - 1), 1000);
    }
  };

  whenCastReady((sessionManager) => {
    const SessionManager = sessionManager.constructor;
    const { SessionState, CastContextEventType } = cast.framework;

    sessionManager.getCastContext().addEventListener(CastContextEventType.SESSION_STATE_CHANGED, (event) => {
      if (event.sessionState !== SessionState.SESSION_STARTED && event.sessionState !== SessionState.SESSION_RESUMED) {
        return;
      }
      // Give the plugin's own button flow a moment to claim the session first
      setTimeout(() => {
        if (SessionManager.hasConnected) {
          return;
        }
        SessionManager.hasConnected = true;
        player.trigger('chromecastConnected');
        sessionManager._reloadTech();
      }, 500);
    });
  });
};
