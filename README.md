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

A prompt that matches no role stays on your main model.

## How it works

Claude Model Router is a Claude Code mod:

- **`prompt.submit`** sorts the prompt into a role with keyword rules.
- **`turn.step`** sends every main-chat request of that turn with the role's model and
  effort. Nothing goes through a proxy or a helper agent, and subagents are left alone.
- **The band above the prompt** shows the model, an effort meter, the role, and why it was
  picked:

  ```
   ▮▮▮▯▯ Opus · high   hard  ← debug                         default  Router
  ```

- **`/router`** opens a pane:
  - **Now**: this turn's route, a pin, and a setup picker.
  - **Setups**: the model and effort for each role, plus save as.

## Install

```bash
npm install -g @siamakrostami/claude-model-router
claude plugin marketplace add "$(npm root -g)/@siamakrostami/claude-model-router"
claude plugin install model-router@model-router
```

From a clone instead: `npm install && npm link`, then `claude plugin marketplace add "$PWD"`
and the same `claude plugin install` line. Needs Claude Code 2.1.330 or newer.

Set your main model to Fable (`"model": "fable"` in `~/.claude/settings.json`).

## Use

Just type. To steer one prompt, include one of these:

- `#plan` `#review` `#hard` `#code` `#write` `#chores`: force a role
- `@fable` `@opus` `@sonnet` `@haiku`, or "use haiku for this": force a model
- `#self` or "do it yourself": stay on the main model

In a session:

- `/router`: open the pane
- `/router hard`: pin every turn to one role; `/router auto` unpins
- `/router off` / `/router on`: pause or resume this session

If you switch models yourself with `/model`, Claude Model Router steps aside until you switch back
to the main model (set `main_model` in `setups.json` if yours is not Fable).

From a terminal:

```bash
claude-model-router                      # full-screen setup picker
claude-model-router show | list
claude-model-router set code opus high
claude-model-router save fast            # save the current setup under a name
claude-model-router use default
claude-model-router off | on             # everywhere
```

Data lives in `~/.claude/claude-model-router/`: `setups.json`, and `rules.json` (keyword regexes,
which you can edit).

## Test

```bash
npm test
```
