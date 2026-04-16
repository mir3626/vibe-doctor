---
name: vibe-sprint-mode
description: Toggle agent-delegation permission presets for autonomous Sprint execution.
---

# /vibe-sprint-mode

Usage: `/vibe-sprint-mode on|off|status`

## What it does

- **on**: Merges scope-bound permission rules from `.vibe/settings-presets/agent-delegation.json` into `.claude/settings.local.json`. Reduces permission prompts during autonomous Sprint execution.
- **off**: Removes only the preset rules. Your custom permission entries are untouched.
- **status**: Shows how many preset rules are currently active.

## Underlying command

```bash
node scripts/vibe-sprint-mode.mjs <on|off|status>
```

## Security

- Rules are scope-bound (npm/npx/node/git commands within project).
- `npm install` is included -- be aware of malicious postinstall scripts in untrusted deps. Use `--ignore-scripts` for unknown packages.
- The preset never grants shell access beyond the listed patterns.
- Only `.claude/settings.local.json` is modified. Project settings (`.claude/settings.json`) are never touched.
