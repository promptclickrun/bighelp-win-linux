import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, safeLink, inlineText, MARKDOWN_LIMITS } from '../packages/ui/markdown.ts';

const blocks = source => parseMarkdown(source).blocks;

test('headings, paragraphs, rules and soft breaks', () => {
  assert.deepEqual(blocks('# Title\n\nHello\nworld\n\n---\n## Two ##'), [
    { kind: 'heading', level: 1, children: [{ kind: 'text', text: 'Title' }] },
    { kind: 'paragraph', children: [{ kind: 'text', text: 'Hello' }, { kind: 'break' }, { kind: 'text', text: 'world' }] },
    { kind: 'rule' },
    { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'Two' }] },
  ]);
  assert.equal(blocks('Setext\n===')[0].kind, 'heading');
  assert.deepEqual(blocks('#hashtag')[0].kind, 'paragraph');
});

test('emphasis, code spans, strikethrough and escapes', () => {
  assert.deepEqual(parseInline('**bold** and *it* and `a*b*` and ~~gone~~ and \\*lit\\*'), [
    { kind: 'strong', children: [{ kind: 'text', text: 'bold' }] }, { kind: 'text', text: ' and ' },
    { kind: 'em', children: [{ kind: 'text', text: 'it' }] }, { kind: 'text', text: ' and ' },
    { kind: 'code', text: 'a*b*' }, { kind: 'text', text: ' and ' },
    { kind: 'del', children: [{ kind: 'text', text: 'gone' }] }, { kind: 'text', text: ' and *lit*' },
  ]);
  assert.deepEqual(parseInline('snake_case_name'), [{ kind: 'text', text: 'snake_case_name' }]);
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ kind: 'text', text: '2 * 3 * 4' }]);
  assert.deepEqual(parseInline('**unclosed'), [{ kind: 'text', text: '**unclosed' }]);
});

test('fenced code keeps exact text, including while a reply is still streaming', () => {
  assert.deepEqual(blocks('```ts\nconst a = 1;\n  indented\n```\nafter'), [
    { kind: 'code', language: 'ts', text: 'const a = 1;\n  indented' },
    { kind: 'paragraph', children: [{ kind: 'text', text: 'after' }] },
  ]);
  assert.deepEqual(blocks('```python\nprint(1)'), [{ kind: 'code', language: 'python', text: 'print(1)' }]);
  assert.deepEqual(blocks('~~~\n```\n~~~'), [{ kind: 'code', language: '', text: '```' }]);
});

test('lists nest, number, and mark tasks', () => {
  const [list] = blocks('1. one\n2. two\n   - inner\n   - [x] done\n3. three');
  assert.equal(list.kind, 'list'); assert.equal(list.ordered, true); assert.equal(list.items.length, 3);
  const nested = list.items[1].children[1];
  assert.equal(nested.kind, 'list'); assert.equal(nested.ordered, false);
  assert.equal(nested.items[1].checked, true);
  assert.equal(inlineText(nested.items[1].children[0].children), 'done');
  const [start] = blocks('7) seven\n8) eight');
  assert.equal(start.start, 7);
  const [loose] = blocks('- a\n\n- b\n\n  more b');
  assert.equal(loose.items.length, 2); assert.equal(loose.items[1].children.length, 2);
});

test('quotes and tables', () => {
  const [quote] = blocks('> quoted **text**\n> more');
  assert.equal(quote.kind, 'quote'); assert.equal(quote.children[0].kind, 'paragraph');
  const [table] = blocks('| Name | Qty |\n|:-----|----:|\n| Apple | 3 |\n| Pipe \\| char | `a|b` |');
  assert.equal(table.kind, 'table');
  assert.deepEqual(table.align, ['left', 'right']);
  assert.equal(table.rows.length, 2);
  assert.equal(inlineText(table.rows[1][0]), 'Pipe | char');
  assert.equal(inlineText(table.rows[1][1]), 'a|b');
});

test('links: only http, https and mailto become clickable', () => {
  assert.deepEqual(parseInline('[site](https://example.com/a?b=1)'), [{ kind: 'link', href: 'https://example.com/a?b=1', children: [{ kind: 'text', text: 'site' }] }]);
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'https://user:pw@example.com', 'vbscript:x']) {
    assert.equal(safeLink(bad), null, bad);
    assert.equal(parseInline(`[x](${bad})`).some(node => node.kind === 'link'), false, bad);
  }
  assert.deepEqual(parseInline('see https://example.com/path.'), [{ kind: 'text', text: 'see ' },
    { kind: 'link', href: 'https://example.com/path', children: [{ kind: 'text', text: 'https://example.com/path' }] }, { kind: 'text', text: '.' }]);
  assert.equal(parseInline('(https://example.com/x)')[1].href, 'https://example.com/x');
  assert.deepEqual(parseInline('![chart](https://example.com/c.png)'), [{ kind: 'link', href: 'https://example.com/c.png', children: [{ kind: 'text', text: 'Image: chart' }] }]);
});

test('bounded: very long or deeply nested input stays fast and literal', () => {
  const huge = 'x'.repeat(MARKDOWN_LIMITS.characters + 1);
  const result = parseMarkdown(huge);
  assert.equal(result.truncated, true); assert.equal(result.blocks[0].text, huge);
  const deep = '>'.repeat(200) + ' deep';
  const started = performance.now(); parseMarkdown(deep); parseInline('*'.repeat(5000) + 'a' + '*'.repeat(5000));
  parseMarkdown('- '.repeat(500) + 'x'); parseMarkdown('[' .repeat(3000) + 'x' + ']'.repeat(3000));
  assert.ok(performance.now() - started < 2000);
});

test('previews drop Markdown syntax but keep the words', async () => {
  const { plainPreview } = await import('../packages/ui/markdown.ts');
  assert.equal(plainPreview('### README.txt First Line\n1|Hello **world**'), 'README.txt First Line 1 Hello world');
  assert.equal(plainPreview('| Fruit | Color |\n|---|---|\n| Apple | Red |'), 'Fruit Color Apple Red');
  assert.equal(plainPreview('- [x] done\n- see [docs](https://x.y) and `code`'), 'done see docs and code');
  assert.equal(plainPreview('```py\nprint(1)\n```'), 'print(1)');
  assert.equal(plainPreview('snake_case_name'), 'snake_case_name');
});
