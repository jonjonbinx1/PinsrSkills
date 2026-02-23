#!/usr/bin/env node
'use strict';

/**
 * editor-skill/run.js — Editor / Patch Skill
 *
 * Apply structured patches/diffs to files in the agent workspace.
 * Supports unified diff (git-diff) and JSON Patch (RFC 6902) formats.
 *
 * PinsrAI subprocess protocol:
 *   Input:  { "action": "applyPatch",
 *             "params": { "patch": "...", "format": "git-diff"|"json-patch", "confirm": false },
 *             "context": { "agentId": "...", "cwd": "..." } }
 *   Output: { "success": true, "output": { "summary": {...}, "applied": bool }, ... }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PINSR_ROOT = path.join(os.homedir(), '.pinsrAI');

// ─── Logging ────────────────────────────────────────────────────────────────

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(agentId, level, message) {
  try {
    if (!agentId || agentId === '_unknown') return;
    const logDir = path.join(PINSR_ROOT, 'agents', agentId, 'logs', 'skills');
    ensureDirSync(logDir);
    const logPath = path.join(logDir, 'editor-skill.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [${level}] ${message}\n`);
  } catch { /* ignore */ }
}

// ─── Response helpers ───────────────────────────────────────────────────────

function respond(success, output, error, metadata = {}) {
  process.stdout.write(JSON.stringify({ success, output, error, metadata }) + '\n');
  process.exit(success ? 0 : 1);
}

// ─── Path security ──────────────────────────────────────────────────────────

function resolveSafePath(relativePath, workspaceRoot) {
  const resolved = path.resolve(workspaceRoot, relativePath);
  const normalizedRoot = path.resolve(workspaceRoot);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return { safe: false, resolved: null, error: `Path traversal denied: "${relativePath}"` };
  }
  return { safe: true, resolved, error: null };
}

// ─── Unified diff parser (minimal but functional) ───────────────────────────

/**
 * Parse a unified diff string into structured patches.
 */
function parseUnifiedDiff(patchStr) {
  const patches = [];
  const lines = patchStr.split('\n');
  let current = null;
  let hunk = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // File header: --- a/path or --- path
    if (line.startsWith('--- ')) {
      current = {
        oldFile: line.substring(4).replace(/^[ab]\//, '').trim(),
        newFile: null,
        hunks: [],
      };
      continue;
    }

    // File header: +++ b/path or +++ path
    if (line.startsWith('+++ ') && current) {
      current.newFile = line.substring(4).replace(/^[ab]\//, '').trim();
      patches.push(current);
      continue;
    }

    // Hunk header: @@ -start,count +start,count @@
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && current) {
      hunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
        lines: [],
      };
      current.hunks.push(hunk);
      continue;
    }

    // Hunk content lines
    if (hunk) {
      if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '') {
        hunk.lines.push(line);
      }
    }
  }

  return patches;
}

/**
 * Apply a single parsed patch to file content.
 */
function applyUnifiedPatch(originalContent, patchData) {
  const originalLines = originalContent.split('\n');
  const resultLines = [...originalLines];
  let offset = 0;
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const hunk of patchData.hunks) {
    const startIndex = hunk.oldStart - 1 + offset;
    const removals = [];
    const additions = [];

    for (const line of hunk.lines) {
      if (line.startsWith('-')) {
        removals.push(line.substring(1));
        linesRemoved++;
      } else if (line.startsWith('+')) {
        additions.push(line.substring(1));
        linesAdded++;
      }
      // Context lines (starting with ' ') are for verification
    }

    // Apply: remove old lines and insert new ones
    resultLines.splice(startIndex, removals.length, ...additions);
    offset += additions.length - removals.length;
  }

  return {
    content: resultLines.join('\n'),
    linesAdded,
    linesRemoved,
  };
}

// ─── JSON Patch (RFC 6902 subset) ───────────────────────────────────────────

/**
 * Apply JSON Patch operations to a file's content (treated as JSON).
 */
function applyJsonPatch(content, operations) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error('Target file is not valid JSON');
  }

  for (const op of operations) {
    const { op: opType, path: jsonPath, value } = op;
    const segments = jsonPath.split('/').filter(Boolean);

    if (opType === 'add' || opType === 'replace') {
      setNestedValue(data, segments, value);
    } else if (opType === 'remove') {
      removeNestedValue(data, segments);
    } else {
      throw new Error(`Unsupported JSON Patch operation: ${opType}`);
    }
  }

  return JSON.stringify(data, null, 2);
}

function setNestedValue(obj, segments, value) {
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i];
    if (!(key in current)) current[key] = {};
    current = current[key];
  }
  const lastKey = segments[segments.length - 1];
  if (lastKey === '-' && Array.isArray(current)) {
    current.push(value);
  } else {
    current[lastKey] = value;
  }
}

