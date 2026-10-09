// Pure text helpers shared by the overlay (messages.js), the submit page
// (submit.js) and the Node unit tests (tests/). No DOM access in here.

// Characters allowed in an emoji shortcode, e.g. :+1:, :thumbsup:, :party-parrot:
const EMOJI_NAME_CHARS = "[a-z0-9_+'.-]";
const EMOJI_PATTERN = new RegExp(`:(${EMOJI_NAME_CHARS}+):`, 'gi');

// Mirrors MESSAGE_LENGTH_LIMIT in app.py
const MESSAGE_LENGTH_LIMIT = 200;
// Each emoji shortcode counts as this many characters (matches app.py)
const EMOJI_LENGTH = 4;

const escapeHTML = (str) => str
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

// Returns the HTML for a named emoji, or null if the name isn't known.
const emojiHTML = (name, builtinEmoji, customEmoji) => {
  if (Object.hasOwn(builtinEmoji, name)) {
    return builtinEmoji[name];
  }
  if (Object.hasOwn(customEmoji, name)) {
    return `<img class="customEmoji" src="${escapeHTML(customEmoji[name])}" alt="${escapeHTML(name)}" />`;
  }
  return null;
};

// Converts raw message text into safe HTML, substituting known :emoji: codes.
// Unknown codes (and stray colons, as in times or URLs) are left as literal text.
// Returns { html, emojis }, where emojis lists { name, html } for each emoji found,
// in order, so callers can animate them.
const renderMessage = (text, builtinEmoji = {}, customEmoji = {}) => {
  const pattern = new RegExp(EMOJI_PATTERN.source, 'gi');
  const parts = [];
  const emojis = [];
  let consumed = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const name = match[1];
    const html = emojiHTML(name, builtinEmoji, customEmoji);
    if (html === null) {
      // Let the closing colon start the next candidate, so "10:30:joy:" still finds :joy:
      pattern.lastIndex = match.index + 1;
      continue;
    }
    parts.push(escapeHTML(text.slice(consumed, match.index)));
    parts.push(html);
    emojis.push({ name, html });
    consumed = match.index + match[0].length;
  }
  parts.push(escapeHTML(text.slice(consumed)));

  return { html: parts.join(''), emojis };
};

// Message length as the server counts it
const messageLength = (text) => text.replace(new RegExp(EMOJI_PATTERN.source, 'gi'), 'x'.repeat(EMOJI_LENGTH)).length;

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

// --- Emoji autocomplete ------------------------------------------------------

// If the cursor sits at the end of a partial emoji code (e.g. "lol :jo|"),
// returns { query: 'jo', start } where start is the index of the colon.
// The colon must begin a word, so times ("10:3") and URLs ("https:/") don't trigger.
const findEmojiQuery = (text, cursor) => {
  const before = text.slice(0, cursor);
  const match = before.match(new RegExp(`(^|[\\s(])(:(${EMOJI_NAME_CHARS}+))$`, 'i'));
  if (!match) {
    return null;
  }
  return {
    query: match[3].toLowerCase(),
    start: before.length - match[2].length,
  };
};

// Ranks emoji names against a query: exact, prefix, word-prefix, then substring.
// Shorter names win ties within a rank.
const searchEmoji = (query, names, limit = 8) => {
  query = query.toLowerCase();
  const scored = [];
  names.forEach((name) => {
    const lower = name.toLowerCase();
    let rank;
    if (lower === query) {
      rank = 0;
    } else if (lower.startsWith(query)) {
      rank = 1;
    } else if (lower.split(/[_\-.]/).some((word) => word.startsWith(query))) {
      rank = 2;
    } else if (lower.includes(query)) {
      rank = 3;
    } else {
      return;
    }
    scored.push({ name, rank });
  });

  scored.sort((a, b) => a.rank - b.rank || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.name);
};

// Replaces the partial code found by findEmojiQuery with a full ":name: ".
// Returns the new text and cursor position.
const completeEmoji = (text, cursor, name) => {
  const found = findEmojiQuery(text, cursor);
  if (!found) {
    return { text, cursor };
  }
  const insert = `:${name}: `;
  const after = text.slice(cursor).replace(new RegExp(`^${EMOJI_NAME_CHARS}*:?\\s?`, 'i'), '');
  return {
    text: text.slice(0, found.start) + insert + after,
    cursor: found.start + insert.length,
  };
};

// --- Recent messages ---------------------------------------------------------

// Merges newly fetched messages into a recent list: deduplicated by timestamp,
// newest first, trimmed to `limit`.
const mergeRecent = (existing, incoming, limit = 20) => {
  const byTimestamp = new Map();
  [...existing, ...incoming].forEach((message) => byTimestamp.set(message.timestamp, message));
  return [...byTimestamp.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
};

if (typeof module !== 'undefined') {
  module.exports = {
    EMOJI_PATTERN,
    MESSAGE_LENGTH_LIMIT,
    escapeHTML,
    emojiHTML,
    renderMessage,
    messageLength,
    stringToColor,
    findEmojiQuery,
    searchEmoji,
    completeEmoji,
    mergeRecent,
  };
}
