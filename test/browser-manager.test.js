'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  pickPage,
  buildExtensionConnectHeaders,
  normalizeExtensionBrowser,
} = require('../src/browser-manager');

function makePage(url) {
  return {
    url() {
      return url;
    },
  };
}

test('pickPage prefers the active tab URL when present', () => {
  const first = makePage('https://example.com');
  const second = makePage('https://www.baidu.com/');
  const third = makePage('https://news.ycombinator.com');

  assert.equal(pickPage([first, second, third], 'https://www.baidu.com/'), second);
});

test('pickPage falls back to the most recent tab when active URL is unavailable', () => {
  const first = makePage('https://example.com');
  const second = makePage('https://www.baidu.com/');

  assert.equal(pickPage([first, second], null), second);
  assert.equal(pickPage([first, second], 'https://not-found.example'), second);
});

test('pickPage returns null when no pages are available', () => {
  assert.equal(pickPage([], 'https://example.com'), null);
});

test('normalizeExtensionBrowser defaults to chrome', () => {
  assert.equal(normalizeExtensionBrowser(true), 'chrome');
  assert.equal(normalizeExtensionBrowser(''), 'chrome');
});

test('buildExtensionConnectHeaders maps chrome channel onto chromium', () => {
  const result = buildExtensionConnectHeaders('chrome');

  assert.equal(result.browserType, 'chromium');
  assert.equal(result.headers['x-playwright-browser'], 'chromium');
  assert.deepEqual(JSON.parse(result.headers['x-playwright-launch-options']), {
    channel: 'chrome',
  });
});

test('buildExtensionConnectHeaders maps edge channel onto chromium', () => {
  const result = buildExtensionConnectHeaders('msedge');

  assert.equal(result.browserType, 'chromium');
  assert.equal(result.headers['x-playwright-browser'], 'chromium');
  assert.deepEqual(JSON.parse(result.headers['x-playwright-launch-options']), {
    channel: 'msedge',
  });
});
