````skill
---
name: "editor-skill"
version: "2.0.0"
description: "Owner of all file-content operations and text-aware edits."
requires_code: true
entrypoint: "run.js"
language: "node"
permissions:
  - "filesystem:write"
tags: ["editor","patch","content"]
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

**Owner of all file-content operations.** Use this skill whenever you need to create, read, insert, append, replace, or patch the textual content of a file. All writes are atomic (write-to-temp + rename).

## Capabilities

| Action | Description |
|---|---|
| `createFile` | Create a new file with initial content; fails if path exists unless `overwrite: true` |
| `openFile` | Text-aware read with optional line/byte range and encoding |
| `insertContent` | Insert lines at a given line number (0-based) |
| `appendContent` | Append text to the end of a file |
| `replaceRange` | Replace a line range with new text |
| `applyPatch` | Apply a unified diff (`git-diff`) or JSON Patch (RFC 6902) |

## Safety & Constraints

- Paths must be inside `allowedPaths` (shared config with `fs-skill`).
- Maximum file size for writes: 10 MB. Reads: 50 MB.
- Binary files are rejected; use `fs-skill` `readRaw` for binary access.
- All writes use an atomic temp-file + rename sequence.
- `applyPatch` validates the full patch before applying any hunk.

## Examples

**Create a file**
```
[SKILL:pinsr/editor-skill]{"action":"createFile","params":{"path":"src/hello.ts","content":"export const greet = () => 'hello';\n","encoding":"utf8"}}
```

**Open (read) a file by line range**
```
[SKILL:pinsr/editor-skill]{"action":"openFile","params":{"path":"src/hello.ts","range":"0-49","unit":"lines"}}
```

**Insert two lines at line 5**
```
[SKILL:pinsr/editor-skill]{"action":"insertContent","params":{"path":"src/hello.ts","line":5,"content":"// inserted\n// second line\n"}}
```

**Replace lines 3–4**
```
[SKILL:pinsr/editor-skill]{"action":"replaceRange","params":{"path":"src/hello.ts","startLine":3,"endLine":4,"newContent":"export const greet = (name: string) => `hello ${name}`;\n"}}
```

**Append to a file**
```
[SKILL:pinsr/editor-skill]{"action":"appendContent","params":{"path":"src/hello.ts","content":"// end of file\n"}}
```

**Apply a unified diff**
```
[SKILL:pinsr/editor-skill]{"action":"applyPatch","params":{"patch":"--- a/src/hello.ts\n+++ b/src/hello.ts\n@@ -1 +1 @@\n-export const greet = () => 'hello';\n+export const greet = (n: string) => `hi ${n}`;","format":"git-diff","confirm":true}}
```

## When to Call Which Skill

| Need | Use |
|---|---|
| Create or write file content | **editor-skill** |
| Read text content (line range) | **editor-skill** (`openFile`) |
| Patch or edit file content | **editor-skill** |
| Move, rename, or delete a file | `fs-skill` |
| List a directory or check metadata | `fs-skill` |
| Read raw binary bytes | `fs-skill` (`readRaw`) |
| Create or delete a directory | `fs-skill` |

````
