---
name: "code-runner"
version: "1.0.0"
description: "Safely execute JavaScript/TypeScript snippets in a sandboxed environment."
usage: "Run small JS/TS snippets in a restricted VM sandbox with timeouts."
actions:
  - name: run
    purpose: "Execute JavaScript or TypeScript snippets in a sandboxed VM with enforced timeouts and pattern bans."
    paramsSchema:
      type: object
      properties:
        language: { type: string, enum: ["js","ts","javascript","typescript"] }
        code: { type: string }
        timeoutMs: { type: integer, minimum: 0 }
      required: ["code"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        result: {}
        stdout: { type: string }
        stderr: { type: string }
      required: ["stdout","stderr"]
    examples: |
      {"action":"run","params":{"language":"js","code":"const x = 2 + 2; x;","timeoutMs":5000}}
    constraints:
      maxCodeLength: 100000
      maxTimeoutMs: 30000
      requireConfirm: false
requires_code: true
entrypoint: "run.js"
language: "node"
permissions:
  - "vm"
tags: ["code","runtime"]
contributor: "pinsr"
---

# Code Runner Skill

Execute JavaScript snippets in a sandboxed VM context with no network access, no filesystem access, and configurable timeout enforcement.

## Supported Actions

- **run** — Execute a code snippet

## Invocation Example

```
[SKILL:code-runner]{"action":"run","params":{"language":"js","code":"const x = 2 + 2; x;","timeoutMs":5000}}
```
