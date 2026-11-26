# Claude Model Router: model router for Claude Code (design)

> **Superseded.** This document describes the original design: hooks, helper agents and a status line. The current design is the per-turn mod described in [README.md](../../../README.md). Kept for history only.

Date: 2026-11-26 · Owner: Siamak

## Intent

Siamak wants each kind of work in Claude Code to run on the model that fits it, without
choosing by hand every time:

Default mapping (agreed 2026-11-26):

| Role | What it covers | Model | Effort |
|---|---|---|---|
| `plan` | planning, architecture, big decisions (handled by the main chat) | Fable | xhigh |
| `review` | code review | Fable | high |
| `hard` | hard code, UI work, debugging | Opus | high |
| `code` | regular code, tests, refactors | Sonnet | medium |
| `write` | prose other people read: PR descriptions, Slack, docs, tickets | Sonnet | medium |
| `chores` | git ops, renames, formatting, lookups, commit messages | Haiku | low |

Why: Fable reasons deepest and also orchestrates. Opus is nearly as strong for building and
debugging, at lower cost. Sonnet handles everyday code and writes prose that goes out under
Siamak's name. Haiku is fast and cheap for mechanical work.

Routing must be **fully automatic**: Siamak just types his request. He should never need a
slash command or a tag in day-to-day use. He also wants to see, in the CLI, which model is
handling the current task, and to change the model for each role and save the result as a
named **setup** that he can switch between (rare, done in the terminal picker).

## Hard constraint

A plugin cannot switch the main chat's model mid-session. Routing therefore works by
**delegation**: the main chat stays on one model (Fable) and hands work to helper agents,
each of which runs on its own model.

## Goals

- Automatic routing of each prompt to the right role, decided by fast keyword rules
  (Option 1, chosen by Siamak).
- The active setup is always enforced: a helper runs on the model the setup names, whatever
  model the main chat asked for.
- Named setups, saved to disk, with a terminal picker and a `/router` command to view and
  switch them.
- Status line shows the active setup and the role → model that is handling the current task.

## Non-goals

- Switching the main chat's model (the platform does not allow it).
- Proxying the API or tracking cost per model.
- LLM-based classification (Option 2). It can be added later as a fallback for prompts the
  rules can't place. Leave a seam for it, but don't build it now.

## Anti-goals (a failure even if it works)

- Visible lag or noise on every prompt. The hook must run in well under 200 ms and add only
  a one-line routing note.
- Overriding Siamak when he asks for something explicitly (`@opus`, "use haiku for this",
  "do it yourself").
- Re-creating the old routers' long rule blocks in every session.

## Prior art (checked 2026-11-26)

- **musistudio/claude-code-router (CCR):** a local API proxy that routes Claude Code to
  other providers, with a subagent tag in prompts. It solves a different problem (non-Claude
  backends), and one write-up reports that it corrupts tool calls. Not used.
- **Fable baton, better-model, jdogresorg/claude-model-router:** one model orchestrates,
  and tiered Opus/Sonnet/Haiku subagents do the work. This is the same shape as this design,
  which is a good sign that the shape works.
- **Hook + subagents write-ups** (UserPromptSubmit classifier pointing at a matching
  subagent): the same as Option 1.

## Approaches considered

1. **Keyword rules + model-pinned helpers + enforcement hook.** Picked: instant and free,
   and setups are enforced.
2. Same, with Haiku classifying each prompt. Smarter on vague prompts, but adds 1–2 s and a
   small cost to every message. Deferred.
3. Helpers + instructions only, no hooks. Simplest, but it drifts and can't enforce setups.

## Design

### Packaging

- A new folder of its own (next to the other repos), a git repo containing a local
  plugin marketplace (`.claude-plugin/marketplace.json`) with one plugin, `claude-model-router`.
