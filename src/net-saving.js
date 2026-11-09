/**
 * net-saving — the v3 delegation counterfactual.
 *
 * v2 priced the subagent's own tokens at the session model's rates and called
 * the difference the saving. That leaves out what makes a long-lived main
 * session expensive: every call it makes re-reads its whole context from the
 * cache, and everything a tool returns stays in that context for the rest of
 * the session. It also leaves out what delegating costs the main session: the
 * prompt it writes and the report that comes back and is then re-read.
 *
 * For one delegated run, with
 *   k    subagent calls, ctx_i the context of call i, g_i = ctx_i - ctx_1
 *   G    ctx_k - ctx_1 + the run's total output (what the main context would
 *        have gained)
 *   C    context of the main call that issued the delegation
 *   N    main calls that follow, up to the next compaction (capped)
 *   P    tokens of the delegation prompt, R tokens of the report that returned
 * the main model doing the work itself would have cost
 *   CF_work  = sum_i (C + g_i) * cacheRead + sum_i (newIn_i * write + out_i * output)
 *   CF_carry = G * N * cacheRead
 * and delegating actually cost
 *   Actual   = what the run cost on its own model
 *              + P * output + R * write + R * N * cacheRead
 * so  saving = CF_work + CF_carry - Actual.
 *
 * Rates are the main model's, per token, from the same price paths as every
 * other figure (list table, or the LiteLLM gateway table when one is set). A
 * rate that is not known makes the saving null; nothing is filled in.
 *
 * Modified in realmi-lab/sprag-fork2 (2026-11), see FORK_CHANGES.md. Three
 * optional inputs make the estimate more conservative; route-scan passes all three
 * (basis 'v4'), and leaving them out reproduces v3 exactly:
 *   skipFirstWrite  the subagent's first-call new input is its own system
 *                   prompt, tool list and brief, which the main model would
 *                   never have written.
 *   mainCalls       how many calls the main model would have made (K). v3 used
 *                   the subagent's call count k, so a run that wandered longer
 *                   was credited with more main-context re-reads. The re-read
 *                   term becomes min(k, K) * (C + mean g_i).
 *   delegationCalls the main calls the delegation itself takes (D): the one that
 *                   issues it and the one that reads the report. Each re-reads
 *                   C, and v3 counted them on neither side, so Actual adds
 *                   D * C * cacheRead.
 * Replaying two measured runs (an Opus 5.5 session at ~270k context, one
 * 20-file read and one grep lookup, both delegated to Haiku 5.5), v3 recorded
 * 1.4x and 3.2x the measured saving; with these inputs both land within 10%.
 */

import { sessionCost } from './claude-price.js';
import { gatewayBase } from './gateway-auth.js';

// estimateCost rounds to cents. A per-token rate or a sub-cent run would vanish
// in that rounding, so both are priced at a larger quantity and scaled back
// (a run to 1e-8 USD, a rate to 1e-12 USD per token).
const RATE_SCALE = 1e9;
const COST_SCALE = 1e6;

const ZERO = { input: 0, cacheCreation: 0, cacheRead: 0, ephemeral5m: 0, ephemeral1h: 0, output: 0 };

/** Where a price came from: the Anthropic list table, or a LiteLLM gateway. */
export function priceSource(env = process.env) {
  return gatewayBase(env) ? 'gateway' : 'list';
}

/**
 * Per-token USD rates of a model for the three token classes the counterfactual
 * touches. Cache writes are taken at the 5-minute rate, the cheaper of the two.
 * null when any of them has no price.
 */
export function unitRates(model, { env = process.env, at } = {}) {
  if (!model) return null;
  const rate = (totals) => {
    let c;
    try { c = sessionCost({ ...ZERO, ...totals }, model, { env, at }); } catch { return null; }
    return c ? c.actual / RATE_SCALE : null;
  };
  const cacheRead = rate({ cacheRead: RATE_SCALE });
  const write = rate({ cacheCreation: RATE_SCALE, ephemeral5m: RATE_SCALE });
  const output = rate({ output: RATE_SCALE });
  if (cacheRead === null || write === null || output === null) return null;
  return { cacheRead, write, output };
}

/**
 * What a run's tokens cost on a model, in USD, to better than a cent. null when
 * the model has no price on this path.
 */
