// Every emoji shortcode in the server's success quips must render on the submit page
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { EMOJI_PATTERN } = require('../static/heckleText.js');

const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/builtinEmojis.js'), 'utf8'), context);
const BUILTIN = context.BUILTIN_EMOJIS;

const appSource = fs.readFileSync(path.join(__dirname, '../app.py'), 'utf8');
const quipsBlock = appSource.match(/SUCCESS_RESPONSES = \[([\s\S]*?)\n\]/)[1];

test('success quips are found in app.py', () => {
  assert.ok(quipsBlock.split('\n').filter((line) => line.trim()).length > 5);
});

test('every quip emoji is a known builtin emoji', () => {
  const names = [...quipsBlock.matchAll(new RegExp(EMOJI_PATTERN.source, 'gi'))].map((m) => m[1]);
  assert.ok(names.length > 0);
  const missing = names.filter((name) => !Object.hasOwn(BUILTIN, name));
  assert.deepEqual(missing, []);
});
