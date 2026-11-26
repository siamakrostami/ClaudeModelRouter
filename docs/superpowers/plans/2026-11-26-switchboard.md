# Switchboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that routes each prompt to a helper running on the right model (Fable/Opus/Sonnet/Haiku), following a named, saved setup, and shows the routing in the status line.

**Architecture:**
- A UserPromptSubmit hook classifies the prompt with keyword rules. It adds a one-line note telling the main chat (Fable) which helper agent to hand the work to.
- A PreToolUse hook on Agent/Task forces each `router-*` helper's `model`/`effort` from the active setup, and records running helpers in per-session state. A PostToolUse hook clears them.
- The `switchboard` CLI (subcommands plus an Ink picker) edits setups and prints the status line segment.

**Tech Stack:**
- Node 20+, ESM JavaScript, no build step.
- `src/core/` and the hooks use Node built-ins only.
- `src/picker/` uses `ink` + `react`, created with `React.createElement`.
- Tests use `node:test` + `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-11-26-switchboard-design.md`

**Execution:** Native (chosen by Siamak). Each commit, and every change outside `switchboard/`, needs Siamak's explicit OK.

## Global Constraints

- Roles, in tie order: `plan > review > hard > code > write > chores`.
- Default setup:
  - plan: fable / xhigh
  - review: fable / high
  - hard: opus / high
  - code: sonnet / medium
  - write: sonnet / medium
  - chores: haiku / low
- Models: `fable|opus|sonnet|haiku`. Efforts: `low|medium|high|xhigh|max`.
- User data is in `~/.claude/switchboard/` (`setups.json`, `rules.json`, `state.json`, `error.log`). `SWITCHBOARD_HOME` overrides that location.
- Hooks finish in under 200 ms and never import `ink`/`react`. On any error they append to `error.log`, print nothing and exit 0.
- The routing note is a single line.
- Agent names: `switchboard:router-<role>`. Matching also accepts the bare `router-<role>`.
- npm package: `cc-switchboard`, with bin `switchboard`.
- Git remote: `git@siamakrostami-GitHub:siamakrostami/switchboard.git`.

## Review Focus

1. A prompt that matches nothing (also an empty or 50 KB prompt) → no output, fast. Tested in Task 2.
2. A missing or corrupt `setups.json`/`rules.json` → back it up as `.bak`, recreate it with defaults, keep routing. Tested in Task 1.
3. A setup saved before a role existed → that role is filled from the defaults. Tested in Task 1.
4. An Agent call with a non-router `subagent_type`, or none → the input is left untouched. Tested in Task 3.
5. Two sessions writing `state.json` at once → atomic temp+rename writes, with entries keyed by session. Tested in Task 1.

## File Structure

```
switchboard/
  package.json                          name cc-switchboard, type module, bin {switchboard: bin/switchboard.js}, deps ink, react
  .claude-plugin/marketplace.json       local marketplace → ./plugin
  plugin/
    .claude-plugin/plugin.json          name "switchboard"
    hooks/hooks.json                    node "${CLAUDE_PLUGIN_ROOT}/hooks/<x>.js"
    hooks/on-prompt.js on-agent-pre.js on-agent-post.js   thin stdin→stdout wrappers
    agents/router-{plan,review,hard,code,write,chores}.md
    commands/router.md                  optional /router
  src/core/defaults.js store.js classify.js hooks.js status.js
  src/cli.js                            subcommands
  src/picker/app.js                     Ink picker
  bin/switchboard.js
  test/*.test.js
```

The hooks import `../../src/core/*.js` through relative paths. The plugin folder therefore has to live inside the repo, which is the case with the local marketplace.

Tests: `cd switchboard && node --test test/`

---

### Task 0: Spike — does `updatedInput` change a helper's model?

Throwaway `spike/plugin/` containing:
- an agent `probe.md` with `model: sonnet`
- a PreToolUse hook (`Agent|Task`) that returns `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{...tool_input,"model":"haiku"}}}`

- [ ] Run `claude -p --plugin-dir spike/plugin --output-format json "Use the probe agent to say hi"`.
- [ ] Grep `"model":"…"` in that session's `~/.claude/projects/<slug>/<session>/subagents/*.jsonl`. Expected: `claude-haiku-5-5`.
  - If it shows Sonnet, use the **fallback**: `handle_agent_pre` only records state, and `switchboard use/set` rewrites `~/.claude/agents/router-*.md`. Record the outcome here.
- [ ] Delete `spike/`.

### Task 1: defaults + store