function removeNestedValue(obj, segments) {
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    current = current[segments[i]];
    if (!current) return;
  }
  const lastKey = segments[segments.length - 1];
  if (Array.isArray(current)) {
    current.splice(parseInt(lastKey, 10), 1);
  } else {
    delete current[lastKey];
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────────

async function handleApplyPatch(params, workspaceRoot, agentId) {
  const { patch, format = 'git-diff', confirm = false, targetFile } = params;

  if (!patch) {
    return respond(false, null, 'Missing required param: patch');
  }

  const startTime = Date.now();

  if (format === 'git-diff') {
    return handleGitDiff(patch, workspaceRoot, agentId, confirm, startTime);
  } else if (format === 'json-patch') {
    return handleJsonPatch(patch, targetFile, workspaceRoot, agentId, confirm, startTime);
  } else {
    return respond(false, null, `Unsupported patch format: "${format}". Supported: git-diff, json-patch`);
  }
}

async function handleGitDiff(patchStr, workspaceRoot, agentId, confirm, startTime) {
  let patches;
  try {
    patches = parseUnifiedDiff(patchStr);
  } catch (err) {
    return respond(false, null, `Failed to parse unified diff: ${err.message}`);
  }

  if (patches.length === 0) {
    return respond(false, null, 'No patches found in the provided diff');
  }

  // Validate all file paths
  const summary = {
    filesChanged: [],
    totalHunks: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  };

  const fileResults = [];

  for (const patchData of patches) {
    const filePath = patchData.newFile || patchData.oldFile;
    if (!filePath) continue;

    const { safe, resolved, error } = resolveSafePath(filePath, workspaceRoot);
    if (!safe) {
      return respond(false, null, error);
    }

    summary.filesChanged.push(filePath);
    summary.totalHunks += patchData.hunks.length;

    if (confirm) {
      // Actually apply the patch
      if (!fs.existsSync(resolved)) {
        // New file — create from additions
        const newContent = patchData.hunks
          .flatMap(h => h.lines.filter(l => l.startsWith('+')).map(l => l.substring(1)))
          .join('\n');
        ensureDirSync(path.dirname(resolved));
        fs.writeFileSync(resolved, newContent, 'utf8');
        const linesAdded = newContent.split('\n').length;
        summary.totalLinesAdded += linesAdded;
        fileResults.push({ file: filePath, status: 'created', linesAdded, linesRemoved: 0 });
      } else {
        const originalContent = fs.readFileSync(resolved, 'utf8');
        const result = applyUnifiedPatch(originalContent, patchData);
        fs.writeFileSync(resolved, result.content, 'utf8');
        summary.totalLinesAdded += result.linesAdded;
        summary.totalLinesRemoved += result.linesRemoved;
        fileResults.push({
          file: filePath,
          status: 'modified',
          linesAdded: result.linesAdded,
          linesRemoved: result.linesRemoved,
        });
      }
      log(agentId, 'INFO', `Applied patch to: ${filePath}`);
    } else {
      // Dry run — just compute stats
      for (const hunk of patchData.hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith('+')) summary.totalLinesAdded++;
          if (line.startsWith('-')) summary.totalLinesRemoved++;
        }
      }
      fileResults.push({ file: filePath, status: 'dry-run' });
    }
  }

  respond(true, {
    applied: confirm,
    summary,
    files: fileResults,
  }, null, {
    durationMs: Date.now() - startTime,
    format: 'git-diff',
    dryRun: !confirm,
  });
}

async function handleJsonPatch(patchInput, targetFile, workspaceRoot, agentId, confirm, startTime) {
  if (!targetFile) {
    return respond(false, null, 'json-patch format requires param: targetFile');
  }

  const { safe, resolved, error } = resolveSafePath(targetFile, workspaceRoot);
  if (!safe) return respond(false, null, error);

  if (!fs.existsSync(resolved)) {
    return respond(false, null, `Target file not found: ${targetFile}`);
  }

  let operations;
  try {
    operations = typeof patchInput === 'string' ? JSON.parse(patchInput) : patchInput;
    if (!Array.isArray(operations)) throw new Error('Expected array of operations');
  } catch (err) {
    return respond(false, null, `Invalid JSON Patch: ${err.message}`);
  }

  const originalContent = fs.readFileSync(resolved, 'utf8');

  // Validate operations
  for (const op of operations) {
    if (!op.op || !op.path) {
      return respond(false, null, `Invalid operation: each entry needs "op" and "path" fields`);
    }
    if (!['add', 'remove', 'replace'].includes(op.op)) {
      return respond(false, null, `Unsupported operation type: ${op.op}. Supported: add, remove, replace`);
    }
  }

  try {
    const newContent = applyJsonPatch(originalContent, operations);

    if (confirm) {
      fs.writeFileSync(resolved, newContent, 'utf8');
      log(agentId, 'INFO', `Applied JSON patch to: ${targetFile} (${operations.length} ops)`);
    }

    respond(true, {
      applied: confirm,
      targetFile,
      operationCount: operations.length,
      preview: confirm ? undefined : newContent.substring(0, 2000),
    }, null, {
      durationMs: Date.now() - startTime,
      format: 'json-patch',
      dryRun: !confirm,
    });
  } catch (err) {
    respond(false, null, `Failed to apply JSON patch: ${err.message}`, {
      durationMs: Date.now() - startTime,
    });
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

let inputData = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { inputData += chunk; });
process.stdin.on('end', () => {
  const startTime = Date.now();
  try {
    const input = JSON.parse(inputData.trim());
    const { action, params = {}, context = {} } = input;
    const agentId = context.agentId || '_unknown';
    const cwd = context.cwd || process.cwd();

    if (action !== 'applyPatch') {
      respond(false, null, `Unknown action: "${action}". Supported: applyPatch`, { durationMs: Date.now() - startTime });
      return;
    }

    handleApplyPatch(params, cwd, agentId).catch((err) => {
      log(agentId, 'ERROR', `applyPatch failed: ${err.message}`);
      respond(false, null, `applyPatch failed: ${err.message}`, { durationMs: Date.now() - startTime });
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
