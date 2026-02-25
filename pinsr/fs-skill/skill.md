---
name: "fs-skill"
version: "2.0.0"
description: "Owner of filesystem-level operations. No content creation or text manipulation."
usage: "Filesystem operations: metadata, moves, copies, and binary-safe reads."
actions:
  - name: readRaw
    purpose: "Read raw bytes or a byte-range from a file (binary-safe)."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
        start: { type: integer, minimum: 0 }
        end: { type: integer, minimum: 0 }
      required: ["path"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        data: { type: string }
        encoding: { type: string }
      required: ["data"]
    examples: |
      {"action":"readRaw","params":{"path":"assets/logo.png","start":0,"end":1023}}
    constraints:
      maxBytes: 52428800
      sandboxedTo: allowedPaths
      requireConfirm: false

  - name: listDirectory
    purpose: "Return directory entries (names + types)."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
        includeHidden: { type: boolean }
      required: ["path"]
      additionalProperties: false
    examples: |
      {"action":"listDirectory","params":{"path":"src/"}}
  - name: deleteFile
    purpose: "Delete a file at the given path."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
      required: ["path"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        path: { type: string }
        deleted: { type: boolean }
      required: ["path","deleted"]
    examples: |
      {"action":"deleteFile","params":{"path":"src/old.txt"}}

  - name: stat
    purpose: "Return filesystem metadata for a path (size, mtime, type)."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
      required: ["path"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        size: { type: integer }
        mtime: { type: string }
        type: { type: string }
      required: ["size","mtime","type"]
    examples: |
      {"action":"stat","params":{"path":"src/hello.ts"}}

  - name: exists
    purpose: "Return whether a path exists."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
      required: ["path"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        exists: { type: boolean }
      required: ["exists"]
    examples: |
      {"action":"exists","params":{"path":"src/hello.ts"}}

  - name: copyFile
    purpose: "Copy a file from src to dest." 
    paramsSchema:
      type: object
      properties:
        src: { type: string }
        dest: { type: string }
        overwrite: { type: boolean }
      required: ["src","dest"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        src: { type: string }
        dest: { type: string }
        copied: { type: boolean }
      required: ["src","dest","copied"]
    examples: |
      {"action":"copyFile","params":{"src":"src/hello.ts","dest":"src/hello.bak.ts"}}

  - name: moveFile
    purpose: "Move or rename a file (src -> dest)."
    paramsSchema:
      type: object
      properties:
        src: { type: string }
        dest: { type: string }
      required: ["src","dest"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        src: { type: string }
        dest: { type: string }
        moved: { type: boolean }
      required: ["src","dest","moved"]
    examples: |
      {"action":"moveFile","params":{"src":"src/hello.ts","dest":"src/greet.ts"}}

  - name: createDirectory
    purpose: "Create a directory (recursive)."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
        recursive: { type: boolean }
      required: ["path"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        path: { type: string }
        created: { type: boolean }
      required: ["path","created"]
    examples: |
      {"action":"createDirectory","params":{"path":"src/utils/","recursive":true}}

  - name: deleteDirectory
    purpose: "Delete a directory; use `recursive:true` to remove non-empty directories (may require `confirm`)."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
        recursive: { type: boolean }
        confirm: { type: boolean }
      required: ["path"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        path: { type: string }
        deleted: { type: boolean }
      required: ["path","deleted"]
    examples: |
      {"action":"deleteDirectory","params":{"path":"dist/","recursive":true,"confirm":true}}

  - name: setPermissions
    purpose: "Set POSIX permission bits for a path (no-op on Windows)."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
        mode: { type: string }
      required: ["path","mode"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        path: { type: string }
        mode: { type: string }
        success: { type: boolean }
      required: ["path","mode","success"]
    examples: |
      {"action":"setPermissions","params":{"path":"bin/script.sh","mode":"0755"}}

  - name: getPermissions
    purpose: "Return current permission bits for a path."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
      required: ["path"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        path: { type: string }
        mode: { type: string }
      required: ["path","mode"]
    examples: |
      {"action":"getPermissions","params":{"path":"bin/script.sh"}}

  - name: getAllowedPaths
    purpose: "Return the configured allowedPaths list (per-agent or global)."
    paramsSchema:
      type: object
      properties: {}
      required: []
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        allowedPaths: { type: array }
      required: ["allowedPaths"]
    examples: |
      {"action":"getAllowedPaths","params":{}}
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
[SKILL:pinsr/fs-skill]{"action":"listDirectory","params":{"path":"src/"}}
```

**Get file metadata**
```
[SKILL:pinsr/fs-skill]{"action":"stat","params":{"path":"src/hello.ts"}}
```

**Check existence**
```
[SKILL:pinsr/fs-skill]{"action":"exists","params":{"path":"src/hello.ts"}}
```

**Copy a file**
```
[SKILL:pinsr/fs-skill]{"action":"copyFile","params":{"src":"src/hello.ts","dest":"src/hello.backup.ts"}}
```

**Move / rename a file**
```
[SKILL:pinsr/fs-skill]{"action":"moveFile","params":{"src":"src/hello.ts","dest":"src/greet.ts"}}
```

**Delete a file**
```
[SKILL:pinsr/fs-skill]{"action":"deleteFile","params":{"path":"src/greet.ts"}}
```

**Create a directory**
```
[SKILL:pinsr/fs-skill]{"action":"createDirectory","params":{"path":"src/utils/"}}
```

**Delete a directory (recursive)**
```
[SKILL:pinsr/fs-skill]{"action":"deleteDirectory","params":{"path":"dist/","recursive":true,"confirm":true}}
```

**Read raw bytes (byte range)**
```
[SKILL:pinsr/fs-skill]{"action":"readRaw","params":{"path":"assets/logo.png","start":0,"end":1023}}
```

