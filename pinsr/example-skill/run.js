#!/usr/bin/env node
/**
 * run.js — Example skill entrypoint.
 * Reads JSON input from stdin, processes it, and writes JSON output to stdout.
 *
 * Protocol:
 *   Input:  { "message": "...", "context": { ... } }
 *   Output: { "result": "...", "metadata": { ... } }
 */

let inputData = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(inputData.trim());
    const message = input.message || '';

    // Example processing: word count, character count, echo
    const words = message.split(/\s+/).filter((w) => w.length > 0);
    const result = {
      result: `Processed your input. Here's what I found:`,
      echo: message,
      analysis: {
        characterCount: message.length,
        wordCount: words.length,
        uppercased: message.toUpperCase(),
      },
      metadata: {
        skill: 'example-skill',
        processedAt: new Date().toISOString(),
        nodeVersion: process.version,
      },
    };

    process.stdout.write(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`Error processing input: ${err.message}\n`);
    process.exit(1);
  }
});

// Handle empty stdin
setTimeout(() => {
  if (!inputData) {
    const result = {
      result: 'No input received. Send a JSON object with a "message" field.',
      metadata: { skill: 'example-skill' },
    };
    process.stdout.write(JSON.stringify(result, null, 2));
    process.exit(0);
  }
}, 5000);
