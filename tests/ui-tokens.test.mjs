import assert from 'node:assert/strict';
import test from 'node:test';
import { PALETTES, TEXT_PAIRS, contrastRatio, fontStack, LAYOUT } from '../packages/ui/tokens.ts';

test('tokens: contrast ratio follows WCAG relative luminance', () => {
  assert.equal(contrastRatio('#FFFFFF', '#000000'), 21);
  assert.equal(contrastRatio('#7B52E0', '#7B52E0'), 1);
  assert.equal(contrastRatio('#000000', '#FFFFFF'), contrastRatio('#FFFFFF', '#000000'));
  for (const bad of ['FFFFFF', '#FFF', '#GGGGGG', '', '#FFFFFF00']) assert.throws(() => contrastRatio(bad, '#000000'), bad);
});

test('tokens: every text pair is at least 4.5:1 in light and dark', () => {
  for (const [theme, palette] of Object.entries(PALETTES)) {
    for (const [ink, surface] of TEXT_PAIRS) {
      const ratio = contrastRatio(palette[ink], palette[surface]);
      assert.ok(ratio >= 4.5, `${theme}: ${ink} on ${surface} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('tokens: brand values match the pinned BighelpTheme description', () => {
  assert.equal(PALETTES.light.page, '#FFF9F5');
  assert.equal(PALETTES.light.ink, '#1C1A19');
  assert.equal(PALETTES.light.incoming, '#F3ECE6');
  assert.equal(PALETTES.light.action, '#7B52E0');
  assert.equal(PALETTES.dark.page, '#121110');
  assert.equal(PALETTES.dark.action, '#C9B6FF');
  assert.equal(PALETTES.dark.outgoing, '#7B52E0');
  assert.equal(PALETTES.light.ember, '#FF8A7A');
  assert.equal(Object.isFrozen(PALETTES.light), true);
});

test('tokens: platform font stacks name only installed system faces, nothing bundled', () => {
  assert.match(fontStack('windows'), /^"Segoe UI Variable Text", "Segoe UI"/u);
  assert.match(fontStack('linux'), /^"Noto Sans"/u);
  for (const platform of ['windows', 'linux', 'other']) assert.match(fontStack(platform), /sans-serif$/u);
  assert.equal(LAYOUT.narrowBreakpoint, 900);
});
