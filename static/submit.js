const NAME_STORAGE_KEY = 'hecklevision.userName';

const formEl = document.getElementById('heckleForm');
const userNameEl = document.getElementById('userName');
const textEl = document.getElementById('text');
const submitEl = document.getElementById('submit');
const responseEl = document.getElementById('response');
const charCountEl = document.getElementById('charCount');
const popupEl = document.getElementById('emojiPopup');
const previewEl = document.getElementById('preview');
const emojiButtonEl = document.getElementById('emojiButton');
const pickerEl = document.getElementById('emojiPicker');
const pickerSearchEl = document.getElementById('emojiSearch');
const pickerGridEl = document.getElementById('emojiGrid');
const recentListEl = document.getElementById('recentList');
const recentEmptyEl = document.getElementById('recentEmpty');

// Example heckles, one picked at random for the message placeholder
const PLACEHOLDERS = [
  'Enhance! :mag:',
  'Just kiss already :kissing_heart:',
  'Don\'t go in the basement :ghost:',
  'That\'s not how computers work :computer:',
  'Run, you fool! :runner:',
  'I could direct this from my couch :couch_and_lamp:',
  'Bold choice of haircut :eyes:',
  'He\'s been dead the whole time :skull:',
  'I can\'t watch :see_no_evil:',
  'This soundtrack slaps :notes:',
  'Nobody acts like this :face_with_rolling_eyes:',
  'Classic villain monologue :man-facepalming:',
];
textEl.placeholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];

let customEmoji = {};
let emojiNames = Object.keys(BUILTIN_EMOJIS);

const loadCustomEmoji = async () => {
  try {
    const resp = await fetch('/emoji');
    customEmoji = await resp.json();
    emojiNames = [...new Set([...Object.keys(BUILTIN_EMOJIS), ...Object.keys(customEmoji)])];
    updatePreview();
    renderRecent(new Set());
    defaultPickerHTML = null;
    if (!pickerEl.hidden) {
      renderPicker();
    }
  } catch (err) {
    console.warn('Could not load custom emoji', err);
  }
};

// --- Name persistence --------------------------------------------------------

try {
  userNameEl.value = localStorage.getItem(NAME_STORAGE_KEY) || '';
} catch (err) {
  // Storage unavailable (private mode etc.); the name just won't be remembered
}

const saveName = () => {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, userNameEl.value.trim());
  } catch (err) {
    // Ignore
  }
};

// --- Preview and character count ---------------------------------------------

const updatePreview = () => {
  const name = userNameEl.value.trim() || 'You';
  const text = textEl.value;

  const length = messageLength(text.trim());
  charCountEl.textContent = `${length} / ${MESSAGE_LENGTH_LIMIT}`;
  charCountEl.classList.toggle('over', length > MESSAGE_LENGTH_LIMIT);

  if (!text.trim()) {
    previewEl.classList.add('empty');
    previewEl.textContent = 'Your heckle will look like this';
    return;
  }

  previewEl.classList.remove('empty');
  previewEl.innerHTML = [
    `<span class="previewAuthor">${escapeHTML(name)}</span>: `,
    `<span class="previewText" style="color: ${stringToColor(name)}">`,
    renderMessage(text, BUILTIN_EMOJIS, customEmoji).html,
    '</span>',
  ].join('');
};

// --- Emoji autocomplete ------------------------------------------------------

let suggestions = [];
let activeIndex = 0;

const closePopup = () => {
  suggestions = [];
  popupEl.hidden = true;
  popupEl.innerHTML = '';
  textEl.setAttribute('aria-expanded', 'false');
  textEl.removeAttribute('aria-activedescendant');
};

const renderPopup = () => {
  popupEl.innerHTML = '';
  suggestions.forEach((name, i) => {
    const itemEl = document.createElement('li');
    itemEl.id = `emojiOption${i}`;
    itemEl.setAttribute('role', 'option');
    itemEl.classList.toggle('active', i === activeIndex);
    itemEl.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');

    const glyphEl = document.createElement('span');
    glyphEl.classList.add('emojiGlyph');
    glyphEl.innerHTML = emojiHTML(name, BUILTIN_EMOJIS, customEmoji) || '';

    const nameEl = document.createElement('span');
    nameEl.textContent = `:${name}:`;

    itemEl.appendChild(glyphEl);
    itemEl.appendChild(nameEl);

    // mousedown rather than click, so the input keeps focus
    itemEl.addEventListener('mousedown', (event) => {
      event.preventDefault();
      chooseSuggestion(i);
    });
    itemEl.addEventListener('mousemove', () => {
      if (activeIndex !== i) {
        activeIndex = i;
        renderPopup();
      }
    });

    popupEl.appendChild(itemEl);
  });

  popupEl.hidden = false;
  textEl.setAttribute('aria-expanded', 'true');
  textEl.setAttribute('aria-activedescendant', `emojiOption${activeIndex}`);
  popupEl.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
};

