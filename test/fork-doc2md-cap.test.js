// Added in realmi-lab/sprag-fork2 (2026-11): the Office markup baseline is capped
// at what one Read can put into context. See FORK_CHANGES.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { estimateCodexDocument, CODEX_READ_CAP_TOKENS } from '../src/codex/doc2md-ledger.js';

const require = createRequire(import.meta.url);
const ledger = require('../src/doc2md-ledger.cjs');

test('both doc2md ledgers use the same Read cap as the measured .fig baseline', () => {
  assert.equal(ledger.READ_CAP_TOKENS, 44_000);
  assert.equal(CODEX_READ_CAP_TOKENS, ledger.READ_CAP_TOKENS);
  assert.equal(ledger.estimateSaving({ ext: '.fig', markdown: 'x' }).baseline, ledger.READ_CAP_TOKENS);
});

test('a deck too large to read is credited at most one Read, a small one keeps its size', () => {
  const markdown = 'x'.repeat(4000); // ~1,000 tokens
  // the 2.1MB of slide XML behind the README's 540,429-token deck
  const deck = ledger.estimateSaving({ ext: '.pptx', markupBytes: 2_161_716, markdown });
  assert.equal(deck.baseline, 44_000);
  const small = ledger.estimateSaving({ ext: '.docx', markupBytes: 40_000, markdown });
  assert.equal(small.baseline, 10_000);
});

test('the Codex estimate caps the same way and says when it did', () => {
  const opts = { model: 'parent', provider: 'gateway', prices: { provider: 'gateway', checkedAt: 1, prices: { parent: { input: 0.00001 } } } };
  const big = estimateCodexDocument('/deck.pptx', { markupBytes: 2_161_716, markdownBytes: 4000 }, opts);
  assert.equal(big.baseline, 44_000);
  assert.equal(big.capped, true);
  const small = estimateCodexDocument('/deck.pptx', { markupBytes: 4000, markdownBytes: 400 }, opts);
  assert.equal(small.baseline, 1000);
  assert.equal(small.capped, false);
});
