import test from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, escapeHtml, SafeHtml } from '../src/html.js';

test('escapes every interpolation by default', () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const output = String(html`<h1>${hostile}</h1>`);
  assert.equal(output.includes('<img'), false, 'markup in a value must never reach the output');
  assert.equal(output, '<h1>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</h1>');
  assert.match(String(html`<p>${"O'Brien & Sons"}</p>`), /O&#39;Brien &amp; Sons/);
});

test('inlines nested SafeHtml without double-escaping it', () => {
  const inner = html`<b>${'Tom & Jerry'}</b>`;
  assert.equal(String(html`<p>${inner}</p>`), '<p><b>Tom &amp; Jerry</b></p>');
});

test('serializes arrays so a list of views needs no join', () => {
  const items = ['a & b', 'c'].map((value) => html`<li>${value}</li>`);
  assert.equal(String(html`<ul>${items}</ul>`), '<ul><li>a &amp; b</li><li>c</li></ul>');
});

test('drops nullish and false so conditional branches stay empty', () => {
  assert.equal(String(html`<p>${null}${undefined}${false}</p>`), '<p></p>');
  assert.equal(String(html`<p>${0}</p>`), '<p>0</p>', 'zero is a value, not an absence');
  /* false renders as nothing, so boolean attributes must be stringified explicitly. */
  assert.equal(String(html`<b aria-pressed="${String(false)}">`), '<b aria-pressed="false">');
});

test('raw() is the only way to inject markup, and only for markup we wrote', () => {
  assert.equal(String(html`<p>${raw('<em>ours</em>')}</p>`), '<p><em>ours</em></p>');
  assert.equal(raw('<em>x</em>') instanceof SafeHtml, true);
});

test('a template always produces SafeHtml, which is what the policy checks for', () => {
  const view = html`<p>hello</p>`;
  assert.equal(view instanceof SafeHtml, true);
  assert.equal(view.value, String(view));
  assert.equal(new SafeHtml('<p>x</p>') instanceof SafeHtml, true);
});

test('escapeHtml covers every character that can break out of markup', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml(undefined), '');
});
