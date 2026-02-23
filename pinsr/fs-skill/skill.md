---
name: "fs-skill"
version: "1.0.0"
description: "Read and modify files in the agent workspace."
requires_code: true
entrypoint: "run.js"
language: "node"
permissions:
  - "filesystem:read"
  - "filesystem:write"
tags: ["filesystem","utility"]
ui:
  fields:
    - key: allowedPaths
      label: "Allowed Paths"
      type: array
      itemType: text
      description: "Folders or files the fs skill may access. Use the Browse button to add entries; picks inside the workspace will be saved as workspace-relative paths for portability."
      placeholder: "./relative/path or select with Browse"
      hint:
        picker: "both"
        allowExternal: false
        preferRelpath: true
        multiple: false
---

# File System Skill

Provides filesystem operations within the agent workspace. All paths are resolved relative to the agent workspace root and sandboxed to prevent directory traversal.

## Supported Actions

- **readFile** — Read file contents
- **writeFile** — Write content to a file (creates parent dirs)
- **appendFile** — Append content to a file
- **deleteFile** — Delete a file
- **listDirectory** — List directory contents (aliases: `listFiles`, `list`)
- **stat** — Get file/directory metadata

## Invocation Example

```
[SKILL:fs-skill]{"action":"readFile","params":{"path":"README.md","encoding":"utf8"}}
```
