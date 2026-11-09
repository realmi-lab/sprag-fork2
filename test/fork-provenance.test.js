// Added in realmi-lab/sprag-fork2 (2026-11): a default preset registered by the
// automatic install must not be presented to the model as a rule the user
// approved. See FORK_CHANGES.md.
import './helpers/grade-cost.js'; // grade 'cost', set before any src module loads
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeHint } from '../src/route-inject.js';
import { isUserApprovedRule, renderModelRatchet } from '../src/model-rules.js';

const EMPTY = mkdtempSync(join(tmpdir(), 'fork-noagents-'));
test.after(() => rmSync(EMPTY, { recursive: true, force: true }));

function withEmptyHome(fn) {
  const prev = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  process.env.HOME = EMPTY;
  process.env.USERPROFILE = EMPTY;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.HOME; else process.env.HOME = prev;
    if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
  }
}

const base = { category: 'check', tier: 'T2', agent: 't2-explore', budget: { calls: 8, out: 1500 } };
const scanned = { ...base };
const autoPreset = { ...base, origin: 'preset', userConfirmed: false, signature: 'T2|check|preset' };
const legacyPreset = { ...base, origin: 'preset', signature: 'T2|check|preset' };
const confirmedPreset = { ...base, origin: 'preset', userConfirmed: true, signature: 'T2|check|preset' };

const hint = (rule, lang = 'ko') =>
  withEmptyHome(() => routeHint('지금 실행 중인 버전이 뭔지 확인해줘', { rules: [rule], lang, root: EMPTY }));

test('isUserApprovedRule: scanned and confirmed rules yes, automatic and legacy presets no', () => {
  assert.equal(isUserApprovedRule(scanned), true);
  assert.equal(isUserApprovedRule(confirmedPreset), true);
  assert.equal(isUserApprovedRule(autoPreset), false);
  assert.equal(isUserApprovedRule(legacyPreset), false, 'a preset from before the field existed is not claimed as approved');
  assert.equal(isUserApprovedRule(null), false);
});

test('a default preset hint recommends instead of claiming approval', () => {
  for (const rule of [autoPreset, legacyPreset]) {
    const ko = hint(rule, 'ko');
    assert.ok(ko, 'the preset still produces a hint');
    assert.match(ko, /기본 프리셋 위임 룰/);
    assert.match(ko, /개별 승인 없음/);
    assert.match(ko, /직접 처리하십시오/);
    assert.doesNotMatch(ko, /이미 승인한/);
    assert.doesNotMatch(ko, /되묻지 말고/);
    const en = hint(rule, 'en');
    assert.match(en, /default sprag preset/);
    assert.doesNotMatch(en, /already approved/);
    assert.doesNotMatch(en, /Do not ask again/);
  }
});

test('a rule the user approved keeps the original wording', () => {
  for (const rule of [scanned, confirmedPreset]) {
    assert.match(hint(rule, 'ko'), /사용자가 이미 승인한 위임 룰/);
    assert.match(hint(rule, 'en'), /already approved/);
  }
});

test('the rule file labels each preset by where it came from', () => {
  const rule = (extra) => ({ ...base, rule: '"상태 확인·검증" 요청은 t2-explore로 위임', promotedAt: '2026-11-09', ...extra });
  const ko = renderModelRatchet([rule({ origin: 'preset', userConfirmed: false })], 'ko', { root: EMPTY });
  assert.match(ko, /기본 프리셋\(큐레이션\), 개별 승인 없음, registered 2026-11-09/);
  assert.doesNotMatch(ko, /이미 승인했습니다/);
  const en = renderModelRatchet([rule({ origin: 'preset', userConfirmed: true })], 'en', { root: EMPTY });
  assert.match(en, /preset \(curated\), approved by the user, registered 2026-11-09/);
  assert.doesNotMatch(en, /has already approved/);
});
