const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP SN init flow on real course (sequencing bridge)', () => {
  jest.setTimeout(90000);

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

  test('opens session, runtime, initializes SN and fetches state', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    expect(openData && openData.session_id).toBeTruthy();
    const session_id = openData.session_id;

    const runtimeOpen = await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);
    const runtimeData = parseMcpResponse(runtimeOpen);
    expect(runtimeData && runtimeData.runtime_id === session_id).toBe(true);

    const snInit = await rpc('tools/call', { name: 'scorm_sn_init', arguments: { session_id } }, id++);
    const snData = parseMcpResponse(snInit);
    expect(snData && snData.success).toBe(true);

    const navState = await rpc('tools/call', { name: 'scorm_nav_get_state', arguments: { session_id } }, id++);
    const navData = parseMcpResponse(navState);
    expect(navData && typeof navData.sessionState === 'string').toBe(true);

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    // Wait for MCP process to exit to avoid open handle warnings
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });
});

