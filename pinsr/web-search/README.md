# web-search — Web Search Skill (Tavily Primary)

Perform web searches using Tavily as the primary provider with fallback to DuckDuckGo Instant Answer and Wikipedia APIs.

## Actions

| Action   | Params                                              | Description        |
|----------|-----------------------------------------------------|--------------------|
| `search` | `{ query, limit?, providerPreferences? }`          | Perform a search   |

## Provider Fallback Chain

1. **Tavily** (primary) — Requires API key via secrets manager
2. **DuckDuckGo** — Instant Answer API (no API key needed)
3. **Wikipedia** — MediaWiki search API (no API key needed)

## Secrets Setup

Tavily requires an API key stored in the PinsrAI secrets manager:

```bash
# Via CLI
pinsrai secrets set tavily '{"apiKey":"tvly-your-api-key-here"}'

# Or create the file directly
echo '{"apiKey":"tvly-..."}' > ~/.pinsrAI/secrets/tavily.json
```

If no Tavily key is configured, the skill will fall back to DuckDuckGo and Wikipedia.

## CLI Example

```bash
node scripts/test-skill-invoke.js --skill web-search --action search --params '{"query":"Node.js 22 features","limit":3}'
```

## Direct Invocation

```bash
echo '{"action":"search","params":{"query":"TypeScript 5.0","limit":3},"context":{"agentId":"test","cwd":"."}}' | node skills/web-search/run.js
```

## Agent Invocation (LLM output)

```
[SKILL:web-search]{"action":"search","params":{"query":"latest Rust release notes","limit":5}}
```

## Electron UI Flow

The UI calls `window.pinsrAI.invokeSkill('agent-id', 'web-search', 'search', { query: '...' })` via the IPC bridge.

## Output Format

```json
{
  "success": true,
  "output": {
    "query": "Node.js 22 features",
    "results": [
      {
        "title": "Node.js 22 Release Notes",
        "url": "https://...",
        "snippet": "Node.js 22 introduces...",
        "source": "tavily",
        "score": 0.95,
        "timestamp": "2026-02-21T..."
      }
    ],
    "answer": "Node.js 22 introduces..."
  },
  "error": null,
  "metadata": {
    "durationMs": 450,
    "provider": "tavily",
    "attemptedProviders": ["tavily"],
    "resultCount": 5
  }
}
```
