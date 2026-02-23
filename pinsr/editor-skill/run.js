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

// ─── Local fs-skill-like allowlist helpers (copied/adapted) ───────────────
const SKILL_NAME = 'fs-skill';
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function parseNamedYamlList(name, content) {
  const lines = content.split(/\r?\n/);
  let inBlock = false;
  const results = [];
  const inlineRegex = new RegExp(`^${name}:\\s*\\[(.*)\\]\\s*$`);
  const blockStartRegex = new RegExp(`^${name}:\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!inBlock) {
      const inlineMatch = line.match(inlineRegex);
      if (inlineMatch) {
        const inner = inlineMatch[1].trim();
        if (inner) {
          const parts = inner.split(/,\s*/).map(s => s.replace(/^\s*['\"]?|['\"]?\s*$/g, ''));
          parts.forEach(p => { if (p) results.push(p); });
        }
        continue;
      }
      if (line.startsWith(name + ':')) {
        if (blockStartRegex.test(line)) { inBlock = true; continue; }
      }
    } else {
      if (/^[\-]\s+/.test(line)) {
        const entry = line.replace(/^[\-]\s+/, '').replace(/^[\'"]|[\'\"]$/g, '');
        if (entry) results.push(entry);
        continue;
      }
      if (line && !line.startsWith('-')) break;
    }
  }
  return results;
}

function parseAllowedPathsFromYaml(content) { return parseNamedYamlList('allowedPaths', content); }

function loadAllowedPathsConfig(agentId, workspaceRoot) {
  try {
    const agentConfig = path.join(PINSR_ROOT, 'agents', agentId, 'skill-config', `${SKILL_NAME}.yaml`);
    const globalConfig = path.join(PINSR_ROOT, 'skill-config', `${SKILL_NAME}.yaml`);

    let content = null;
    let source = null;
    if (fileExists(agentConfig)) { content = fs.readFileSync(agentConfig, 'utf8'); source = 'agent'; }
    else if (fileExists(globalConfig)) { content = fs.readFileSync(globalConfig, 'utf8'); source = 'global'; }
    if (!content) return [];

    const entries = parseAllowedPathsFromYaml(content);
    const externalEntriesRaw = parseNamedYamlList('externalAllowedPaths', content);
    const resolved = [];
    const externalResolved = [];
    for (const ex of externalEntriesRaw) {
      if (!ex || String(ex).trim() === '') continue;
      let exCand = ex;
      if (!path.isAbsolute(exCand)) exCand = path.resolve(workspaceRoot, exCand);
      else exCand = path.resolve(exCand);
      try { if (fileExists(exCand)) exCand = fs.realpathSync(exCand); } catch (err) { }
      externalResolved.push(exCand);
      resolved.push(exCand);
    }

    for (const e of entries) {
      if (!e || String(e).trim() === '') continue;
      let candidate = e;
      if (!path.isAbsolute(candidate)) candidate = path.resolve(workspaceRoot, candidate);
      else candidate = path.resolve(candidate);
      try { if (fileExists(candidate)) candidate = fs.realpathSync(candidate); } catch (err) { }

      const normalizedRoot = path.resolve(workspaceRoot);
      if (candidate === normalizedRoot || candidate.startsWith(normalizedRoot + path.sep)) {
        resolved.push(candidate);
        continue;
      }

      if (path.isAbsolute(e)) {
        let added = false;
        for (const ex of externalResolved) {
          if (ex === candidate) { resolved.push(candidate); added = true; break; }
        }
        if (!added && source === 'agent') {
          resolved.push(candidate);
        }
      }
    }
    return resolved;
  } catch (err) {
    return [];
  }
}

function isTargetAllowedByList(targetResolved, allowedList, workspaceRoot) {
  if (!allowedList || allowedList.length === 0) return true;
  for (const allowed of allowedList) {
    if (!allowed) continue;
    const a = path.resolve(allowed);
    try {
      if (fs.existsSync(a) && fs.statSync(a).isDirectory()) {
        if (targetResolved === a || targetResolved.startsWith(a + path.sep)) return true;
      } else {
        if (targetResolved === a) return true;
      }
    } catch (e) { continue; }
  }
  return false;
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
    let resolved;
    const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
    if (path.isAbsolute(filePath)) {
      resolved = path.resolve(filePath);
      try { if (fileExists(resolved)) resolved = fs.realpathSync(resolved); } catch (e) {}
      if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
        return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
      }
    } else {
      const { safe, resolved: r, error } = resolveSafePath(filePath, workspaceRoot);
      if (!safe) return respond(false, null, error);
      resolved = r;
      if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
        return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
      }
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
  let resolved;
  const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
  if (path.isAbsolute(targetFile)) {
    resolved = path.resolve(targetFile);
    try { if (fileExists(resolved)) resolved = fs.realpathSync(resolved); } catch (e) {}
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${targetFile}`);
    }
    if (!fs.existsSync(resolved)) return respond(false, null, `Target file not found: ${targetFile}`);
  } else {
    const { safe, resolved: r, error } = resolveSafePath(targetFile, workspaceRoot);
    if (!safe) return respond(false, null, error);
    resolved = r;
    if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
      return respond(false, null, `Access denied by allowedPaths policy: ${targetFile}`);
    }
    if (!fs.existsSync(resolved)) return respond(false, null, `Target file not found: ${targetFile}`);
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

