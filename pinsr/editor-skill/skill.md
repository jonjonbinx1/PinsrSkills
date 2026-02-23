---
name: "editor-skill"
version: "1.0.0"
description: "Apply patches/diffs to files and validate edits."
requires_code: true
entrypoint: "run.js"
language: "node"
permissions:
  - "filesystem:write"
tags: ["editor","patch"]
contributor: "pinsr"
---

# Editor Skill

Apply structured edits and patches to files in the agent workspace. Supports unified diff format and JSON patch format with dry-run preview.

## Supported Actions

- **applyPatch** — Apply a unified diff or JSON patch to workspace files

## Invocation Example

```
[SKILL:editor-skill]{"action":"applyPatch","params":{"patch":"--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n line1\n-old line\n+new line\n line3","format":"git-diff","confirm":true}}
```
