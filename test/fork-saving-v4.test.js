// Added in realmi-lab/sprag-fork2 (2026-11): the v4 saving basis.
// See FORK_CHANGES.md for the measurements below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { netSavingV3, netSavingQuantities, savingFromQuantities } from '../src/net-saving.js';
import { mainCallEstimate, median, DEFAULT_MAIN_CALLS, DELEGATION_MAIN_CALLS, MIN_MAIN_CALL_SAMPLES } from '../src/route-scan.js';

// Opus 5.5 list rates per token, as unitRates() returns them (5-minute write).
const OPUS = { cacheRead: 0.2e-6, write: 5e-6, output: 20e-6 };
const V4 = { skipFirstWrite: true, mainCalls: DEFAULT_MAIN_CALLS, delegationCalls: DELEGATION_MAIN_CALLS };

/** k subagent calls doing the same work: context grows 20k -> 80k, 80k new input, 5k output in total. */
function spread(k) {
  const calls = [];
  for (let i = 0; i < k; i += 1) {
    calls.push({
      ctx: 20000 + (k === 1 ? 0 : (60000 * i) / (k - 1)),
      newIn: i === 0 ? 20000 : 60000 / (k - 1),
      out: 5000 / k,
    });
  }
  return calls;
}

/** What those calls cost on Haiku 4.5 (read 0.1, write 1.25, output 5 per million). */
function haikuCost(calls) {
  return calls.reduce((s, c, i) => s + (i === 0 ? 0 : c.ctx - c.newIn) * 0.1e-6 + c.newIn * 1.25e-6 + c.out * 5e-6, 0);
}

const inputs = (calls, extra = {}) => ({
  calls, mainCtx: 300000, followUps: 30, promptTokens: 500, resultTokens: 2000, rates: OPUS, subActual: haikuCost(calls), ...extra,
});

test('v3 credited a subagent more the longer it wandered; v4 does not', () => {
  const v3 = (k) => netSavingV3(inputs(spread(k))).usd;
  const v4 = (k) => netSavingV3(inputs(spread(k), V4)).usd;
  // Same work, same token totals, only the number of subagent calls differs.
  assert.ok(v3(50) > v3(6) * 2, `v3 grows with the call count: ${v3(6)} -> ${v3(50)}`);
  assert.ok(v4(50) <= v4(6), `v4 must not reward extra calls: ${v4(6)} -> ${v4(50)}`);
});

test('leaving the v4 inputs out reproduces v3 exactly', () => {
  const calls = spread(7);
  const a = netSavingV3(inputs(calls));
  const b = netSavingV3(inputs(calls, { skipFirstWrite: false, mainCalls: null, delegationCalls: 0 }));
  assert.equal(a.usd, b.usd);
  assert.deepEqual(netSavingQuantities(inputs(calls)), netSavingQuantities(inputs(calls, { mainCalls: null })));
});

test('a delegation the main model could have answered in one call is a loss', () => {
  // The subagent needed a single call and no tools; inline that is one main call,
  // delegated it is two (issue, read back) plus the subagent.
  const calls = [{ ctx: 18000, newIn: 18000, out: 200 }];
  const r = netSavingV3(inputs(calls, V4));
  assert.ok(r.usd < 0, `expected a loss, got ${r.usd}`);
  assert.equal(r.rereadCalls, 1);
});

test('the stored quantities price to the same v4 figure', () => {
  const calls = spread(9);
  const r = netSavingV3(inputs(calls, V4));
  const q = netSavingQuantities(inputs(calls, V4));
  const usd = savingFromQuantities(q, OPUS, haikuCost(calls));
  assert.ok(Math.abs(usd - r.usd) < 1e-12, `${usd} != ${r.usd}`);
});

// Two measured runs from one Opus 5.5 session (~270k context, 1-hour cache),
// each task done once inline (a fork of the session) and once delegated to a
// Haiku 5.5 subagent. Per-call usage comes from the subagent transcripts;
// "measured" is inline cost minus delegated cost including 30 later main calls.
const MEASURED = {
  // 20 files read and summarised in one line each
  read20: {
    calls: [{ ctx: 53789, newIn: 17597, out: 205 }, { ctx: 59338, newIn: 5551, out: 1542 }, { ctx: 104654, newIn: 45318, out: 1798 }],
    subActual: 0.0405, resultChars: 2560, measured: 0.606,
  },
  // every `log.warn(` call in a 17k-line tree, found with two greps
  grep: {
    calls: [{ ctx: 53767, newIn: 17575, out: 289 }, { ctx: 62835, newIn: 9070, out: 1123 }],
    subActual: 0.0049, resultChars: 2029, measured: 0.093,
  },
};

for (const [name, m] of Object.entries(MEASURED)) {
  test(`replay ${name}: v4 lands near the measured saving, v3 overstated it`, () => {
    const base = {
      calls: m.calls, mainCtx: 277565, followUps: 30, promptTokens: 1283, resultTokens: m.resultChars / 4, rates: OPUS, subActual: m.subActual,
    };
    const v3 = netSavingV3(base).usd;
    const v4 = netSavingV3({ ...base, ...V4 }).usd;
    assert.ok(v3 / m.measured > 1.3, `v3 ${v3.toFixed(3)} vs measured ${m.measured}`);
    assert.ok(Math.abs(v4 - m.measured) / m.measured < 0.15, `v4 ${v4.toFixed(3)} vs measured ${m.measured}`);
  });
}

test('mainCallEstimate prefers the project, then all history, then the default', () => {
  const samples = new Map([
    ['explore|proj', [3, 4, 5, 6, 7]],
    ['explore|*', [2, 2, 3, 9, 9, 9]],
    ['run|proj', [1, 1]],
    ['run|*', [4, 4, 4, 5, 6]],
  ]);
  assert.equal(mainCallEstimate(samples, 'explore', 'proj'), 5);
  assert.equal(mainCallEstimate(samples, 'explore', 'other'), 6, 'too few in the project: all history, median of six');
  assert.equal(mainCallEstimate(samples, 'run', 'proj'), 4);
  assert.equal(mainCallEstimate(samples, 'paste', 'proj'), DEFAULT_MAIN_CALLS);
  assert.equal(mainCallEstimate(undefined, 'run', 'proj'), DEFAULT_MAIN_CALLS);
  assert.equal(MIN_MAIN_CALL_SAMPLES, 5);
  assert.equal(median([]), null);
  assert.equal(median([4, 1, 3]), 3);
});
