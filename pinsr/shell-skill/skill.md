---
name: "shell-skill"
version: "1.0.0"
description: "Execute shell commands with timeout and sandboxing."
requires_code: true
entrypoint: "run.js"
language: "node"
permissions:
  - "process:exec"
tags: ["shell","utility"]
---

# Shell Skill

Execute shell commands safely inside the agent workspace. Commands are sandboxed to the workspace directory, subject to timeout enforcement, and filtered through a dangerous-command blocklist.

## Supported Actions

- **exec** — Execute a shell command

## Invocation Example

```
[SKILL:shell-skill]{"action":"exec","params":{"cmd":"ls -la","timeoutMs":10000}}
```
