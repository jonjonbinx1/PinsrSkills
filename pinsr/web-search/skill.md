---
name: "web-search"
version: "1.0.0"
description: "Perform web searches using Tavily with fallback to other providers."
requires_code: true
entrypoint: "run.js"
language: "node"
permissions:
  - "network"
tags: ["search","web"]
contributor: "pinsr"
---

# Web Search Skill

Perform web searches using Tavily as the primary provider, with fallback to DuckDuckGo Instant Answer and Wikipedia APIs.

## Supported Actions

- **search** — Perform a web search query

## Invocation Example

```
[SKILL:web-search]{"action":"search","params":{"query":"Node.js 22 features","limit":5}}
```

## Secrets

Tavily credentials must be stored via the secrets manager:

```bash
pinsrai secrets set tavily '{"apiKey":"tvly-..."}'
```
- **Sources**: Likely authoritative sources for this topic
- **Confidence**: High/Medium/Low based on your training data relevance
