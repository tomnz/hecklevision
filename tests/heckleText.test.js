// Run with: node --test tests/
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  escapeHTML,
  renderMessage,
  messageLength,
  stringToColor,
  findEmojiQuery,
  searchEmoji,
  completeEmoji,
} = require('../static/heckleText.js');

// The real builtin emoji table, loaded the same way the browser does
const loadBuiltinEmojis = () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/builtinEmojis.js'), 'utf8'), context);
  return context.BUILTIN_EMOJIS;
};
const BUILTIN = loadBuiltinEmojis();
const CUSTOM = { 'party-parrot': 'https://emoji.example/parrot.gif' };

const render = (text) => renderMessage(text, BUILTIN, CUSTOM);

describe('renderMessage', () => {
  test('plain text passes through', () => {
    assert.equal(render('His face looks like grilled cheese!').html, 'His face looks like grilled cheese!');
  });

  test('escapes HTML', () => {
    assert.equal(render('<b>hi</b> & "you"').html, '&lt;b&gt;hi&lt;/b&gt; &amp; &quot;you&quot;');
  });

  test('replaces builtin emoji', () => {
    const { html, emojis } = render('nice :thumbsup: work');
    assert.equal(html, `nice ${BUILTIN.thumbsup} work`);
    assert.deepEqual(emojis.map((e) => e.name), ['thumbsup']);
  });

  test('replaces custom emoji with an img', () => {
    const { html } = render(':party-parrot:');
    assert.equal(html, '<img class="customEmoji" src="https://emoji.example/parrot.gif" alt="party-parrot" />');
  });

  test('handles emoji with symbols in the name', () => {
    assert.deepEqual(render(':+1: :-1:').emojis.map((e) => e.name), ['+1', '-1']);
  });

  test('repeated emoji are all replaced and reported', () => {
    const { html, emojis } = render(':joy::joy: :joy:');
    assert.equal(html, `${BUILTIN.joy}${BUILTIN.joy} ${BUILTIN.joy}`);
    assert.equal(emojis.length, 3);
  });

  test('quoted colon does not swallow the rest of the message', () => {
    assert.equal(render('he said ":" and then left :joy:').html, `he said &quot;:&quot; and then left ${BUILTIN.joy}`);
  });

  test('URLs survive intact', () => {
    assert.equal(render('look https://google.com').html, 'look https://google.com');
    assert.equal(render('look: https://google.com lol').html, 'look: https://google.com lol');
    assert.equal(render('https://google.com :joy:').html, `https://google.com ${BUILTIN.joy}`);
  });

  test('times are left alone', () => {
    assert.equal(render('starts at 10:30:45').html, 'starts at 10:30:45');
  });

  test('unknown emoji are left as literal text', () => {
    const { html, emojis } = render(':notarealemoji: hi');
    assert.equal(html, ':notarealemoji: hi');
    assert.equal(emojis.length, 0);
  });

  test('an unknown code does not hide an adjacent real emoji', () => {
    assert.equal(render('10:30:joy:').html, `10:30${BUILTIN.joy}`);
  });

  test('emoji names do not span spaces', () => {
    assert.equal(render('a: b :c').html, 'a: b :c');
  });

  test('custom emoji URLs and names are escaped', () => {
    const { html } = renderMessage(':evil:', {}, { evil: 'x" onerror="alert(1)' });
    assert.ok(!html.includes('" onerror'));
  });

  test('inherited object properties are not treated as emoji', () => {
    assert.equal(renderMessage(':constructor: :toString:', {}, {}).html, ':constructor: :toString:');
  });
});

describe('messageLength', () => {
  test('counts emoji as 4 characters', () => {
    assert.equal(messageLength('hi :thumbsup:'), 7);
  });

  test('stray colons count normally', () => {
    assert.equal(messageLength('he said ":"'), 11);
  });
});