// Read a file within allowed paths. Supports line-range or byte-range.
async function handleOpenFile(params, workspaceRoot, agentId) {
  try {
    const { path: filePath, range, unit = 'lines', encoding = 'utf8', maxLines } = params || {};
    if (!filePath) return respond(false, null, 'Missing required param: path');

    const allowed = loadAllowedPathsConfig(agentId, workspaceRoot);
    let resolved;
    if (path.isAbsolute(filePath)) {
      resolved = path.resolve(filePath);
      try { if (fileExists(resolved)) resolved = fs.realpathSync(resolved); } catch (e) {}
      if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
        return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
      }
    } else {
      const { safe, resolved: r, error } = resolveSafePath(filePath, workspaceRoot);
      if (!safe) return respond(false, null, error);
      resolved = r;
      if (allowed && allowed.length > 0 && !isTargetAllowedByList(resolved, allowed, workspaceRoot)) {
        return respond(false, null, `Access denied by allowedPaths policy: ${filePath}`);
      }
    }

    if (!fs.existsSync(resolved)) return respond(false, null, `File not found: ${filePath}`);

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return respond(false, null, `Not a file: ${filePath}`);

    // Default: first 100 lines
    let start = 0, end = 99;
    if (range) {
      if (typeof range === 'string' && range.includes('-')) {
        const parts = range.split('-').map(s => parseInt(s, 10));
        if (!Number.isNaN(parts[0])) start = Math.max(0, parts[0]);
        if (!Number.isNaN(parts[1])) end = Math.max(start, parts[1]);
      } else if (Array.isArray(range) && range.length === 2) {
        start = Math.max(0, parseInt(range[0], 10) || 0);
        end = Math.max(start, parseInt(range[1], 10) || start);
      }
    } else if (maxLines) {
      start = 0; end = Math.max(0, parseInt(maxLines, 10) - 1);
    }

    if (unit === 'bytes') {
      const buf = fs.readFileSync(resolved);
      const total = buf.length;
      const bstart = start; const bend = Math.min(end, total - 1);
      const slice = buf.slice(bstart, bend + 1);
      const text = slice.toString(encoding);
      const rel = toRelativePosix(resolved, workspaceRoot);
      return respond(true, {
        path: rel,
        realpath: resolved,
        unit: 'bytes',
        start: bstart,
        end: bend,
        totalBytes: total,
        content: text,
        truncated: (bend < total - 1),
      }, null, { size: stat.size, mtime: stat.mtime.toISOString() });
    }

    // lines
    const content = fs.readFileSync(resolved, encoding);
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;
    const s = Math.max(0, start);
    const e = Math.min(end, totalLines - 1);
    const slice = lines.slice(s, e + 1).join('\n');
    const rel = toRelativePosix(resolved, workspaceRoot);
    return respond(true, {
      path: rel,
      realpath: resolved,
      unit: 'lines',
      start: s,
      end: e,
      totalLines,
      content: slice,
      truncated: (e < totalLines - 1),
    }, null, { size: stat.size, mtime: stat.mtime.toISOString() });

  } catch (err) {
    return respond(false, null, `openFile failed: ${err.message}`);
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

    // Supported actions: applyPatch, openFile
    if (action === 'applyPatch') {
      handleApplyPatch(params, cwd, agentId).catch((err) => {
        log(agentId, 'ERROR', `applyPatch failed: ${err.message}`);
        respond(false, null, `applyPatch failed: ${err.message}`, { durationMs: Date.now() - startTime });
      });
      return;
    }

    if (action === 'openFile') {
      handleOpenFile(params, cwd, agentId).catch((err) => {
        log(agentId, 'ERROR', `openFile failed: ${err.message}`);
        respond(false, null, `openFile failed: ${err.message}`, { durationMs: Date.now() - startTime });
      });
      return;
    }

    respond(false, null, `Unknown action: "${action}". Supported: applyPatch, openFile`, { durationMs: Date.now() - startTime });
  } catch (err) {
    respond(false, null, `Failed to parse input: ${err.message}`, { durationMs: Date.now() - startTime });
  }
});

setTimeout(() => {
  if (!inputData) {
    respond(false, null, 'No input received (stdin timeout)', {});
  }
}, 5000);
