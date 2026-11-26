---
description: Show or change Switchboard model routing (setups, on/off)
argument-hint: "[show|list|use <setup>|set <role> <model> [effort]|save <name>|on|off]"
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/bin/switchboard.js" $ARGUMENTS --session "${CLAUDE_SESSION_ID}"`

Show the output above to the user as is, in a code block. Do not add commentary unless it shows an error.
