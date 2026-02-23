#!/usr/bin/env node
'use strict';

/**
 * web-search/run.js — Web Search Skill (Tavily primary, fallback chain)
 *
 * PinsrAI subprocess protocol:
 *   Input:  { "action": "search",
 *             "params": { "query": "...", "limit": 5, "providerPreferences": ["tavily","duckduckgo","wikipedia"] },
 *             "context": { "agentId": "...", "cwd": "..." } }
 *   Output: { "success": true, "output": { "results": [...] }, "error": null, "metadata": {...} }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const PINSR_ROOT = path.join(os.homedir(), '.pinsrAI');
const SECRETS_DIR = path.join(PINSR_ROOT, 'secrets');

// ─── Logging ────────────────────────────────────────────────────────────────

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(agentId, level, message) {
  try {
    if (!agentId || agentId === '_unknown') return;
    const logDir = path.join(PINSR_ROOT, 'agents', agentId, 'logs', 'skills');
    ensureDirSync(logDir);
    const logPath = path.join(logDir, 'web-search.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [${level}] ${message}\n`);
  } catch { /* ignore */ }
}

// ─── Secrets ────────────────────────────────────────────────────────────────

function getSecret(provider) {
  const secretPath = path.join(SECRETS_DIR, `${provider}.json`);
  if (!fs.existsSync(secretPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(secretPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── Response helpers ───────────────────────────────────────────────────────

function respond(success, output, error, metadata = {}) {
  process.stdout.write(JSON.stringify({ success, output, error, metadata }) + '\n');
  process.exit(success ? 0 : 1);
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 15000,
    };

    const req = mod.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ─── Tavily provider ────────────────────────────────────────────────────────

async function searchTavily(query, limit, agentId) {
  const creds = getSecret('tavily');
  if (!creds || !creds.apiKey) {
    return {
      success: false,
      error: 'Tavily API key not configured. Set it with: pinsrai secrets set tavily \'{"apiKey":"tvly-..."}\'',
      results: [],
    };
  }

  log(agentId, 'INFO', `Tavily search: "${query}" (limit: ${limit})`);
  const startTime = Date.now();

  try {
    const body = JSON.stringify({
      api_key: creds.apiKey,
      query,
      max_results: limit,
      search_depth: 'basic',
      include_answer: true,
    });

    const res = await httpRequest('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      body,
    });

    const durationMs = Date.now() - startTime;
    log(agentId, 'INFO', `Tavily responded: status=${res.status} duration=${durationMs}ms`);

    if (res.status === 429) {
      return { success: false, error: 'Tavily rate limited', results: [], rateLimited: true };
    }

    if (res.status !== 200) {
      return { success: false, error: `Tavily returned status ${res.status}: ${res.data.substring(0, 200)}`, results: [] };
    }

    const data = JSON.parse(res.data);
    const results = (data.results || []).map((r) => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      source: 'tavily',
      score: r.score || null,
      timestamp: new Date().toISOString(),
      raw: r,
    }));

    return {
      success: true,
      results,
      answer: data.answer || null,
      durationMs,
    };
  } catch (err) {
    log(agentId, 'ERROR', `Tavily error: ${err.message}`);
    return { success: false, error: `Tavily request failed: ${err.message}`, results: [] };
  }
}

// ─── DuckDuckGo Instant Answer provider ─────────────────────────────────────

async function searchDuckDuckGo(query, limit, agentId) {
  log(agentId, 'INFO', `DuckDuckGo search: "${query}"`);
  const startTime = Date.now();

  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

    const res = await httpRequest(url);
    const durationMs = Date.now() - startTime;
    log(agentId, 'INFO', `DuckDuckGo responded: status=${res.status} duration=${durationMs}ms`);

    if (res.status !== 200) {
      return { success: false, error: `DuckDuckGo returned status ${res.status}`, results: [] };
    }

    const data = JSON.parse(res.data);
    const results = [];

    // Abstract
    if (data.Abstract) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || '',
        snippet: data.Abstract,
        source: 'duckduckgo',
        timestamp: new Date().toISOString(),
      });
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, limit - results.length)) {
        if (topic.Text) {
          results.push({
            title: topic.Text.substring(0, 100),
            url: topic.FirstURL || '',
            snippet: topic.Text,
            source: 'duckduckgo',
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    return {
      success: results.length > 0,
      results: results.slice(0, limit),
      durationMs,
      error: results.length === 0 ? 'No results from DuckDuckGo Instant Answer' : null,
    };
  } catch (err) {
    log(agentId, 'ERROR', `DuckDuckGo error: ${err.message}`);
    return { success: false, error: `DuckDuckGo request failed: ${err.message}`, results: [] };
  }
}

// ─── Wikipedia provider ─────────────────────────────────────────────────────

async function searchWikipedia(query, limit, agentId) {
  log(agentId, 'INFO', `Wikipedia search: "${query}"`);
  const startTime = Date.now();

  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&srlimit=${limit}&utf8=1`;

    const res = await httpRequest(url);
    const durationMs = Date.now() - startTime;
    log(agentId, 'INFO', `Wikipedia responded: status=${res.status} duration=${durationMs}ms`);

    if (res.status !== 200) {
      return { success: false, error: `Wikipedia returned status ${res.status}`, results: [] };
    }

    const data = JSON.parse(res.data);
    const results = (data.query?.search || []).map((r) => ({
      title: r.title || '',
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
      snippet: (r.snippet || '').replace(/<[^>]+>/g, ''),
      source: 'wikipedia',
      timestamp: r.timestamp || new Date().toISOString(),
    }));

    return {
      success: results.length > 0,
      results,
      durationMs,
      error: results.length === 0 ? 'No Wikipedia results found' : null,
    };
  } catch (err) {
    log(agentId, 'ERROR', `Wikipedia error: ${err.message}`);
    return { success: false, error: `Wikipedia request failed: ${err.message}`, results: [] };
  }
}

// ─── Search orchestrator with fallback chain ────────────────────────────────

const PROVIDER_MAP = {
  tavily: searchTavily,
  duckduckgo: searchDuckDuckGo,
  wikipedia: searchWikipedia,
};

async function handleSearch(params, agentId) {
  const { query, limit = 5, providerPreferences = ['tavily', 'duckduckgo', 'wikipedia'] } = params;

  if (!query || typeof query !== 'string') {
    return respond(false, null, 'Missing or invalid required param: query');
  }

  const startTime = Date.now();
  const attemptedProviders = [];
  const errors = [];

  // Try each provider in preference order
  for (const providerName of providerPreferences) {
    const searchFn = PROVIDER_MAP[providerName];
    if (!searchFn) {
      errors.push(`Unknown provider: ${providerName}`);
      continue;
    }

    attemptedProviders.push(providerName);
    log(agentId, 'INFO', `Trying provider: ${providerName}`);

    const result = await searchFn(query, limit, agentId);

    if (result.success && result.results.length > 0) {
      return respond(true, {
        query,
        results: result.results,
        answer: result.answer || null,
        provider: providerName,
      }, null, {
        durationMs: Date.now() - startTime,
        provider: providerName,
        attemptedProviders,
        resultCount: result.results.length,
      });
    }

    errors.push(`${providerName}: ${result.error || 'no results'}`);
    log(agentId, 'WARN', `Provider ${providerName} failed or returned no results, trying fallback...`);
  }

  // All providers exhausted
  respond(false, { query, results: [], attemptedProviders }, `All search providers failed: ${errors.join('; ')}`, {
    durationMs: Date.now() - startTime,
    attemptedProviders,
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

let inputData = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { inputData += chunk; });
process.stdin.on('end', () => {
  const startTime = Date.now();
  try {
    const input = JSON.parse(inputData.trim());
    // Support both v2 protocol ({ action, params, context }) and legacy ({ message, context })
    let { action, params = {}, context = {} } = input;
    // Backwards-compat: if no action provided but a legacy `message` exists, treat it as a search query
    if ((!action || typeof action !== 'string') && input && typeof input === 'object' && typeof input.message === 'string' && input.message.trim()) {
      action = 'search';
      params = params || {};
      if (!params.query) params.query = input.message;
    }
    const agentId = context.agentId || '_unknown';

    if (action !== 'search') {
      respond(false, null, `Unknown action: "${action}". Supported: search`, { durationMs: Date.now() - startTime });
      return;
    }

    handleSearch(params, agentId).catch((err) => {
      log(agentId, 'ERROR', `Search failed: ${err.message}`);
      respond(false, null, `Search failed: ${err.message}`, { durationMs: Date.now() - startTime });
    });
  } catch (err) {
    respond(false, null, `Failed to parse input: ${err.message}`, { durationMs: Date.now() - startTime });
  }
});

setTimeout(() => {
  if (!inputData) {
    respond(false, null, 'No input received (stdin timeout)', {});
  }
}, 5000);
