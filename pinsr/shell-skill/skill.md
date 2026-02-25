---
name: "shell-skill"
version: "1.0.0"
description: "Execute shell commands with timeout and sandboxing."
usage: "Run shell commands inside the workspace with safety filters."
actions:
  - name: exec
    purpose: "Execute a shell command with timeout and workspace-restricted cwd."
    paramsSchema:
      type: object
      properties:
        cmd: { type: string }
        timeoutMs: { type: integer, minimum: 0 }
        cwd: { type: string }
      required: ["cmd"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        stdout: { type: string }
        stderr: { type: string }
        exitCode: { type: integer }
      required: ["stdout","stderr","exitCode"]
    examples: |
      {"action":"exec","params":{"cmd":"ls -la","timeoutMs":10000}}
    constraints:
      sandboxedTo: workspace
      requireConfirm: false
requires_code: true
entrypoint: "run.js"
language: "node"
permissions:
  - "process:exec"
tags: ["shell","utility"]
contributor: "pinsr"
---

# Shell Skill

Execute shell commands safely inside the agent workspace. Commands are sandboxed to the workspace directory, subject to timeout enforcement, and filtered through a dangerous-command blocklist.

## Supported Actions

- **exec** — Execute a shell command

## Invocation Example

```
[SKILL:shell-skill]{"action":"exec","params":{"cmd":"ls -la","timeoutMs":10000}}
```
