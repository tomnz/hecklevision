const MESSAGE_POLL_MS = 500;
const MESSAGE_SHOW_MS = 20000;
const MESSAGE_OVERLOAD_LOW = 3;
const MESSAGE_OVERLOAD_HIGH = 5;

const fetchMessages = async after => {
  return fetch(`/get?after=${after}`);
};

const fetchEmoji = async () => {
  return fetch('/emoji');
};

let customEmoji = {};

// Renders message text to HTML, animating its emoji unless suppressed
const renderAndAnimate = (text) => {
  const { html, emojis } = renderMessage(text, BUILTIN_EMOJIS, customEmoji);

  if (emojis.length > 0 && !suppressAnimations) {
    // Pick one animation style for the entire message
    const animation = animations[Math.floor(Math.random() * animations.length)];
    emojis.forEach((emoji) => {
      if (!emoji.name.startsWith('skin-tone-') && !/^\p{Emoji_Modifier}$/u.test(emoji.name)) {
        animateEmoji(emoji.html, animation);
      }
    });
  }

  return html;
};

const historyMode = new URLSearchParams(window.location.search).has('history');
let lastTimestamp = historyMode ? 0 : new Date().getTime() / 1000;
let suppressAnimations = historyMode;

const newSpinnerEl = () => {
  const spinnerEl = document.createElement('div');
  spinnerEl.classList.add('pie');
  spinnerEl.classList.add('spinner');

  const fillerEl = document.createElement('div');
  fillerEl.classList.add('pie');
  fillerEl.classList.add('filler');

  const maskEl = document.createElement('div');
  maskEl.classList.add('mask');

  const containerEl = document.createElement('div');
  containerEl.classList.add('spinnerContainer');
  containerEl.appendChild(spinnerEl);
  containerEl.appendChild(fillerEl);
  containerEl.appendChild(maskEl);

  return containerEl;
};

const scrollToBottom = () => {
  window.scrollTo(0, document.body.scrollHeight);
};

const checkMessageOverload = () => {
  const messagesEl = document.getElementById('messages');
  if (messagesEl.children.length >= MESSAGE_OVERLOAD_HIGH) {
    if (!messagesEl.classList.contains('messageOverloadHigh')) {
      messagesEl.classList.remove('messageOverloadLow');
      messagesEl.classList.add('messageOverloadHigh');
    }
  } else if (messagesEl.children.length >= MESSAGE_OVERLOAD_LOW) {
    if (!messagesEl.classList.contains('messageOverloadLow')) {
      messagesEl.classList.remove('messageOverloadHigh');
      messagesEl.classList.add('messageOverloadLow');
    }
  } else {
    messagesEl.classList.remove('messageOverloadLow');
    messagesEl.classList.remove('messageOverloadHigh');
  }
};

const updateMessages = () => {
  const messagesEl = document.getElementById('messages');

  return fetchMessages(lastTimestamp).then((resp) => resp.json()).then((data) => {
    data.forEach((message) => {
      if (message.timestamp > lastTimestamp) {
        lastTimestamp = message.timestamp;
      }

      const authorEl = document.createElement('span');
      authorEl.innerText = message.author;
      authorEl.classList.add('messageAuthor');

      const textEl = document.createElement('span');
      textEl.innerHTML = renderAndAnimate(message.text);
      textEl.classList.add('messageText');
      // Generate a random color based on username, because why not
      textEl.style.color = stringToColor(message.author);

      const messageEl = document.createElement('div');
      messageEl.classList.add('message');

      if (historyMode) {
        const timeEl = document.createElement('span');
        timeEl.innerText = new Date(message.timestamp * 1000).toLocaleTimeString('en-US');
        timeEl.classList.add('messageTime');
        messageEl.appendChild(timeEl);
      } else {
        messageEl.appendChild(newSpinnerEl());
      }
      messageEl.appendChild(authorEl);
      messageEl.appendChild(document.createTextNode(': '));
      messageEl.appendChild(textEl);

      messagesEl.appendChild(messageEl);

      if (!historyMode) {
        setTimeout(() => {
          messagesEl.removeChild(messageEl);
          checkMessageOverload();
        }, MESSAGE_SHOW_MS);
      }
      if (data.length > 0) {
        scrollToBottom();
      }
    });
  }).finally(() => {
    suppressAnimations = false;
    checkMessageOverload();
  });
};

// The overlay feeds the stream, so it always polls. History is a page people leave
// open in a tab, so it pauses while hidden and stops after a few hours.
const HISTORY_LIFETIME_MS = 3 * 60 * 60 * 1000;
const messagePoller = createPoller({
  poll: updateMessages,
  intervalMs: MESSAGE_POLL_MS,
  pauseWhenHidden: historyMode,
  maxLifetimeMs: historyMode ? HISTORY_LIFETIME_MS : null,
  onExpire: () => showRefreshBanner('History stopped updating. Refresh to continue.'),
});

if (historyMode) {
  window.document.body.classList.add('blackBackground');
  const containerEl = document.getElementById('container');
  containerEl.classList.add('alignLeft');
  const messagesEl = document.getElementById('messages');
  messagesEl.classList.add('alignLeft');
}

const start = async () => {
  customEmoji = await fetchEmoji().then((resp) => resp.json());
  messagePoller.start();
};

start();
