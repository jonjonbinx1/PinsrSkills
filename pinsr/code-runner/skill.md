---
name: "code-runner"
version: "1.0.0"
description: "Safely execute JavaScript/TypeScript snippets in a sandboxed environment."
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
