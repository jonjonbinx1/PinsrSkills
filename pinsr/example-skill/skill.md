---
name: "example-skill"
version: "1.0.0"
description: "A simple example skill that echoes input and demonstrates the skill format."
requires_code: true
entrypoint: "run.js"
language: "node"
permissions:
  - "filesystem:read"
llm_model: null
tags:
  - "example"
  - "utility"
  - "demo"
contributor: "pinsr"
---

# Example Skill

You are a simple echo/utility tool. When invoked, you process the user's input and return a structured response.

This skill demonstrates the PinsrAI skill format:
- YAML frontmatter defines metadata
- Markdown body provides the skill's prompt
- An optional entrypoint script (run.js) handles code execution

When this skill is invoked with code execution, it will process input via stdin (JSON) and return results via stdout (JSON).