- Installed with `claude plugin marketplace add <folder>` and `claude plugin install`.
- Node 20+ (ESM JavaScript, no build step). Hooks use only Node built-ins so they start fast; the picker uses Ink + React (created with `React.createElement`, no JSX). Packaged as the npm package `claude-model-router` with a `claude-model-router` bin; installed locally (`npm link`) for now, published to npm only with Siamak's OK.
- Git remote: `git@siamakrostami-GitHub:siamakrostami/ClaudeModelRouter.git` (Siamak's personal SSH alias). Creating the repo and pushing each need his OK.
- The two previous routers (`claude-model-router-hook`, `alexei-led-claude-router`) were
  already removed on 2026-11-26. All other plugins stay.

### Helpers (agents)

There are five agent files: `router-review` (Fable), `router-hard` (Opus), `router-code`
(Sonnet), `router-write` (Sonnet) and `router-chores` (Haiku). `router-write` follows the
matt3r-writing skill when it is available. Each has a short role prompt and a `model:` default in
its frontmatter.

The `plan` role has no helper. The main chat (Fable) does planning itself, since that is the
model planning should run on anyway. If the active setup maps `plan` to a model other than
the main chat's, the routing note asks the main chat to delegate to `router-plan`, so a
`router-plan` agent file also ships.

### Routing (UserPromptSubmit hook)

1. Read the prompt.
2. Check for an explicit override first. Overrides are optional extras; nothing in normal
   use depends on them:
   - `#plan` / `#review` / `#hard` / `#code` / `#write` / `#chores` forces that role.
   - `@fable` / `@opus` / `@sonnet` / `@haiku` forces the role whose model is that one in the
     active setup. If none matches, delegate to the helper nearest that model.
   - `#self` means no routing.
3. Otherwise, score the prompt against keyword/regex rules per role, stored in an editable
   `rules.json` that ships with sensible defaults. The highest score wins. A tie goes to the
   more capable role. No match means no routing: the main chat handles it, and nothing is
   injected.
4. Inject one short line of context, for example:
   `Model router: this is "code" work → delegate to the router-code agent (sonnet).`
   It includes a single-sentence instruction to delegate, and to split the work across
   helpers when a prompt mixes roles.
5. Write the decision to the state file (see Status line).

A routed prompt can be turned off for the session by `/router off` and back on by
`/router on`.

Rule details (builder's calls):
- Tie order, most capable first: `plan > review > hard > code > write > chores`.
- `write` and `chores` are told apart by audience. Text another person will read (PR
  description, Slack, Jira, Confluence, docs) is `write`. Mechanical work, including commit
  messages, is `chores`.
- `@model` with no role on that model goes to the first role in that order whose default
  model matches.
- Overrides and `#self` apply to that one prompt only.

### Enforcement (PreToolUse hook on Agent/Task)

When the main chat spawns a `router-*` helper, the hook sets the tool input's `model` (and
`effort`, if the setup specifies one) from the active setup, via `updatedInput`. Other agent
types are left alone.

**First build task is a spike** to prove that `updatedInput` really changes a helper's
model. One community bug report (April 2026) says frontmatter and per-call models were
ignored. `CLAUDE_CODE_SUBAGENT_MODEL` also overrides everything; it is unset on this
machine, and `claude-model-router show` should warn if it ever gets set.

**Fallback if the spike fails:** `claude-model-router` writes the helper agent files into
`~/.claude/agents/` with `model:` set from the active setup, and rewrites them on every
`use`/`set`. A new session picks up the change.

Helper tools (builder's call): `router-plan` and `router-review` are read-only (no
Edit/Write). The other helpers get all tools.

Effort is set per call from the setup. Siamak chose these effort levels explicitly as part
of the setup, so passing `effort` on the Agent call follows his instruction.

### State

`state.json` is keyed by `session_id`, so concurrent sessions don't clash:
`{ "<session_id>": { "enabled": true, "last_route": "code", "running": { "<tool_use_id>": "code→sonnet" } } }`.
- PreToolUse adds a `running` entry, and PostToolUse removes it.
- `/router off|on` flips `enabled` for the current session only.
- `claude-model-router off|on` sets a global default in `setups.json`.
- Entries older than 24 h are pruned on write.

### Setups

- Stored in `~/.claude/claude-model-router/setups.json`:
  `{ "active": "default", "setups": { "default": { "plan": {"model": "fable"}, "review": {...}, ... } } }`.
- Each role has a `model` (`fable|opus|sonnet|haiku`) and an `effort`
  (`low|medium|high|xhigh|max`). The defaults are in the table under Intent.
- A missing file is created with the default mapping above.
- `rules.json` and `state.json` live in the same folder. User data stays out of the plugin
  folder, so reinstalling the plugin keeps it.

### Picker and commands

- `claude-model-router` CLI (Node; full-screen picker built with Ink):
  - With no arguments, it opens a full-screen picker: roles listed with their models; arrow
    keys move, ←/→ cycle the model, `e` cycles effort, `s` saves as a named setup, `l` loads
    one, `d` deletes one, `q` quits.
  - Subcommands for scripting: `claude-model-router show`, `claude-model-router list`, `claude-model-router use <name>`,
    `claude-model-router set <role> <model> [effort]`, `claude-model-router save <name>`, `claude-model-router delete <name>`,
    `claude-model-router on|off`.
  - Put on PATH with `npm link` (global npm bin).
- An optional `/router` slash command in Claude Code runs the same subcommands (`/router`,
  `/router use fast`, `/router off`). It is a convenience only. Routing never needs it.

### Status line

Siamak's existing `~/.claude/statusline.sh` gets one added segment that reads `state.json`:

`⇢ default · code→sonnet` while a helper runs (several are joined, e.g.
`code→sonnet, write→haiku`), or `⇢ default` when idle. The status line reads the entry
for its own `session_id`.

The existing model, context, cost, project and branch segments stay as they are.

### Main chat model

`~/.claude/settings.json` `"model"` changes from `opus` to `fable`, with effort `xhigh`
(this matches the existing `modelSettings` entry for Fable).

### Tests

Node's built-in `node:test`. Covers rule scoring and overrides, setup load/save/default
creation, and the `updatedInput` rewrite, driven with sample hook JSON.

## Changes outside the project folder (each needs Siamak's OK at build time)

- Add the local marketplace and install the plugin.
- `npm link` the package (puts `claude-model-router` on PATH).
- Edit `~/.claude/statusline.sh`.
- Change `"model"` in `~/.claude/settings.json` to `fable`.
- `git init` the folder (any commit is asked for separately).

## Left to the builder

The default keyword lists, the exact agent prompt wording, the picker's colours and layout,
the internal module structure, and how to handle a corrupt JSON file (back it up and recreate
it).