export function exactCost(totals, model, { env = process.env, at } = {}) {
  if (!model) return null;
  const scale = (t) => {
    const out = {};
    for (const f of Object.keys(ZERO)) out[f] = (t[f] || 0) * COST_SCALE;
    return out;
  };
  const scaled = scale(totals);
  if (totals.long) scaled.long = scale(totals.long);
  let c;
  try { c = sessionCost(scaled, model, { env, at }); } catch { return null; }
  return c ? c.actual / COST_SCALE : null;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The v3 saving of one delegated run, or null when an input is missing (the
 * caller then falls back to the v2 formula).
 *
 * @param {object} p
 * @param {Array<{ctx:number,newIn:number,out:number}>} p.calls subagent calls, in order
 * @param {number} p.mainCtx C
 * @param {number} p.followUps N
 * @param {number} p.promptTokens P
 * @param {number} p.resultTokens R
 * @param {{cacheRead:number,write:number,output:number}} p.rates main model, USD per token
 * @param {number} p.subActual what the run cost on its own model, USD
 * @param {boolean} [p.skipFirstWrite] leave the first call's new input out of CF_work
 * @param {number|null} [p.mainCalls] K, the main model's call estimate; omitted means k (v3)
 * @param {number} [p.delegationCalls] D, main calls spent issuing and reading the delegation; 0 is v3
 * @returns {{usd:number,cfWork:number,cfCarry:number,overhead:number,actual:number,rereadCalls:number}|null}
 */
export function netSavingV3({ calls, mainCtx, followUps, promptTokens, resultTokens, rates, subActual, skipFirstWrite = false, mainCalls = null, delegationCalls = 0 }) {
  if (!Array.isArray(calls) || calls.length === 0) return null;
  if (!calls.every((c) => c && isNum(c.ctx) && isNum(c.newIn) && isNum(c.out))) return null;
  if (!isNum(mainCtx) || mainCtx <= 0) return null;
  if (!isNum(followUps) || followUps < 0) return null;
  if (!isNum(promptTokens) || promptTokens < 0) return null;
  if (!isNum(resultTokens) || resultTokens < 0) return null;
  if (!rates || !isNum(rates.cacheRead) || !isNum(rates.write) || !isNum(rates.output)) return null;
  if (!isNum(subActual) || subActual < 0) return null;
  if (!isNum(delegationCalls) || delegationCalls < 0) return null;

  const { rereadTokens, newIn, totalOut, G, k } = workShape(calls, mainCtx, { skipFirstWrite, mainCalls });
  const cfReread = rereadTokens * rates.cacheRead;
  const cfWork = cfReread + newIn * rates.write + totalOut * rates.output;
  const cfCarry = G * followUps * rates.cacheRead;
  const overhead = promptTokens * rates.output
    + resultTokens * rates.write
    + resultTokens * followUps * rates.cacheRead
    + delegationCalls * mainCtx * rates.cacheRead;
  const actual = subActual + overhead;
  // cfReread is the part of cfWork spent re-reading context; the rest is new
  // input and output. Split out so the savings page can show each term.
  return { usd: cfWork + cfCarry - actual, cfWork, cfReread, cfCarry, overhead, actual, subActual, rereadCalls: k };
}

/**
 * The token shape of the counterfactual, shared by netSavingV3 and
 * netSavingQuantities so the two cannot drift. With mainCalls omitted the
 * re-read total equals v3's sum_i (C + g_i).
 */
function workShape(calls, mainCtx, { skipFirstWrite = false, mainCalls = null } = {}) {
  const ctx1 = calls[0].ctx;
  const grow = (c) => Math.max(0, c.ctx - ctx1);
  let growSum = 0;
  let newIn = 0;
  let totalOut = 0;
  calls.forEach((c, i) => {
    growSum += grow(c);
    if (!(skipFirstWrite && i === 0)) newIn += c.newIn;
    totalOut += c.out;
  });
  const k = isNum(mainCalls) && mainCalls >= 1 ? Math.min(calls.length, Math.max(1, Math.round(mainCalls))) : calls.length;
  // k calls, each re-reading the main context plus the average growth so far.
  const rereadTokens = k * mainCtx + (k / calls.length) * growSum;
  const G = grow(calls[calls.length - 1]) + totalOut;
  return { rereadTokens, newIn, totalOut, G, k };
}

/**
 * The v3 saving is linear in the main model's three rates, so a run can be
 * stored as three token quantities and priced later at whatever rates applied
 * when it ran (#15). With G = grow_last + the run's output and N = followUps:
 *   cacheRead = sum(mainCtx + grow_i) + G * N - R * N
 *   write     = sum(newIn_i) (the first call's left out under skipFirstWrite) - R
 *   output    = sum(out_i) - P
 * and usd = cacheRead * rates.cacheRead + write * rates.write
 *           + output * rates.output - subActual (see savingFromQuantities).
 * Same inputs and validation as netSavingV3, minus rates and subActual. With
 * mainCalls and delegationCalls (fork, basis 'v4') the cacheRead quantity is
 *   min(k, K) * C + (min(k, K) / k) * sum(grow_i) + G * N - R * N - D * C.
 *
 * @returns {{cacheRead:number,write:number,output:number}|null}
 */
export function netSavingQuantities({ calls, mainCtx, followUps, promptTokens, resultTokens, skipFirstWrite = false, mainCalls = null, delegationCalls = 0 }) {
  if (!Array.isArray(calls) || calls.length === 0) return null;
  if (!calls.every((c) => c && isNum(c.ctx) && isNum(c.newIn) && isNum(c.out))) return null;
  if (!isNum(mainCtx) || mainCtx <= 0) return null;
  if (!isNum(followUps) || followUps < 0) return null;
  if (!isNum(promptTokens) || promptTokens < 0) return null;
  if (!isNum(resultTokens) || resultTokens < 0) return null;
  if (!isNum(delegationCalls) || delegationCalls < 0) return null;

  const { rereadTokens, newIn, totalOut, G } = workShape(calls, mainCtx, { skipFirstWrite, mainCalls });
  return {
    cacheRead: rereadTokens + G * followUps - resultTokens * followUps - delegationCalls * mainCtx,
    write: newIn - resultTokens,
    output: totalOut - promptTokens,
  };
}

/** The v3 saving in USD from stored quantities; null when any input is not finite. */
export function savingFromQuantities(q, rates, subActual) {
  if (!q || !isNum(q.cacheRead) || !isNum(q.write) || !isNum(q.output)) return null;
  if (!rates || !isNum(rates.cacheRead) || !isNum(rates.write) || !isNum(rates.output)) return null;
  if (!isNum(subActual)) return null;
  return q.cacheRead * rates.cacheRead + q.write * rates.write + q.output * rates.output - subActual;
}
