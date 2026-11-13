import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [path.resolve('extension/src/observe/render.ts')],
  bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent'
});
const render = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

let refs = 0;
function node(role, name = '', children = [], extra = {}) {
  const { pointer, noRef, ...props } = extra;
  return {
    role, name, children, props: {},
    ref: noRef ? undefined : `e${++refs}`,
    box: { visible: true, inline: false, cursor: pointer ? 'pointer' : 'auto' },
    receivesPointerEvents: true,
    ...props
  };
}
const root = children => ({ role: 'fragment', name: '', children, props: {}, box: { visible: true, inline: false } });
const hooks = () => {
  let count = 0;
  return { elementId: () => `E${++count}`, frame: () => ({ name: 'Ad', token: render.frameTokenFor(7) }) };
};

test('keeps text, structure, states and form values; ids only on actionable elements', () => {
  const tree = root([
    node('navigation', 'Site', [node('link', 'Home', [], { pointer: true, props: { url: 'https://example.com/' } })]),
    node('heading', 'Create token', [], { level: 1 }),
    node('generic', '', [
      node('textbox', 'Token name', ['my token'], { props: { placeholder: 'Name' } }),
      node('checkbox', 'Read access', [], { checked: true }),
      node('button', 'Create', [], { disabled: true, pointer: true })
    ]),
    node('paragraph', '', ['Read the ', node('link', 'docs', [], { pointer: true, props: { url: 'https://other.org/docs' } }), ' first.'])
  ]);
  const text = render.renderAriaTree(tree, hooks(), { pageUrl: 'https://example.com/settings' });
  assert.equal(text, [
    '- navigation "Site":',
    '  - link "Home" [E1] → /',
    '- heading "Create token" [level=1]',
    '- generic:',
    '  - textbox "Token name" [E2] placeholder="Name": my token',
    '  - checkbox "Read access" [checked] [E3]',
    '  - button "Create" [disabled] [E4]',
    '- paragraph: Read the [docs](E5 https://other.org/docs) first.'
  ].join('\n'));
});

test('drops wrappers that only repeat the name and joins inline text without stray spaces', () => {
  const tree = root([
    node('link', 'Issues (2)', [node('generic', '', ['Issues'], { pointer: true }), node('generic', '', ['(2)'], { pointer: true })], { pointer: true, props: { url: '/issues' } }),
    node('textbox', 'Search', ['Search'], {}),
    node('paragraph', '', ['See', node('link', 'docs', [], { pointer: true, props: { url: '/docs' } }), ', then', node('link', 'retry', [], { pointer: true, props: { url: '/r' } }), '.'])
  ]);
  const text = render.renderAriaTree(tree, hooks(), { pageUrl: 'https://example.com/' });
  assert.equal(text, [
    '- link "Issues (2)" [E1] → /issues',
    '- textbox "Search" [E2]: Search',
    '- paragraph: See [docs](E3 /docs), then [retry](E4 /r).'
  ].join('\n'));
});

test('phrasing wrappers such as superscript citations stay inline', () => {
  const tree = root([
    node('paragraph', '', [
      'Markdown',
      node('superscript', '', [node('link', '[9]', [], { pointer: true, props: { url: 'https://w.org/wiki/Markdown#cite-9' } })], { noRef: true }),
      'is a',
      node('link', 'lightweight markup language', [], { pointer: true, props: { url: 'https://w.org/wiki/LML' } }),
      node('strong', '', ['for'], { noRef: true }),
      'text.'
    ]),
    node('list', '', [node('listitem', '', [node('link', 'Item', [], { pointer: true })], { noRef: true })], { noRef: true })
  ]);
  const text = render.renderAriaTree(tree, hooks(), { pageUrl: 'https://w.org/wiki/Markdown' });
  assert.equal(text, [
    '- paragraph: Markdown [[9]](E1 #cite-9) is a [lightweight markup language](E2 /wiki/LML) for text.',
    '- list:',
    '  - listitem:',
    '    - link "Item" [E3]'
  ].join('\n'));
});

test('URLs are shown decoded where lossless, same-page anchors are shortened, and the URL ends the line', () => {
  const page = 'https://zh.wikipedia.org/wiki/Markdown';
  assert.equal(render.shortUrl('https://zh.wikipedia.org/wiki/%E6%A0%87%E8%AE%B0%E8%AF%AD%E8%A8%80', page), '/wiki/标记语言');
  assert.equal(render.shortUrl('https://zh.wikipedia.org/wiki/Markdown#%E5%8E%86%E5%8F%B2', page), '#历史');
  assert.equal(render.shortUrl('/login?return_to=https%3A%2F%2Fgithub.com%2Fa%20b', page), '/login?return_to=https%3A%2F%2Fgithub.com%2Fa%20b');
  assert.equal(render.shortUrl('https://other.org/a%E2%80%8Bb%ZZ', page), 'https://other.org/a%E2%80%8Bb%ZZ');
  const tree = root([node('link', 'Home', [node('img', 'logo', [], { noRef: true }), node('generic', '', ['Welcome back'], { pointer: true })], { pointer: true, props: { url: '/home' } })]);
  assert.equal(render.renderAriaTree(tree, hooks(), { pageUrl: page }), '- link "Home" [E1]: → /home\n  - img "logo"\n  - generic: Welcome back');
});

test('pointer targets get one id for the outermost element; iframes become placeholders', () => {
  const card = node('generic', '', [node('generic', 'Title', [], { pointer: true }), 'More'], { pointer: true });
  const tree = root([card, node('iframe', '', [], {})]);
  const text = render.renderAriaTree(tree, hooks());
  assert.equal(text, '- generic [E1]: Title More\n- iframe "Ad":\n  {{braiser-frame:7}}');
  assert.deepEqual(render.collectActionable(tree), ['generic "Title More"']);
});

test('inventory diff reports added and removed actionable elements as a multiset', () => {
  const before = ['button "Save"', 'button "Save"', 'link "Home"'];
  const after = ['button "Save"', 'link "Home"', 'option "Beijing"', 'option "Shanghai"'];
  assert.deepEqual(render.diffInventories(before, after, 1), {
    added: ['option "Beijing"'], removed: ['button "Save"'], addedCount: 2, removedCount: 1
  });
});

test('frame token pattern keeps indentation for stitching', () => {
  const text = `- main:\n  - iframe:\n    ${render.frameTokenFor(3)}`;
  const found = [...text.matchAll(render.FRAME_TOKEN_PATTERN)].map(match => [match[1], match[2]]);
  assert.deepEqual(found, [['    ', '3']]);
});
