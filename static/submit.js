const NAME_STORAGE_KEY = 'hecklevision.userName';

const formEl = document.getElementById('heckleForm');
const userNameEl = document.getElementById('userName');
const textEl = document.getElementById('text');
const submitEl = document.getElementById('submit');
const responseEl = document.getElementById('response');
const charCountEl = document.getElementById('charCount');
const popupEl = document.getElementById('emojiPopup');
const previewEl = document.getElementById('preview');

let customEmoji = {};
let emojiNames = Object.keys(BUILTIN_EMOJIS);

const loadCustomEmoji = async () => {
  try {
    const resp = await fetch('/emoji');
    customEmoji = await resp.json();
    emojiNames = [...new Set([...Object.keys(BUILTIN_EMOJIS), ...Object.keys(customEmoji)])];
    updatePreview();
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
    previewEl.textContent = 'Your message will look like this on screen';
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
  updatePopup();
  updatePreview();
});
textEl.addEventListener('click', updatePopup);
textEl.addEventListener('blur', closePopup);
userNameEl.addEventListener('input', updatePreview);

// --- Submission --------------------------------------------------------------

const showResponse = (message, ok) => {
  responseEl.textContent = message;
  responseEl.classList.toggle('success', ok);
  responseEl.classList.toggle('error', !ok);
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
    }
  } catch (err) {
    showResponse('Something went wrong sending that. Try again?', false);
  } finally {
    submitEl.disabled = false;
    textEl.focus();
  }
});

updatePreview();
loadCustomEmoji();
(userNameEl.value ? textEl : userNameEl).focus();
