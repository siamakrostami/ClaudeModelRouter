import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, DEFAULT_SETUP } from '../src/core/defaults.js';
import { classify, note } from '../src/core/classify.js';

const c = p => classify(p, DEFAULT_RULES, DEFAULT_SETUP);
const role = p => c(p)?.role ?? null;

const cases = [
  ['Plan the migration to the new API', 'plan'],
  ['Review my PR diff', 'review'],
  ['Debug the flaky upload test', 'hard'],
  ['Implement the trips endpoint', 'code'],
  ['Write a Slack reply to Ali', 'write'],
  ['rename foo to bar', 'chores'],
  ['commit message for this', 'chores'],
  ['review the plan', 'review'],
  ['Build the new settings screen in SwiftUI', 'hard'],
  ['Draft the PR description for this branch', 'write'],
];
for (const [prompt, expected] of cases) {
  test(`"${prompt}" → ${expected}`, () => assert.equal(role(prompt), expected));
}

const realWorld = [
  ['implement the plan', 'code'],
  ['execute the plan we just wrote', 'code'],
  ['is there a bug in this approach?', 'review'],
  ['address the review comments on PR 12', 'code'],
  ['check the changes I made', null],
  ['pick up ticket MOB-412 and start on it', 'code'],
  ['work on the jira ticket CE-123', 'code'],
  ['add email validation to the signup form', 'code'],
  ['update the ticket status field in the Trip model', 'code'],
  ['send a message to the BLE device', null],
  ['find the root cause of this failure', 'hard'],
  ['find where the race is', 'hard'],
  ['what format should the API response use', null],
  ['format the date string as ISO in TripCell', 'code'],
  ['docker compose up fails', null],
  ['fix the typo in README', 'code'],
  ['why does the login screen crash', 'hard'],
  ["what's the plan for today", null],
  ['look up which line of notes.txt contains foo', 'chores'],
  ['run the linter on the trips module', 'chores'],
  ['draft a reply to the Slack thread about the release', 'write'],
  ['write the release notes for 2.4', 'write'],
  ['how should we structure the offline cache?', 'plan'],
];
for (const [prompt, expected] of realWorld) {
  test(`real-world: "${prompt}" → ${expected}`, () => assert.equal(role(prompt), expected));
}

test('plain-language model request acts like @model', () => {
  const r = c('use haiku for this: refactor the trips module');
  assert.equal(r.role, 'chores');
  assert.equal(r.forced, true);
  assert.equal(c('do this with opus please, implement the cache').role, 'hard');
});

test('"do it yourself" acts like #self', () => {
  assert.equal(c('do it yourself: fix the bug'), null);
  assert.equal(c("don't delegate, just fix the bug"), null);
});

test('#role override is forced', () => {
  const r = c('#hard rename foo');
  assert.equal(r.role, 'hard');
  assert.equal(r.forced, true);
});

test('@model override picks first role on that model', () => {
  assert.equal(role('@haiku summarize this'), 'chores');
  assert.equal(role('@sonnet do the thing'), 'code');
  assert.equal(c('@fable think about this').forced, true);
});

test('@model with no role on it falls back to the default mapping', () => {
  const noOpus = { ...DEFAULT_SETUP, hard: { model: 'sonnet', effort: 'high' } };
  const r = classify('@opus x', DEFAULT_RULES, noOpus);
  assert.equal(r.role, 'hard');
  assert.equal(r.model, 'opus');
});

test('#self disables routing', () => assert.equal(c('#self plan this'), null));

test('no match → null, including empty and huge prompts', () => {
  assert.equal(c('hello'), null);
  assert.equal(c(''), null);
  assert.equal(c(undefined), null);
  const t = performance.now();
  assert.equal(c('x'.repeat(50000)), null);
  assert.ok(performance.now() - t < 50);
});

test('route carries model, effort and agent from the setup', () => {
  assert.deepEqual(c('Implement the trips endpoint'),
    { role: 'code', model: 'sonnet', effort: 'medium', agent: 'claude-model-router:router-code', forced: false, why: 'Implement' });
});

test('why names the override or the first matched words', () => {
  assert.equal(c('#hard rename foo').why, '#hard');
  assert.equal(c('use haiku for this: x').why, 'use haiku');
  assert.equal(c('Debug the flaky upload test').why, 'Debug');
});

test('bad regex in rules is skipped, not thrown', () => {
  const rules = { ...DEFAULT_RULES, code: ['(unclosed', 'implement'] };
  assert.equal(classify('implement it', rules, DEFAULT_SETUP).role, 'code');
});

test('note: delegate form', () => {
  assert.equal(note(c('Implement the trips endpoint')),
    'Claude Model Router: "code" work → delegate to the claude-model-router:router-code agent (sonnet, medium). Required: do this work through the Agent tool with subagent_type "claude-model-router:router-code" instead of doing it yourself; if the request mixes kinds of work, split it across router helpers.');
});

test('note: plan on the main model is handled in place', () => {
  assert.equal(note(c('Plan the migration')), 'Claude Model Router: "plan" work → handle it yourself (fable).');
  const r = { ...c('Plan the migration'), model: 'opus' };
  assert.match(note(r), /delegate to the claude-model-router:router-plan agent \(opus, xhigh\)/);
});
