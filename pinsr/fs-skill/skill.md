````skill
---
name: "fs-skill"
version: "2.0.0"
description: "Owner of filesystem-level operations. No content creation or text manipulation."
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
        picker: "both"
        allowExternal: false
        preferRelpath: true
        multiple: false
contributor: "pinsr"
---

# File System Skill

**Owner of filesystem-level operations.** Handles structure, metadata, moves, copies, and raw byte access. Does not create or modify file content — delegate all content writes to `editor-skill`.

## Capabilities

| Action | Description |
|---|---|
| `readRaw` | Read raw bytes or a byte-range; binary-safe; returns base64 + decoded text. Alias: `readFile` |
| `listDirectory` | List entries in a directory. Aliases: `list`, `listFiles`, `listDir` |
| `stat` | Return metadata: size, mtime, type, mode |
| `exists` | Check whether a path exists |
| `copyFile` | Copy a file to a destination path |
| `moveFile` | Move or rename a file. Alias: `rename` |
| `deleteFile` | Delete a file |
| `createDirectory` | Create a directory (recursive). Alias: `mkdir` |
| `deleteDirectory` | Delete a directory. Alias: `rmdir` |
| `setPermissions` | Set POSIX permission bits on a path |
| `getPermissions` | Return current permission bits for a path |
| `getAllowedPaths` | Return configured allowed-paths list |

## Safety & Constraints

- All paths are sandboxed to `allowedPaths`; traversal is denied.
- `deleteDirectory` with `recursive: true` requires `confirm: true`.
- `readRaw` has a 50 MB limit per call; use `start`/`end` byte params for large files.
- `setPermissions` is a no-op on Windows (returns success with a warning).

## Examples

**List a directory**
```
[SKILL:fs-skill]{"action":"listDirectory","params":{"path":"src/"}}
```

**Get file metadata**
```
[SKILL:fs-skill]{"action":"stat","params":{"path":"src/hello.ts"}}
```

**Check existence**
```
[SKILL:fs-skill]{"action":"exists","params":{"path":"src/hello.ts"}}
```

**Copy a file**
```
[SKILL:fs-skill]{"action":"copyFile","params":{"src":"src/hello.ts","dest":"src/hello.backup.ts"}}
```

**Move / rename a file**
```
[SKILL:fs-skill]{"action":"moveFile","params":{"src":"src/hello.ts","dest":"src/greet.ts"}}
```

**Delete a file**
```
[SKILL:fs-skill]{"action":"deleteFile","params":{"path":"src/greet.ts"}}
```

**Create a directory**
```
[SKILL:fs-skill]{"action":"createDirectory","params":{"path":"src/utils/"}}
```

**Delete a directory (recursive)**
```
[SKILL:fs-skill]{"action":"deleteDirectory","params":{"path":"dist/","recursive":true,"confirm":true}}
```

**Read raw bytes (byte range)**
```
[SKILL:fs-skill]{"action":"readRaw","params":{"path":"assets/logo.png","start":0,"end":1023}}
```

## When to Call Which Skill

| Need | Use |
|---|---|
| Create or write file content | `editor-skill` |
| Read text content (line range) | `editor-skill` (`openFile`) |
| Patch or edit file content | `editor-skill` |
| Move, rename, or delete a file | **fs-skill** |
| List a directory or check metadata | **fs-skill** |
| Read raw binary bytes | **fs-skill** (`readRaw`) |
| Create or delete a directory | **fs-skill** |

````
