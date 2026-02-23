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
ui:
  fields:
    - key: allowedPaths
      label: "Allowed Paths"
      type: array
      itemType: file
      description: "Folders or files the editor skill may edit. Matches the fs-skill allowedPaths UI so editors only expose permitted files."
      hint:
        picker: "both"
        allowExternal: false
        preferRelpath: true
        multiple: false
---

# Editor Skill

Apply structured edits and patches to files in the agent workspace. Supports unified diff format and JSON patch format with dry-run preview.

## Supported Actions

- **applyPatch** — Apply a unified diff or JSON patch to workspace files
 - **openFile** — Read a file (if permitted) with support for line- or byte-range. Params: `path` (required), `range` ("start-end" or [start,end]), `unit` ("lines"|"bytes", default "lines"), `encoding`.

Examples:

```
[SKILL:editor-skill]{"action":"openFile","params":{"path":"README.md","range":"0-99","unit":"lines"}}
```

```
[SKILL:editor-skill]{"action":"openFile","params":{"path":"/absolute/path/to/log.txt","range":"0-1023","unit":"bytes"}}
```

## Invocation Example

```
[SKILL:editor-skill]{"action":"applyPatch","params":{"patch":"--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n line1\n-old line\n+new line\n line3","format":"git-diff","confirm":true}}
```
