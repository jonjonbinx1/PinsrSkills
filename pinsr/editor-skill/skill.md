---
name: "editor-skill"
version: "2.0.0"
description: "Owner of all file-content operations and text-aware edits."
usage: "Text-file editing, atomic writes, and patch application."
actions:
  - name: applyPatch
    purpose: "Apply unified diff (`git-diff`) or JSON Patch (RFC 6902) to workspace files."
    paramsSchema:
      type: object
      properties:
        patch: { type: string }
        format: { type: string, enum: ["git-diff","json-patch"] }
        confirm: { type: boolean }
        targetFile: { type: string }
      required: ["patch"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        summary: { type: object }
        applied: { type: boolean }
      required: ["applied"]
    examples: |
      {"action":"applyPatch","params":{"patch":"--- a/src/hello.ts\n+++ b/src/hello.ts\n@@ -1 +1 @@\n-export const greet = () => 'hello';\n+export const greet = (n: string) => `hi ${n}`;","format":"git-diff","confirm":true}}
    constraints:
      maxBytes: 10485760
      sandboxedTo: allowedPaths
      requireConfirm: true
  - name: createFile
    purpose: "Create a new file with initial content; overwrite if requested."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
        content: { type: string }
        encoding: { type: string }
        overwrite: { type: boolean }
      required: ["path"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        path: { type: string }
        bytesWritten: { type: integer }
        created: { type: boolean }
      required: ["path","bytesWritten","created"]
    examples: |
      {"action":"createFile","params":{"path":"src/hello.ts","content":"export const greet = () => 'hello';\n","encoding":"utf8"}}

  - name: insertContent
    purpose: "Insert text at a given 0-based line number in a file."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
        line: { type: integer }
        content: { type: string }
        encoding: { type: string }
      required: ["path","line","content"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        path: { type: string }
        insertedAt: { type: integer }
        linesInserted: { type: integer }
      required: ["path","insertedAt","linesInserted"]
    examples: |
      {"action":"insertContent","params":{"path":"src/hello.ts","line":5,"content":"// inserted\n// second line\n"}}

  - name: replaceRange
    purpose: "Replace a line range with new content."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
        startLine: { type: integer }
        endLine: { type: integer }
        newContent: { type: string }
        encoding: { type: string }
      required: ["path","startLine","endLine","newContent"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        path: { type: string }
        replacedLines: { type: object }
        insertedLines: { type: integer }
      required: ["path","replacedLines","insertedLines"]
    examples: |
      {"action":"replaceRange","params":{"path":"src/hello.ts","startLine":3,"endLine":4,"newContent":"export const greet = (name: string) => `hello ${name}`;\n"}}

  - name: appendContent
    purpose: "Append text to the end of a file."
    paramsSchema:
      type: object
      properties:
        path: { type: string }
        content: { type: string }
        encoding: { type: string }
      required: ["path","content"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        path: { type: string }
        bytesAppended: { type: integer }
      required: ["path","bytesAppended"]
    examples: |
      {"action":"appendContent","params":{"path":"src/hello.ts","content":"// end of file\n"}}
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

