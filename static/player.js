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
    },
    html5: {
      hls: {
        blacklistDuration: 10,
        bandwidth: 1128000,
        useBandwidthFromLocalStorage: true,
        overrideNative: !videojs.browser.IS_ANY_SAFARI,
        smoothQualityChange: true,
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
  });
});
