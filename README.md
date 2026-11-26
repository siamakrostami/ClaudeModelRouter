# Switchboard

Automatic model routing for Claude Code. You type your request as usual, and Switchboard
hands each kind of work to a helper running on the model that suits it:

| Role | Handles | Default |
|---|---|---|
| plan | planning, architecture, big decisions (main chat) | Fable · xhigh |
| review | code review | Fable · high |
| hard | hard code, UI, debugging | Opus · high |
| code | regular code, tests, refactors | Sonnet · medium |
| write | PR descriptions, Slack, docs, tickets | Sonnet · medium |
| chores | git, renames, formatting, lookups, commit messages | Haiku · low |

## How it works

- **SessionStart hook** adds one standing rule: routing notes are the user's instruction.
- **UserPromptSubmit hook** matches the prompt against keyword rules and adds a one-line
  note naming the helper to use, e.g. `switchboard:router-code`.
- **PreToolUse hook** forces every `router-*` helper onto the model and effort of your
  active setup, whatever model the main chat asked for.
- **Status line segment** shows the active setup and what is running:
  `⇢ default · code→sonnet`.

## Install

```bash
npm install
npm link                                   # puts `switchboard` on PATH
claude plugin marketplace add "$PWD"
claude plugin install switchboard@switchboard
```

Set the main chat to Fable (`"model": "fable"` in `~/.claude/settings.json`). To show the
segment in your status line, add this to your status line script:

```bash
seg=$(switchboard status-segment "$session_id")
```

## Use

You don't need any command for daily use. These overrides are optional, and each one
applies only to the prompt it appears in:

- `#plan` `#review` `#hard` `#code` `#write` `#chores`: force a role
- `@fable` `@opus` `@sonnet` `@haiku`: force a model
- `#self`: no routing; the main chat does the work

Setups:

```bash
switchboard                      # interactive picker
switchboard show | list
switchboard set code opus high
switchboard save fast            # save the current setup under a name
switchboard use default
switchboard off | on             # add --session <id> for one session only
```

Inside Claude Code: `/router`, `/router use fast`, `/router off`.

Data lives in `~/.claude/switchboard/`: `setups.json` and `rules.json` (keyword regexes,
which you can edit) and `state.json`. Errors go to `error.log`.

## Test

```bash
npm test
```
