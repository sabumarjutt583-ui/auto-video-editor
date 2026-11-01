import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const helper = readFileSync(new URL('../src-tauri/src/imagegen/flow_dom.js', import.meta.url), 'utf8');
function node(id, children = [], shadowRoot = null) {
  const element = { id, children, shadowRoot, innerText: id };
  element.querySelectorAll = selector => children.flatMap(child => [child, ...child.querySelectorAll('*')])
    .filter(child => selector === '*' || selector === '[id]' || selector === `#${child.id}`);
  element.querySelector = selector => element.querySelectorAll(selector)[0] || null;
  return element;
}
function evaluate(document, expression) {
  return runInNewContext(`(${helper})(${JSON.stringify(expression)})`, { document });
}
test('finds the video tool through nested shadow roots and scopes controls to it', () => {
  const input = node('ave-prompts-input');
  const tool = node('ave-video-studio', [input]);
  const inner = node('', [tool]);
  const outer = node('', [node('inner-host', [], inner)]);
  const document = node('page', [node('unrelated'), node('outer-host', [], outer)]);
  document.body = document;
  assert.equal(evaluate(document, "document.getElementById('ave-video-studio').id"), tool.id);
  assert.equal(evaluate(document, "document.querySelector('#ave-prompts-input').id"), input.id);
  assert.equal(evaluate(document, "document.getElementById('unrelated')"), null);
  assert.equal(evaluate(document, 'document.body.innerText'), tool.id);
});
test('keeps the project picker document usable before the video tool mounts', () => {
  const document = node('page', [node('picker')]);
  document.body = document;
  assert.equal(evaluate(document, "document.querySelector('#picker').id"), 'picker');
  assert.equal(evaluate(document, 'document.body.innerText'), 'page');
});