**Files:** `src/core/defaults.js` and `src/core/store.js`. Test: `test/store.test.js`. Each test gets its own temp `SWITCHBOARD_HOME`.

**Produces:**
- `defaults.js`:
  - `ROLES` (tie order), `MODELS`, `EFFORTS`
  - `DEFAULT_SETUP: {[role]: {model, effort}}`
  - `DEFAULT_RULES: {[role]: string[]}` (case-insensitive regex sources)
  - `agentName(role) → "switchboard:router-<role>"`
  - `roleFromAgent(subagentType) → role | null`
- `store.js`:
  - `home()`
  - `loadSetups() → {active, enabled, setups}`
  - `saveSetups(d)`
  - `activeSetup()` (missing roles filled from the defaults)
  - `setRole(role, model, effort?)`
  - `saveAs(name)`, `use(name)`, `remove(name)`
  - `loadRules()`
  - `updateState(sessionId, fn)` (prunes entries older than 24 h)
  - `readState(sessionId)`
  - `sessionEnabled(sessionId)`
  - `setEnabled(on, sessionId?)`
  - `setRole`, `use` and `remove` throw `Error` on bad input. `remove` also throws when asked to delete the active setup.

- [ ] **Tests:**
  - `missing file creates default`
  - `corrupt file backed up` (`.bak` exists and the default is restored)
  - `missing role filled` (chores → haiku/low)
  - `save/use/remove`: set code=opus, saveAs fast, use default → sonnet, use fast → opus. Removing the active setup throws.
  - `setRole rejects bad model`
  - `state per session and pruned`
  - `no .tmp left after write`
- [ ] Run `node --test test/store.test.js`. Expected: FAIL.
- [ ] **Implement.** Writes go to `file.tmp-<pid>` and then `fs.renameSync`.
  - DEFAULT_RULES (minimum):
    - plan: `plan|architect|design doc|approach|trade-?off|strategy|roadmap|rfc`
    - review: `review|audit|look over|check (my|this|the) (code|pr|diff)`
    - hard: `debug|crash|race|flaky|stack trace|regression|why (is|does).*fail|\bui\b|screen|layout|animation|swiftui|compose`
    - code: `implement|add (a )?(feature|endpoint|test)|write (a )?(function|test)|fix|refactor|bug`
    - write: `pr description|slack|reply|message|email|jira|ticket|confluence|readme|\bdocs?\b|announcement|update for`
    - chores: `commit message|rename|format|lint|move file|bump|git (status|log|add|stash)|look ?up|find (the|where)`
- [ ] Run the tests. Expected: PASS. Commit with OK.

### Task 2: classifier

**Files:** `src/core/classify.js`. Test: `test/classify.test.js`.

**Produces:**
- `classify(prompt, rules, setup) → {role, model, effort, agent, forced} | null`
- `note(route, mainModel = "fable") → string`

- [ ] **Tests** (using the defaults):
  - "Plan the migration to the new API" → plan
  - "Review my PR diff" → review
  - "Debug the flaky upload test" → hard
  - "Implement the trips endpoint" → code
  - "Write a Slack reply to Ali" → write
  - "rename foo to bar" → chores
  - "commit message for this" → chores (not write)
  - "review the plan" → plan (tie)
  - "#hard rename foo" → hard, forced
  - "@haiku summarize this" → chores
  - "@opus x" when no role is on opus → hard
  - "#self plan this" → null
  - "hello", "" and "x".repeat(50000) → null, with the 50 KB case under 50 ms
- [ ] **Exact note strings:**
  - code: `Switchboard: "code" work → delegate to the switchboard:router-code agent (sonnet, medium). If the request mixes kinds of work, split it across router helpers.`
  - plan, when plan's model equals mainModel: `Switchboard: "plan" work → handle it yourself (fable).`
- [ ] Run the tests (FAIL), then implement:
  - score = number of matching rule patterns per role; the highest wins; ties follow ROLES order
  - overrides are checked first
- [ ] Run the tests (PASS). Commit with OK.

### Task 3: hook handlers + plugin wiring

