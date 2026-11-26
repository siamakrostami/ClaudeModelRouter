import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, DEFAULT_SETUP } from '../src/core/defaults.js';
import { classify } from '../src/core/classify.js';

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
});

test('"no helper" and "don\'t delegate" are ordinary words, not an opt-out', () => {
  assert.equal(role('no helper text shows under the email field, add one'), 'code');
  assert.equal(role("don't delegate, just fix the bug"), 'code');
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

test('route carries model and effort from the setup', () => {
  assert.deepEqual(c('Implement the trips endpoint'),
    { role: 'code', model: 'sonnet', effort: 'medium', forced: false, why: 'Implement' });
});

test('why names the override or the first matched words', () => {
  assert.equal(c('#hard rename foo').why, '#hard');
  assert.equal(c('use haiku for this: x').why, 'use haiku for this');
  assert.equal(c('Debug the flaky upload test').why, 'Debug');
});

test('bad regex in rules is skipped, not thrown', () => {
  const rules = { ...DEFAULT_RULES, code: ['(unclosed', 'implement'] };
  assert.equal(classify('implement it', rules, DEFAULT_SETUP).role, 'code');
});

// Mentions of a model that are not a request to switch to it.
const notOverrides = [
  'which model is cheaper for us? we run the batch job on haiku today',
  'working on opus audio codec support',
  'send the file via haiku endpoint',
  'we deploy with sonnet as the default',
  'switch to opus codec in the encoder settings',
];
for (const prompt of notOverrides) {
  test(`not a model override: "${prompt}"`, () => assert.notEqual(c(prompt)?.forced, true));
}

test('explicit plain-language model requests still force a model', () => {
  for (const p of ['use opus for this', 'use opus to fix the layout', 'with haiku please', 'please use the sonnet model for this']) {
    assert.equal(c(p)?.forced, true, p);
  }
});

test('#tag needs a clean end: #code-owners is not #code', () => {
  assert.notEqual(c('update #code-owners for the new team')?.forced, true);
  assert.notEqual(c('ping @opus-team about it')?.forced, true);
  assert.equal(c('#code, then stop').role, 'code');
  assert.equal(role('#self-hosted runner keeps failing, debug it'), 'hard');
});

// Real work that the old chores rules sent to Haiku low.
const notChores = [
  ['git diff shows my auth changes are gone after the rebase, help me recover them', 'hard'],
  ['summarize the risks in this design and tell me whether we should ship', 'plan'],
  ['look up how the SDK handles token refresh and rewrite our client to match', 'code'],
  ['where is the session token validated? I think there is a security hole', 'review'],
  ['lint errors everywhere after the upgrade, figure out what changed', 'hard'],
  ['create a jira ticket for the login crash', 'write'],
  ['open an issue for the crash on launch', 'write'],
];
for (const [prompt, expected] of notChores) {
  test(`not chores: "${prompt}" → ${expected}`, () => assert.equal(role(prompt), expected));
}

test('chores still win short mechanical prompts', () => {
  for (const p of ['git status', 'summarize this file', 'where is the config loaded', 'lint the trips module', 'bump the version to 2.4.1']) {
    assert.equal(role(p), 'chores', p);
  }
});

test('a long prompt that opens with a chores verb is still chores', () => {
  assert.equal(role('rename getUserById to fetchUserById in every file of the api package and its tests'), 'chores');
});

test('a long prompt whose only match is a chores word stays on the session model', () => {
  assert.equal(role('i was reading the logs this morning and want to look up what the nightly cron does with the old exports'), null);
});
