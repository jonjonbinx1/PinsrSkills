---
name: "web-search"
version: "1.0.0"
description: "Perform web searches using Tavily with fallback to other providers."
usage: "Perform web searches with provider fallbacks (Tavily → DuckDuckGo → Wikipedia)."
actions:
  - name: search
    purpose: "Perform a web search query using configured providers with fallback ordering."
    paramsSchema:
      type: object
      properties:
        query: { type: string }
        limit: { type: integer, minimum: 1 }
        providerPreferences:
          type: array
          items: { type: string }
      required: ["query"]
      additionalProperties: false
    resultSchema:
      type: object
      properties:
        results: { type: array }
        provider: { type: string }
      required: ["results"]
    examples: |
      {"action":"search","params":{"query":"Node.js 22 features","limit":5}}
    constraints:
      requireConfirm: false
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
