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

const emojiHTML = (emojiName) => {
  if (emojiName in BUILTIN_EMOJIS) {
    return BUILTIN_EMOJIS[emojiName];
  } else if (emojiName in customEmoji) {
    return `<img class="customEmoji" src="${customEmoji[emojiName]}" alt="${emojiName}" />`;
  }
  return '';
}

const replaceEmoji = (str) => {
  const emojis = str.match(/:[^:]*:/g);
  if (!emojis) {
    return str;
  }

  emojis.forEach((emoji) => {
    // Strip :s
    const emojiName = emoji.slice(1, emoji.length-1);
    const html = emojiHTML(emojiName)
    str = str.replace(emoji, html);
    if (!emojiName.startsWith('skin-tone-') && !suppressAnimations) {
      animateEmoji(html);
    }
  });

  return str;
};

const escapeHTML = (str) => {
  const el = document.createElement('textarea');
  el.textContent = str;
  return el.innerHTML;
};

const stringToColor = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0; // keep 32-bit
  }

  const hue = ((hash % 360) + 360) % 360;

  const sat = 65 + (Math.abs(hash) % 20);     // 65–85%
  const light = 55 + (Math.abs(hash >> 3) % 15); // 55–70%

  return `hsl(${hue}, ${sat}%, ${light}%)`;
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

  fetchMessages(lastTimestamp).then((resp) => resp.json()).then((data) => {
    data.forEach((message) => {
      if (message.timestamp > lastTimestamp) {
        lastTimestamp = message.timestamp;
      }

      const authorEl = document.createElement('span');
      authorEl.innerText = message.author;
      authorEl.classList.add('messageAuthor');

      const textEl = document.createElement('span');
      textEl.innerHTML = replaceEmoji(escapeHTML(message.text));
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
    // Schedule the next update
    setTimeout(updateMessages, MESSAGE_POLL_MS);
  });
};

if (historyMode) {
  window.document.body.classList.add('blackBackground');
  const containerEl = document.getElementById('container');
  containerEl.classList.add('alignLeft');
  const messagesEl = document.getElementById('messages');
  messagesEl.classList.add('alignLeft');
}

const start = async () => {
  customEmoji = await fetchEmoji().then((resp) => resp.json());
  updateMessages();
};

start();