**Files:**
- `src/core/hooks.js`
- `plugin/hooks/*.js`, `hooks.json`
- `plugin/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `plugin/agents/*.md`
- `plugin/commands/router.md`

Test: `test/hooks.test.js`.

**Produces:**
- `handlePrompt(payload)`, `handleAgentPre(payload)` and `handleAgentPost(payload)`, each returning the output object or `null`
- `runHook(handler)`: reads stdin, calls the handler and prints the JSON, swallowing errors

- [ ] **Tests:**
  - **handlePrompt (code prompt):** returns `{hookSpecificOutput:{hookEventName:"UserPromptSubmit", additionalContext}}`, and `readState(sid).last_route === "code"`.
  - **handlePrompt, no match:** "hello" → null.
  - **handlePrompt, disabled session:** → null.
  - **handleAgentPre** with `switchboard:router-code`, and again with the bare `router-code`:
    - `updatedInput.model === "sonnet"` and `effort === "medium"`
    - the other keys are kept
    - `permissionDecision === "allow"`
    - `running[tool_use_id] === "code→sonnet"`
  - **handleAgentPre, other agents:** `Explore` or a missing subagent_type → null, and the state is unchanged.
  - **handleAgentPost:** removes the running entry.
  - **Each wrapper with invalid stdin:** exits 0 with empty stdout (`child_process.spawnSync`).
- [ ] Run the tests (FAIL), then implement the handlers, wrappers and plugin files.
  - **Agents:**
    - frontmatter has `name`, a one-line `description` and a default `model`
    - `router-plan` and `router-review` get `tools: Read, Grep, Glob, Bash, WebSearch, WebFetch`
    - the body is 3–6 lines of role guidance
    - `router-write` uses the matt3r-writing skill when it is available
  - **`router.md`:** `` !`switchboard $ARGUMENTS --session ${CLAUDE_SESSION_ID}` ``, then show the output as is.
- [ ] Run the tests (PASS).
- [ ] Smoke test: run `claude -p --plugin-dir plugin "rename foo to bar — just say which agent you'd use"`. The reply should name `router-chores`.
- [ ] Commit with OK.

### Task 4: CLI, Ink picker, status segment

**Files:** `src/cli.js`, `src/picker/app.js`, `src/core/status.js`, `bin/switchboard.js` and `package.json`. Tests: `test/cli.test.js` and `test/status.test.js`.

**Produces:**
- `main(argv, {stdout, stderr}) → exitCode`
- `statusSegment(sessionId | null) → string`
- `switchboard status-segment <sid>`

- [ ] **Tests:**
  - `show` prints six aligned rows, the first being `plan     fable    xhigh`. It warns if `CLAUDE_CODE_SUBAGENT_MODEL` is set.
  - `set code opus high` → 0, and the role is updated.
  - `set code gpt` → 2, with an error on stderr.
  - `list` marks the active setup with `*`.
  - `use nope` → 2.
  - `off` changes the global switch. `off --session s1` changes only s1.
  - `statusSegment`:
    - idle → `⇢ default`
    - one helper running → `⇢ default · code→sonnet`
    - two running → joined with `, `
    - null session → `⇢ default`
    - disabled → `⇢ off`
- [ ] Run the tests (FAIL), then implement.
  - `switchboard` with no arguments on a TTY dynamically imports the picker and renders it. Without a TTY it behaves like `show`.
  - **Picker layout:**
    - a header with the active setup's name
    - a table of the roles with model and effort; the selected row is highlighted and each model has its own color
    - a footer listing the keys
  - **Picker keys:**
    - ↑/↓ change the role
    - ←/→ cycle the model
    - `e` cycles effort
    - `s` saves as a new setup (Ink text input built from `useInput`)
    - `l` opens a list of setups to load
    - `d` deletes a setup
    - `q` quits
    - every change is saved immediately
  - Under the spike fallback, `use`/`set` also rewrite `~/.claude/agents/router-*.md`.
- [ ] Run the tests (PASS). `npm install` locally, then run `node bin/switchboard.js` and check the picker by hand. Commit with OK.

### Task 5: Final review, install, wire up (ask once, with the full list)

- [ ] Final review: one fresh reviewer subagent on the whole repo against the spec. Fix what it finds.
- [ ] `git init`, then `git remote add origin git@siamakrostami-GitHub:siamakrostami/switchboard.git`. Siamak creates the GitHub repo (`gh` is logged in to a different account). Commit and push only with his OK.
- [ ] `claude plugin marketplace add <repo>` and `claude plugin install switchboard@switchboard`.
- [ ] `npm link` in the repo, so `switchboard` is on PATH.
- [ ] `~/.claude/statusline.sh`: append ` | $(switchboard status-segment "$session_id")`, with `session_id` taken from the input JSON.
- [ ] `~/.claude/settings.json`: set `"model": "fable"`, plus an xhigh `modelSettings` entry for `claude-fable-5-2`.
- [ ] **Verify** in a new session with "rename the variable foo to bar in README":
  - the reply delegates to `router-chores`
  - the status line shows `chores→haiku`
  - the subagent transcript shows `claude-haiku-5-5`