const updatePopup = () => {
  const found = findEmojiQuery(textEl.value, textEl.selectionStart);
  if (!found) {
    closePopup();
    return;
  }
  suggestions = searchEmoji(found.query, emojiNames, 8);
  if (suggestions.length === 0) {
    closePopup();
    return;
  }
  activeIndex = 0;
  renderPopup();
};

const chooseSuggestion = (index) => {
  const name = suggestions[index];
  if (!name) {
    return;
  }
  const result = completeEmoji(textEl.value, textEl.selectionStart, name);
  textEl.value = result.text;
  textEl.setSelectionRange(result.cursor, result.cursor);
  closePopup();
  updatePreview();
};

textEl.addEventListener('keydown', (event) => {
  if (popupEl.hidden) {
    return;
  }
  switch (event.key) {
    case 'ArrowDown':
      activeIndex = (activeIndex + 1) % suggestions.length;
      renderPopup();
      break;
    case 'ArrowUp':
      activeIndex = (activeIndex - 1 + suggestions.length) % suggestions.length;
      renderPopup();
      break;
    case 'Enter':
    case 'Tab':
      chooseSuggestion(activeIndex);
      break;
    case 'Escape':
      closePopup();
      break;
    default:
      return;
  }
  event.preventDefault();
});

textEl.addEventListener('input', () => {
  closePicker();
  updatePopup();
  updatePreview();
});
textEl.addEventListener('click', updatePopup);
textEl.addEventListener('blur', closePopup);
userNameEl.addEventListener('input', updatePreview);

// --- Emoji picker ------------------------------------------------------------

const POPULAR_EMOJI = [
  'joy', 'rolling_on_the_floor_laughing', 'sob', 'scream', 'skull', 'fire', 'eyes',
  'thinking_face', 'face_palm', 'clap', '+1', '-1', 'heart', 'popcorn', 'tada', '100',
  'boom', 'rage', 'grimacing', 'see_no_evil', 'ghost', 'rocket', 'pray', 'sweat_smile',
  'face_with_rolling_eyes', 'sleeping', 'zzz', 'hankey', 'clown_face', 'nauseated_face',
  'exploding_head', 'cry', 'kissing_heart', 'heart_eyes', 'sunglasses', 'upside_down_face',
  'shushing_face', 'face_with_symbols_on_mouth', 'wave', 'ok_hand', 'muscle', 'crown',
  'trophy', 'movie_camera', 'clapper',
];
const PICKER_SEARCH_LIMIT = 120;

// The unfiltered grid is ~1,500 buttons, so build it once and reuse it
let defaultPickerHTML = null;

const isTouchScreen = () => window.matchMedia('(pointer: coarse)').matches;

const emojiCellHTML = (name) => [
  `<button type="button" class="emojiCell" data-name="${escapeHTML(name)}" title=":${escapeHTML(name)}:">`,
  emojiHTML(name, BUILTIN_EMOJIS, customEmoji),
  '</button>',
].join('');

const emojiCellsHTML = (names) => `<div class="emojiCells">${names.map(emojiCellHTML).join('')}</div>`;

const pickerSectionHTML = (title, names) => (names.length > 0 ? `<h3>${title}</h3>${emojiCellsHTML(names)}` : '');

const renderPicker = () => {
  const query = pickerSearchEl.value.trim().replace(/^:|:$/g, '').toLowerCase();

  if (query) {
    // Search every name (aliases included), but show each glyph once
    const seen = new Set();
    const results = searchEmoji(query, emojiNames, Infinity).filter((name) => {
      const html = emojiHTML(name, BUILTIN_EMOJIS, customEmoji);
      if (seen.has(html)) {
        return false;
      }
      seen.add(html);
      return true;
    }).slice(0, PICKER_SEARCH_LIMIT);
    pickerGridEl.innerHTML = results.length > 0
      ? emojiCellsHTML(results)
      : '<p class="emojiPickerEmpty">No emoji found</p>';
    return;
  }

  if (defaultPickerHTML === null) {
    defaultPickerHTML = [
      pickerSectionHTML('Slack', Object.keys(customEmoji).sort()),
      pickerSectionHTML('Popular', POPULAR_EMOJI),
      pickerSectionHTML('All emoji', pickerEmojiNames(BUILTIN_EMOJIS)),
    ].join('');
  }
  pickerGridEl.innerHTML = defaultPickerHTML;
};

const openPicker = () => {
  closePopup();
  pickerSearchEl.value = '';
  renderPicker();
  pickerGridEl.scrollTop = 0;
  pickerEl.hidden = false;
  emojiButtonEl.setAttribute('aria-expanded', 'true');
  // On touch devices, focusing the search box would pop up the keyboard over the grid
  if (!isTouchScreen()) {
    pickerSearchEl.focus();
  }
};

