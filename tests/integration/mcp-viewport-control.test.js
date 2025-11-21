/**
 * MCP Viewport Control Tests
 * 
 * Tests the scorm_set_viewport_size MCP tool
 */

const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP Viewport Control', () => {
  jest.setTimeout(30000);

  function rpcClient() {
    const proc = spawn('node', [path.join(__dirname, '../../src/mcp/node-bridge.js')], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: 'false' }
    });

    let buf = '';
    const pending = new Map();

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const id = obj && obj.id;
          if (pending.has(id)) {
            pending.get(id)(obj);
            pending.delete(id);
          }
        } catch (_) {
          // ignore non-JSON
        }
      }
    });

    function rpc(method, params, id) {
      return new Promise((resolve) => {
        pending.set(id, resolve);
        const msg = { jsonrpc: '2.0', id, method, params };
        proc.stdin.write(JSON.stringify(msg) + '\n');
      });
    }

    return { proc, rpc };
  }

  test('scorm_set_viewport_size should set desktop size', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    await rpc('initialize', {}, id++);

    const result = await rpc('tools/call', {
      name: 'scorm_set_viewport_size',
      arguments: { width: 1366, height: 768 }
    }, id++);

    const data = parseMcpResponse(result);
    expect(data.success).toBe(true);
    expect(data.size.width).toBe(1366);
    expect(data.size.height).toBe(768);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
  });

  test('scorm_set_viewport_size should set mobile size', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    await rpc('initialize', {}, id++);

    const result = await rpc('tools/call', {
      name: 'scorm_set_viewport_size',
      arguments: { width: 390, height: 844 }
    }, id++);

    const data = parseMcpResponse(result);
    expect(data.success).toBe(true);
    expect(data.size.width).toBe(390);
    expect(data.size.height).toBe(844);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
  });

  test('scorm_set_viewport_size should set tablet size', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    await rpc('initialize', {}, id++);

    const result = await rpc('tools/call', {
      name: 'scorm_set_viewport_size',
      arguments: { width: 1024, height: 1366 }
    }, id++);

    const data = parseMcpResponse(result);
    expect(data.success).toBe(true);
    expect(data.size.width).toBe(1024);
    expect(data.size.height).toBe(1366);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
  });

  test('scorm_set_viewport_size should reject too small viewport', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    await rpc('initialize', {}, id++);

    const result = await rpc('tools/call', {
      name: 'scorm_set_viewport_size',
      arguments: { width: 100, height: 100 }
    }, id++);

    expect(result.result.isError).toBe(true);
    const errorText = result.result.content[0].text;
    expect(errorText).toMatch(/Minimum viewport size/);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
  });

  test('scorm_set_viewport_size should reject too large viewport', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    await rpc('initialize', {}, id++);

    const result = await rpc('tools/call', {
      name: 'scorm_set_viewport_size',
      arguments: { width: 10000, height: 10000 }
    }, id++);

    expect(result.result.isError).toBe(true);
    const errorText = result.result.content[0].text;
    expect(errorText).toMatch(/Maximum viewport size/);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
  });

  test('scorm_set_viewport_size should require width parameter', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    await rpc('initialize', {}, id++);

    const result = await rpc('tools/call', {
      name: 'scorm_set_viewport_size',
      arguments: { height: 768 }
    }, id++);

    expect(result.result.isError).toBe(true);
    const errorText = result.result.content[0].text;
    expect(errorText).toMatch(/width.*required/i);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
  });

  test('scorm_set_viewport_size should require height parameter', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    await rpc('initialize', {}, id++);

    const result = await rpc('tools/call', {
      name: 'scorm_set_viewport_size',
      arguments: { width: 1366 }
    }, id++);

    expect(result.result.isError).toBe(true);
    const errorText = result.result.content[0].text;
    expect(errorText).toMatch(/height.*required/i);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
  });

  test('scorm_set_viewport_size should accept custom sizes within bounds', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    await rpc('initialize', {}, id++);

    const testCases = [
      { width: 320, height: 240 }, // minimum
      { width: 800, height: 600 }, // custom
      { width: 1920, height: 1080 }, // full HD
      { width: 2560, height: 1440 }, // QHD
      { width: 7680, height: 4320 } // 8K maximum
    ];

    for (const size of testCases) {
      const result = await rpc('tools/call', {
        name: 'scorm_set_viewport_size',
        arguments: size
      }, id++);

      const data = parseMcpResponse(result);
      expect(data.success).toBe(true);
      expect(data.size.width).toBe(size.width);
      expect(data.size.height).toBe(size.height);
    }

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
  });

  test('scorm_set_viewport_size tool should be listed in available tools', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    await rpc('initialize', {}, id++);

    const result = await rpc('tools/list', {}, id++);

    expect(result.result).toBeDefined();
    expect(result.result.tools).toBeDefined();
    const viewportTool = result.result.tools.find(t => t.name === 'scorm_set_viewport_size');
    expect(viewportTool).toBeDefined();
    expect(viewportTool.description).toContain('viewport');
    expect(viewportTool.inputSchema).toBeDefined();
    expect(viewportTool.inputSchema.required).toContain('width');
    expect(viewportTool.inputSchema.required).toContain('height');

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
  });
});