describe('escapeHTML', () => {
  test('escapes all special characters', () => {
    assert.equal(escapeHTML(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('stringToColor', () => {
  test('is stable for the same name', () => {
    assert.equal(stringToColor('tom'), stringToColor('tom'));
    assert.match(stringToColor('tom'), /^hsl\(\d+, \d+%, \d+%\)$/);
  });
});

describe('findEmojiQuery', () => {
  test('finds a partial code at the cursor', () => {
    assert.deepEqual(findEmojiQuery('lol :jo', 7), { query: 'jo', start: 4 });
    assert.deepEqual(findEmojiQuery(':th', 3), { query: 'th', start: 0 });
  });

  test('uses text up to the cursor only', () => {
    assert.deepEqual(findEmojiQuery(':jo rest', 3), { query: 'jo', start: 0 });
  });

  test('ignores a bare colon, times, URLs and completed codes', () => {
    assert.equal(findEmojiQuery('lol :', 5), null);
    assert.equal(findEmojiQuery('at 10:3', 7), null);
    assert.equal(findEmojiQuery('https:/', 7), null);
    assert.equal(findEmojiQuery(':joy:', 5), null);
  });
});

describe('searchEmoji', () => {
  const names = ['joy', 'joystick', 'cat_joy', 'enjoyment', 'thumbsup', 'joy_cat'];

  test('ranks exact, prefix, word-prefix, then substring', () => {
    assert.deepEqual(searchEmoji('joy', names), ['joy', 'joy_cat', 'joystick', 'cat_joy', 'enjoyment']);
  });

  test('respects the limit', () => {
    assert.equal(searchEmoji('joy', names, 2).length, 2);
  });

  test('works against the real builtin table', () => {
    assert.equal(searchEmoji('thumbsu', Object.keys(BUILTIN))[0], 'thumbsup');
  });
});

describe('completeEmoji', () => {
  test('replaces the partial code and adds a trailing space', () => {
    assert.deepEqual(completeEmoji('lol :jo', 7, 'joy'), { text: 'lol :joy: ', cursor: 10 });
  });

  test('keeps text after the cursor', () => {
    assert.deepEqual(completeEmoji(':jo and more', 3, 'joy'), { text: ':joy: and more', cursor: 6 });
  });

  test('does nothing without a partial code', () => {
    assert.deepEqual(completeEmoji('hello', 5, 'joy'), { text: 'hello', cursor: 5 });
  });
});

describe('mergeRecent', () => {
  const { mergeRecent } = require('../static/heckleText.js');
  const msg = (timestamp) => ({ author: 'tom', text: `m${timestamp}`, timestamp });

  test('orders newest first', () => {
    assert.deepEqual(mergeRecent([], [msg(1), msg(3), msg(2)]).map((m) => m.timestamp), [3, 2, 1]);
  });

  test('prepends new messages to existing ones', () => {
    assert.deepEqual(mergeRecent([msg(2), msg(1)], [msg(3)]).map((m) => m.timestamp), [3, 2, 1]);
  });

  test('deduplicates by timestamp', () => {
    assert.equal(mergeRecent([msg(2), msg(1)], [msg(2), msg(3)]).length, 3);
  });

  test('trims to the limit, keeping the newest', () => {
    const many = Array.from({ length: 30 }, (_, i) => msg(i));
    const recent = mergeRecent([], many, 20);
    assert.equal(recent.length, 20);
    assert.equal(recent[0].timestamp, 29);
    assert.equal(recent[19].timestamp, 10);
  });
});

describe('insertEmoji', () => {
  const { insertEmoji } = require('../static/heckleText.js');

  test('inserts into an empty message', () => {
    assert.deepEqual(insertEmoji('', 0, 0, 'joy'), { text: ':joy: ', cursor: 6 });
  });

  test('adds a space after a word', () => {
    assert.deepEqual(insertEmoji('lol', 3, 3, 'joy'), { text: 'lol :joy: ', cursor: 10 });
  });

  test('does not double spaces', () => {
    assert.deepEqual(insertEmoji('lol ', 4, 4, 'joy'), { text: 'lol :joy: ', cursor: 10 });
    assert.deepEqual(insertEmoji('a b', 1, 1, 'joy'), { text: 'a :joy: b', cursor: 7 });
  });

  test('replaces a selection', () => {
    assert.deepEqual(insertEmoji('I love it', 2, 6, 'heart'), { text: 'I :heart: it', cursor: 9 });
  });
});

describe('pickerEmojiNames', () => {
  const { pickerEmojiNames } = require('../static/heckleText.js');

  test('keeps one name per glyph and drops skin tones', () => {
    const names = pickerEmojiNames({ thumbsup: 'T', '+1': 'T', joy: 'J', 'skin-tone-2': 'S' });
    assert.deepEqual(names, ['+1', 'joy']);
  });

  test('every builtin glyph stays reachable', () => {
    const glyphs = new Set(Object.entries(BUILTIN).filter(([n]) => !n.startsWith('skin-tone-')).map(([, g]) => g));
    assert.equal(pickerEmojiNames(BUILTIN).length, glyphs.size);
  });
});