const closePicker = () => {
  if (pickerEl.hidden) {
    return;
  }
  pickerEl.hidden = true;
  emojiButtonEl.setAttribute('aria-expanded', 'false');
};

emojiButtonEl.addEventListener('click', () => {
  if (pickerEl.hidden) {
    openPicker();
  } else {
    closePicker();
    textEl.focus();
  }
});

// Inserting keeps the picker open so several emoji can be added in a row
pickerGridEl.addEventListener('click', (event) => {
  const cellEl = event.target.closest('.emojiCell');
  if (!cellEl) {
    return;
  }
  const result = insertEmoji(textEl.value, textEl.selectionStart, textEl.selectionEnd, cellEl.dataset.name);
  textEl.value = result.text;
  textEl.setSelectionRange(result.cursor, result.cursor);
  updatePreview();
});

pickerSearchEl.addEventListener('input', renderPicker);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !pickerEl.hidden) {
    closePicker();
    textEl.focus();
  }
});

document.addEventListener('pointerdown', (event) => {
  if (!pickerEl.hidden && !pickerEl.contains(event.target) && !emojiButtonEl.contains(event.target)) {
    closePicker();
  }
});

// --- Recent heckles ---------------------------------------------------------

const RECENT_LIMIT = 20;
const RECENT_POLL_MS = 2000;
const RECENT_LIFETIME_MS = 3 * 60 * 60 * 1000;

let recentMessages = [];

const formatTime = (timestamp) =>
  new Date(timestamp * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const renderRecent = (newTimestamps) => {
  recentEmptyEl.hidden = recentMessages.length > 0;
  recentListEl.innerHTML = '';
  recentMessages.forEach((message) => {
    const itemEl = document.createElement('li');
    itemEl.classList.toggle('new', newTimestamps.has(message.timestamp));
    itemEl.innerHTML = [
      `<span class="recentTime">${formatTime(message.timestamp)}</span> `,
      '<span>',
      `<span class="recentAuthor">${escapeHTML(message.author)}</span>: `,
      `<span class="recentText" style="color: ${stringToColor(message.author)}">`,
      renderMessage(message.text, BUILTIN_EMOJIS, customEmoji).html,
      '</span></span>',
    ].join('');
    recentListEl.appendChild(itemEl);
  });
};

const fetchRecent = async () => {
  const after = recentMessages.length > 0 ? recentMessages[0].timestamp : 0;
  const resp = await fetch(`/get?after=${after}`);
  const incoming = await resp.json();
  if (incoming.length === 0) {
    return;
  }
  // Only flash messages arriving after the initial load
  const newTimestamps = new Set(after > 0 ? incoming.map((m) => m.timestamp) : []);
  recentMessages = mergeRecent(recentMessages, incoming, RECENT_LIMIT);
  renderRecent(newTimestamps);
};

const recentPoller = createPoller({
  poll: fetchRecent,
  intervalMs: RECENT_POLL_MS,
  pauseWhenHidden: true,
  maxLifetimeMs: RECENT_LIFETIME_MS,
  onExpire: () => showRefreshBanner('Recent heckles stopped updating. Refresh to continue.'),
});

// --- Submission --------------------------------------------------------------

const RESPONSE_SHOW_MS = 30000;
let responseTimer = null;

const showResponse = (message, ok) => {
  clearTimeout(responseTimer);
  responseEl.innerHTML = renderMessage(message, BUILTIN_EMOJIS, customEmoji).html;
  responseEl.classList.toggle('success', ok);
  responseEl.classList.toggle('error', !ok);
  responseEl.classList.remove('faded');
  responseTimer = setTimeout(() => responseEl.classList.add('faded'), RESPONSE_SHOW_MS);
};

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();

  const userName = userNameEl.value.trim();
  if (!userName) {
    showResponse('Must provide a name!', false);
    userNameEl.focus();
    return;
  }
  const text = textEl.value.trim();
  if (!text) {
    showResponse('Must provide a message!', false);
    textEl.focus();
    return;
  }

  saveName();
  submitEl.disabled = true;
  try {
    const resp = await fetch(window.location.pathname, {
      method: 'POST',
      body: new URLSearchParams({ user_name: userName, text }),
    });
    const data = await resp.json();
    showResponse(data.text, data.ok);
    if (data.ok) {
      textEl.value = '';
      updatePreview();
      recentPoller.pollNow();
    }
  } catch (err) {
    showResponse('Something went wrong sending that. Try again?', false);
  } finally {
    submitEl.disabled = false;
    textEl.focus();
  }
});

updatePreview();
renderRecent(new Set());
loadCustomEmoji();
recentPoller.start();
(userNameEl.value ? textEl : userNameEl).focus();
