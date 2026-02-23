---
name: "fs-skill"
version: "1.0.3"
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
      itemType: file
      description: "Folders or files the fs skill may access. Use Browse to add each entry; workspace-inside picks are stored as relative paths for portability."
      hint:
        picker: "both"          # allow file or directory selection
        allowExternal: false    # external absolute paths require admin allowlist
        preferRelpath: true
        multiple: false
contributor: "pinsr"
---

# File System Skill

Provides filesystem operations within the agent workspace. All paths are either resolved relative to the agent workspace root and sandboxed to prevent directory traversal or are part of the allowed file paths.

## Supported Actions

- **readFile** — Read file contents
- **writeFile** — Write content to a file (creates parent dirs)
- **appendFile** — Append content to a file
- **deleteFile** — Delete a file
- **listDirectory** — List directory contents (aliases: `listFiles`, `list`)
- **stat** — Get file/directory metadata
- **getAllowedPaths** — Get the list of allowed file paths configured for this skill

## Invocation Example

```
[SKILL:fs-skill]{"action":"readFile","params":{"path":"README.md","encoding":"utf8"}}
```
