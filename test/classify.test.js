import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('a user rule that would be a bad regex is not thrown', () => {
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

// ---- M2: user rules are plain words or phrases, never regexes, so rules.json cannot hang prompt.submit ----

const withWrite = patterns => ({ ...DEFAULT_RULES, write: patterns });
const writes = (prompt, patterns) => classify(prompt, withWrite(patterns), DEFAULT_SETUP)?.role === 'write';

/**
 * Classify 4000 chars of `a` plus `!` with `pattern` as a user rule in every role, in a child
 * process that is killed after 1500 ms, so a regex that backtracks fails the test instead of
 * hanging the run. Returns the time classify took, or Infinity when the child was killed.
 */
function timedInChild(pattern) {
  const url = new URL('../src/core/classify.js', import.meta.url).href;
  const defs = new URL('../src/core/defaults.js', import.meta.url).href;
  const code = `
    const { classify } = await import(${JSON.stringify(url)});
    const { DEFAULT_RULES, DEFAULT_SETUP } = await import(${JSON.stringify(defs)});
    const rules = {};
    for (const r of Object.keys(DEFAULT_RULES)) rules[r] = [${JSON.stringify(pattern)}];
    const t = performance.now();
    classify('a'.repeat(4000) + '!', rules, DEFAULT_SETUP);
    process.stdout.write(String(performance.now() - t));`;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], { timeout: 1500, encoding: 'utf8' });
  return res.status === 0 ? Number(res.stdout) : Infinity;
}

const REDOS = ['a*a*a*a*a*a*b', '(a+)+$', '(a|aa)+$', '(.*)*x', '\\w*\\w*\\w*x', '(a|a)*b', '(a+)?(a+)?(a+)?b', '(a?){20}a{20}'];
for (const pattern of REDOS) {
  test(`M2: user rule ${pattern} classifies 4000 chars in under 50 ms`, { timeout: 2000 }, () => {
    const ms = timedInChild(pattern);
    assert.ok(ms < 50, `took ${ms} ms`);
  });
}

test('M2: a user phrase matches as words, with any whitespace between them', () => {
  assert.equal(writes('when is the next release train', ['release train']), true);
  assert.equal(writes('when is the next Release\n  Train?', ['release train']), true);
  assert.equal(writes('releasetrain is late', ['release train']), false);
  assert.equal(writes('the train is late', ['rain']), false);
});

test('M2: a user phrase is literal text, not a regex', () => {
  const plan = classify('fix the c++ build', { ...DEFAULT_RULES, plan: ['c++'] }, DEFAULT_SETUP);
  assert.equal(plan?.role, 'plan');
  assert.equal(plan?.why, 'c++');
  assert.equal(writes('fix the abc++ build', ['c++']), false);
  assert.equal(writes('fix the cc build', ['c++']), false);
  assert.equal(writes('axb', ['a.b']), false);
  assert.equal(writes('see a.b here', ['a.b']), true);
  assert.equal(writes('tell me about the zebra', ['\\bzebra\\b']), false);
  assert.equal(writes('ping #ops now', ['#ops']), true);
  assert.equal(writes('(unclosed it', ['(unclosed']), true);
});

test('M2: a user phrase longer than 200 characters is skipped', () => {
  const long = `zebra ${'q'.repeat(195)}`;
  assert.ok(long.length > 200);
  assert.equal(writes(long, [long]), false);
  const ok = `zebra ${'q'.repeat(190)}`;
  assert.equal(writes(ok, [ok]), true);
});

test('M2: only the first 50 user phrases of a role are used', () => {
  const sixty = Array.from({ length: 60 }, (_, i) => `word${i}`);
  assert.equal(writes('word10', sixty), true);
  assert.equal(writes('word49', sixty), true);
  assert.equal(writes('word55', sixty), false);
});

test('M2: user phrases only see the first 1000 characters; default rules still see 4000', () => {
  const pad = 'lorem ipsum '.repeat(150); // 1800 chars of nothing
  assert.equal(writes(`${pad} zebra`, ['zebra']), false);
  assert.equal(writes(`zebra ${pad}`, ['zebra']), true);
  assert.equal(role(`${pad} debug it`), 'hard');
});

test('M2: a pattern identical to a default rule keeps the default treatment', () => {
  const own = DEFAULT_RULES.code.find(p => p.includes('( \\w+)?'));
  assert.ok(own);
  assert.equal(classify('update the trip status field', { ...DEFAULT_RULES, code: [own] }, DEFAULT_SETUP)?.role, 'code');
});

test('M2: the rules.json that `claude-model-router rules` writes routes exactly like the built-in rules', () => {
  const written = JSON.parse(JSON.stringify(DEFAULT_RULES, null, 2));
  for (const [prompt] of [...cases, ...realWorld, ...notChores]) {
    assert.deepEqual(classify(prompt, written, DEFAULT_SETUP), c(prompt), prompt);
  }
});

test('M2: every default rule still compiles and is used', () => {
  for (const [r, list] of Object.entries(DEFAULT_RULES)) {
    for (const src of list) assert.doesNotThrow(() => new RegExp(src, 'i'), `${r}: ${src}`);
  }
});

// ---- L1: overrides count only at the start or the end of the prompt ----

test('L1: a tag at the start or at the end is honoured', () => {
  assert.equal(c('#chores rename foo and explain the design').role, 'chores');
  assert.equal(c('explain the whole design here #chores').role, 'chores');
  assert.equal(c('explain the whole design here #chores.').forced, true);
  assert.equal(c('  \n@haiku summarize this').role, 'chores');
  assert.equal(c('debug the parser crash @haiku\n').role, 'chores');
  assert.equal(c('plan this out #self'), null);
});

test('L1: a tag in the middle is ignored', () => {
  assert.equal(c('debug the crash #chores in the parser').role, 'hard');
  assert.equal(c('debug the crash in the parser, see @haiku notes above').role, 'hard');
  assert.notEqual(c('please #self review the diff'), null);
});

test('L1: @haiku inside a pasted log does not downgrade the prompt', () => {
  const p = 'debug this crash, here is the log:\n```\n12:01 worker started\n12:02 @haiku job queued\n12:03 segfault\n```\nwhat broke?';
  const r = c(p);
  assert.equal(r.role, 'hard');
  assert.equal(r.forced, false);
});

test('L1: plain-language overrides count only in the first 200 characters', () => {
  assert.equal(c('use haiku for this: tidy the imports').forced, true);
  assert.equal(c('do it yourself: fix the bug'), null);
  const pad = 'the parser crashes on empty input and I need a fix soon. '.repeat(5);
  assert.ok(pad.length > 200);
  assert.notEqual(c(`${pad} use haiku for this`)?.forced, true);
  assert.notEqual(c(`${pad} do it yourself`), null);
});

// ---- L4: why is clean text, at most 40 characters ----

test('L4: why carries no control bytes from the prompt and is capped at 40', () => {
  const r = c('why does \x1b]0;evil title\x07 the \x1b[2J upload fail when the network is slow and long');
  assert.equal(r.role, 'hard');
  assert.doesNotMatch(r.why, /[\x00-\x1f\x7f]/);
  assert.ok(r.why.length <= 40, r.why);
});

test('L1: why of an end tag leaves out the trailing punctuation', () => {
  assert.equal(c('explain the whole design here #chores.').why, '#chores');
  assert.equal(c('explain the whole design here @haiku!').why, '@haiku');
});
