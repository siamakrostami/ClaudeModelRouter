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
| general | everything else | Sonnet · medium |

A prompt that matches no role goes to **general**, so everyday questions run on Sonnet and Fable is
kept for planning, reviews and heavy thinking ("think hard", "deep dive", "redesign", "from
scratch"). The one exception is staying in flow: right after a **hard**, **code** or **write**
turn, an unmatched prompt keeps that role. Short replies such as "yes go ahead", "ok", "fix this"
or "try again" follow what the session is doing instead of their words: after a plan or a review
they mean "implement it" (code), otherwise they keep the previous role.

If your account cannot use a model (Fable is not on every plan), the router uses the next one
down: Fable → Opus → Sonnet → Haiku (Opus falls back to Sonnet, Sonnet and Haiku to each other).
Your setups are not rewritten; the swap happens per request, and the pane says so in one line.

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
  **Pinned** to a model, **Holding** the previous model (see below), **Manual** (you switched
  with `/model`) or **Off**. On the right, the
  repo and branch (cut short, or hidden when the row is narrow), how full the context window is,
  an **Auto ▾** button (it shows the pinned model when there is one) that opens the pane, and
  a gear that opens the pane on its Models tab. Before the first turn it shows the model the
  session started on, with no effort.
- **Long conversations stay on one model.** Each model keeps its own prompt cache, so the first
  switch in a long session re-sends the whole conversation at full price (in a 100k-token
  session about $0.25–0.40 to move to Sonnet and $1–1.60 to Fable, against about $0.02 for one more
  Opus request). From `sticky_tokens` of context (60000 by default), an automatic route keeps the
  model the last request used and only takes the new task's effort. The band then says
  **Holding**, and the pane says why. A pin, `#role`, `@model` or "use <model> for this" always
  switches. Set `sticky_tokens` to `0` to route every prompt on its own words.
- **Claude can switch too.** The router gives Claude a `switch_model` tool. When a task turns out
  to be a different kind of work than the prompt suggested (say a chat that finds a bug to fix),
  Claude names the task, and your setup picks the model for the rest of that turn. The band says
  **Switched**. The next prompt is routed again. It never switches in a
  subagent, while the router is off, or over a pin or a `/model` choice.
- **Claude knows which model it is.** A routed prompt carries a hidden note naming the model that
  answers it, since the system prompt names the model the session started on.
- **Builds and tests run on a cheap model.** The router adds a `model-router:runner` agent on
  your chores model (Haiku by default). Claude hands it builds, test runs and app launches, and
  gets back a short report (pass or fail, the first errors with file:line) instead of the full log.
- **Fable writes only the code that needs it.** Fable costs the most, so on Fable Claude writes
  the core or tricky parts itself and switches to your code model for routine edits. As a cost cap,
  after three Fable steps that edit files in one turn, the rest of the turn moves to the code model.
- **Design and artifact checks go to Opus.** Prompts about designs, artifacts, mockups, Figma,
  UX, visuals or CSS are hard work; system design ("how should we design…", "redesign") is planning.
- **`/router`** opens a pane with three tabs:
  - **Overview**: what the current turn runs on and why, a **Use** picker (Auto or one model
    to pin), context use, and each task's model and effort.
  - **Models**: a model and an effort dropdown for each task in the active setup, and a setup
    picker when you have more than one. Changes save to `setups.json` right away.
  - **Usage**: each model's share of this session as a solid bar, with its tokens and requests
    (cached, new and output underneath), subagents included; context use; your plan's 5-hour and
    weekly limits with when they reset; and the session's cost estimate.

## Install

```bash
npm install -g @siamakrostami/claude-model-router
claude plugin marketplace add "$(npm root -g)/@siamakrostami/claude-model-router"
claude plugin install model-router@model-router
```

From a clone instead: `npm install && npm link`, then `claude plugin marketplace add "$PWD"`
and the same `claude plugin install` line. Needs Claude Code 2.1.330 or newer.

## Use

Just type. To steer one prompt, put one of these at the start or end of the prompt:

- `#plan` `#review` `#hard` `#code` `#write` `#chores` `#general`: force a role
- `@fable` `@opus` `@sonnet` `@haiku`: force a model
- `#self`: stay on the session's model

A tag in the middle of the prompt (say, inside a pasted log) is ignored. The plain-language
forms work in the first 200 characters: "use haiku for this", "use opus to ...", "with sonnet
please" force a model, and "do it yourself" stays on the session's model. A model named in
passing ("we run the job on haiku") does not count.

In a session:

- `/router`: open the pane
- `/router opus` (or `fable`, `sonnet`, `haiku`): pin every turn to that model, slash commands
  included; `/router auto` unpins. Roles cannot be pinned: `/router hard` is refused.
- `/router off` / `/router on`: pause or resume routing for this session only

If you switch models yourself with `/model`, Claude Model Router steps aside (the band says
Manual) until you switch back to the model the session started on.

Only the main chat is routed. Subagents are left alone, so the router works next to agents that
pin their own model.

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
claude-model-router presets              # add the ready-made setups (see Presets)
```

The CLI cannot see which models your account offers, so it stores setups as you choose them; a
session swaps a model it cannot use when it sends the request.

## Presets

`presets/setups.json` ships three setups:

| Setup | What it is for |
|---|---|
| default | the defaults above: Fable plans and reviews, Opus does hard work, Sonnet the rest, Haiku chores |
| economy | no Fable at all: Opus plans, reviews and does hard work, Sonnet codes and writes (low effort for writing and general) |
| deep | more thinking: Fable for plan, review and hard, Opus for code and general |

`claude-model-router presets` adds every preset whose name you do not have yet. It never changes
a setup you have or which one is active. Switch with `claude-model-router use economy`, or pick
the setup in the pane's Models tab.

Installed as a plugin only, without the CLI? Copy `presets/setups.json` from the repo to
`~/.claude/claude-model-router/setups.json` (this replaces the file, so only do it when you have
no setups of your own). Once the file has more than one setup, the pane's Models tab shows a
setup picker to switch between them.

## Data and custom rules

Data lives in `~/.claude/claude-model-router/` (on Windows, under `%USERPROFILE%`). The CLI
also honours `CLAUDE_MODEL_ROUTER_HOME` (an absolute path) for your own use and for tests; the
mod ignores it and always uses the folder under your home.

- `setups.json`: the saved setups, the active one, the global on/off, and `sticky_tokens` (a
  whole number, 60000 by default; 0 turns holding off; edit it by hand). A setup written before
  0.4.0 has no `general` and gets the default for it. The CLI and the pane both edit it, and both
  keep keys they do not change; a pane edit re-reads the file first, so a setup saved from the CLI is kept. A file
  that does not parse is copied to `setups.json.bak-<time>` before it is replaced (never through a
symlink, and never over an older backup). Setup names use letters, digits, `-`, `_` and `.`
(up to 40); other names in the file are ignored.
- `rules.json` (optional): your own keyword rules, added to the built-in ones. The built-in
  rules always apply, so a file from an older version never hides rules added since.

To customize the rules, run `claude-model-router rules`. It writes the built-in rules to
`rules.json` (it never overwrites one that exists) and prints the path. The file maps each role
to a list of entries:

```json
{
  "write": ["pr description", "slack", "release train"],
  "chores": ["commit message", "c++ build"]
}
```

- Your own entries are plain words or phrases, not regular expressions. They match whole words,
  ignore case, and allow any spacing between words: `release train` matches "the next Release
  Train" but not "releasetrain", and `c++` matches "c++" literally.
- The built-in entries that `claude-model-router rules` writes are regular expressions and keep
  working exactly as before, as long as each one is left unchanged. Edit one and it becomes a
  plain phrase.
- A role you list uses your entries instead of the built-in ones; a role you leave out keeps
  the built-in ones.
- Your own entries are skipped when longer than 200 characters. At most 50 per role are used,
  and they look at the first 1000 characters of the prompt (built-in rules look at 4000).
- Each entry that matches adds 1 to its role. The highest score wins; a tie goes to the more
  capable role (plan, review, hard, code, write, chores in that order). `general` has no rules
  (a `general` list in `rules.json` is ignored); it takes what matches nothing.
- Chores (Haiku, low effort by default) only win when no other role matched and the prompt is
  short (12 words or fewer) or opens with a mechanical verb such as rename, bump, move, format,
  lint or "write a commit message".
- Changes apply from the next prompt; no restart needed.

## Security notes

- The mod makes no network calls and spawns no processes. To know which models your account
  offers it reads the `/config` model row's options, as `/model` lists them.
- The plugin reads only two environment variables, `HOME` and `USERPROFILE`, and uses the first
  that is an absolute path; with neither it uses the built-in defaults and writes nothing.
  `CLAUDE_MODEL_ROUTER_HOME` is CLI-only, so a repo's `.claude/settings.json` cannot point the
  plugin at files the repo controls.
- Your own rules are plain phrases, never regular expressions, so a rules file cannot make a
  prompt hang.
- Known limit: if a project's settings change `HOME` itself, the plugin follows it. That can
  only change which of the four model names and five effort levels are used (values are
  validated); it cannot run code, read other files, or hang.
- Names, folder and branch names, and words quoted from a prompt are shown with control
  characters removed.
- The text of a prompt you type while a turn runs is not kept; only a short hash of it is.

## Test

```bash
npm test             # node --test test/: classifier, store and CLI
npm run test:ui      # claude plugin test .: the mod, its band and its pane
```
