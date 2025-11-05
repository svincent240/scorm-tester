const { spawn } = require('child_process');
const path = require('path');

/**
 * MCP stdout purity test
 * Ensures stdout contains only JSON-RPC 2.0 messages (one per line) and nothing else.
 * Non-protocol logs must not contaminate stdout.
 */

describe('MCP stdout purity', () => {
  jest.setTimeout(15000);

  function isJsonRpcLine(line) {
    try {
      const obj = JSON.parse(line);
      return obj && obj.jsonrpc === '2.0' && (obj.result !== undefined || obj.error !== undefined);
    } catch (_) {
      return false;
    }
  }

  test('stdout emits only JSON-RPC 2.0 lines', async () => {
    const proc = spawn('node', [path.join(__dirname, '../../src/mcp/node-bridge.js')], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: 'false' }
    });

    const stdoutLines = [];
    const stderrLines = [];

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');

    proc.stdout.on('data', (chunk) => {
      const parts = chunk.split('\n').map(s => s.trim()).filter(Boolean);
      stdoutLines.push(...parts);
    });
    proc.stderr.on('data', (chunk) => {
      const parts = chunk.split('\n').map(s => s.trim()).filter(Boolean);
      stderrLines.push(...parts);
    });

    // Send a couple of JSON-RPC requests
    const req1 = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n';
    const req2 = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n';
    proc.stdin.write(req1);
    proc.stdin.write(req2);

    // Wait up to 2 seconds for responses
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Close stdin to allow graceful shutdown
    try { proc.stdin.end(); } catch (_) {}
    // Kill process just in case
    try { proc.kill(); } catch (_) {}

    // There should be at least two JSON-RPC lines on stdout
    expect(stdoutLines.length).toBeGreaterThanOrEqual(2);

    // All stdout lines must be valid JSON-RPC responses
    for (const line of stdoutLines) {
      expect(isJsonRpcLine(line)).toBe(true);
    }

    // Stderr may contain warnings, but stdout must NOT contain any non-JSON
    const nonJsonStdout = stdoutLines.filter(l => !isJsonRpcLine(l));
    expect(nonJsonStdout.length).toBe(0);
  });
});

