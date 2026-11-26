# Claude Model Router

[![npm](https://img.shields.io/npm/v/@siamakrostami/claude-model-router.svg)](https://www.npmjs.com/package/@siamakrostami/claude-model-router)
[![node](https://img.shields.io/node/v/@siamakrostami/claude-model-router.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/@siamakrostami/claude-model-router.svg)](LICENSE)

Per-turn model routing for Claude Code. You type your request as usual, and Claude Model Router
sends that turn to the model and effort that suit it:

| Role | Handles | Default |
|---|---|---|
| plan | planning, architecture, big decisions | Fable · xhigh |
| review | code review | Fable · high |
| hard | hard code, UI, debugging | Opus · high |
| code | regular code, tests, refactors | Sonnet · medium |
| write | PR descriptions, Slack, docs, tickets | Sonnet · medium |
| chores | git, renames, formatting, lookups, commit messages | Haiku · low |

A prompt that matches no role stays on the model the session runs on.

## How it works

Claude Model Router is a Claude Code mod:

- **`prompt.submit`** sorts each prompt you type into a role with keyword rules. Slash commands
  and skills are not sorted, and neither are prompts you did not type: task notifications,
  scheduled prompts, messages from other sessions.
- **`turn.step`** sends every main-chat request of that one turn with the role's model and
  effort. The route ends with the turn, so the next turn starts clean. A prompt you type while a
  turn is running never changes that turn. Nothing goes through a proxy, and subagents are
  left alone.
- **The band above the prompt** is one row:

  ```
   ●●●○○ Opus · High                    my-repo | feature/login   ◔ 31%   [Auto ▾] [⚙️]
  ```

  On the left, an effort meter, the model and the effort, plus a badge when routing is
  **Pinned** to a model, **Manual** (you switched with `/model`) or **Off**. On the right, the
  repo and branch (cut short, or hidden when the row is narrow), how full the context window is,
  an **Auto ▾** button (it shows the pinned model when there is one) that opens the pane, and
  a gear that opens the pane on its Models tab. Before the first turn it shows the model the
  session started on, with no effort.
- **`/router`** opens a pane with two tabs:
  - **Overview**: what the current turn runs on and why, a **Use** picker (Auto or one model
    to pin), context use, and each task's model and effort.
  - **Models**: a model and an effort dropdown for each task in the active setup, and a setup
    picker when you have more than one. Changes save to `setups.json` right away.

## Install

```bash
npm install -g @siamakrostami/claude-model-router
claude plugin marketplace add "$(npm root -g)/@siamakrostami/claude-model-router"
claude plugin install model-router@model-router
```

From a clone instead: `npm install && npm link`, then `claude plugin marketplace add "$PWD"`
and the same `claude plugin install` line. Needs Claude Code 2.1.330 or newer.

## Use

Just type. To steer one prompt, include one of these:

- `#plan` `#review` `#hard` `#code` `#write` `#chores`: force a role
- `@fable` `@opus` `@sonnet` `@haiku`, or "use haiku for this", "use opus to ...",
  "with sonnet please": force a model. A model named in passing ("we run the job on haiku")
  does not.
- `#self` or "do it yourself": stay on the session's model

In a session:

- `/router`: open the pane
- `/router opus` (or `fable`, `sonnet`, `haiku`): pin every turn to that model, slash commands
  included; `/router auto` unpins. Roles cannot be pinned: `/router hard` is refused.
- `/router off` / `/router on`: pause or resume routing for this session only

If you switch models yourself with `/model`, Claude Model Router steps aside (the band says
Manual) until you switch back to the model the session started on.

From a terminal (these change `setups.json`, which every session reads at its next prompt):

```bash
claude-model-router                      # full-screen setup picker
claude-model-router show | list
claude-model-router set code opus high
claude-model-router save fast            # save the current setup under a name
claude-model-router use default
claude-model-router delete fast
claude-model-router off | on             # everywhere; /router off pauses one session
claude-model-router rules                # write the default rules to rules.json to edit
```

## Data and custom rules

Data lives in `~/.claude/claude-model-router/` (on Windows, under `%USERPROFILE%`; set
`CLAUDE_MODEL_ROUTER_HOME` to use another folder):

- `setups.json`: the saved setups, the active one, and the global on/off. The CLI and the pane
  both edit it; a pane edit re-reads the file first, so a setup saved from the CLI is kept. A file
  that does not parse is copied to `setups.json.bak` before it is replaced.
- `rules.json` (optional): your own keyword rules. Without it the built-in rules are used.

To customize the rules, run `claude-model-router rules`. It writes the built-in rules to
`rules.json` (it never overwrites one that exists) and prints the path. The file maps each role
to a list of case-insensitive regular expressions:

```json
{
  "write": ["pr description", "\\bslack\\b", "\\bchangelog\\b"],
  "chores": ["commit message", "\\brename"]
}
```

- A role you list uses your patterns instead of the built-in ones; a role you leave out keeps
  the built-in ones. A pattern that is not a valid regex is skipped.
- Each pattern that matches adds 1 to its role. The highest score wins; a tie goes to the more
  capable role (plan, review, hard, code, write, chores in that order).
- Chores (Haiku, low effort by default) only win when no other role matched and the prompt is
  short (12 words or fewer) or opens with a mechanical verb such as rename, bump, move, format,
  lint or "write a commit message".
- Changes apply from the next prompt; no restart needed.

## Test

```bash
npm test             # node --test test/: classifier, store and CLI
npm run test:ui      # claude plugin test .: the mod, its band and its pane
```
