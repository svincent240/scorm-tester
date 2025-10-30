const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP SN navigation flow on real course', () => {
  jest.setTimeout(90000);

  function rpcClient() {
    const proc = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '-s', 'mcp'], {
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
        } catch (_) {}
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

  test('init → nav_get_state → next → nav_get_state → screenshot', async () => {
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

    const navState1 = await rpc('tools/call', { name: 'scorm_nav_get_state', arguments: { session_id } }, id++);
    const navData1 = parseMcpResponse(navState1);
    expect(navData1 && typeof navData1.sessionState === 'string').toBe(true);

    // If 'continue' is available, perform nav_next and expect success
    if (navData1 && navData1.availableNavigation && navData1.availableNavigation.continue) {
      const navNext = await rpc('tools/call', { name: 'scorm_nav_next', arguments: { session_id } }, id++);
      const navNextData = parseMcpResponse(navNext);
      expect(navNextData && navNextData.success).toBe(true);
    }

    const navState2 = await rpc('tools/call', { name: 'scorm_nav_get_state', arguments: { session_id } }, id++);
    const navData2 = parseMcpResponse(navState2);
    expect(navData2 && typeof navData2.sessionState === 'string').toBe(true);

    const shot = await rpc('tools/call', { name: 'scorm_capture_screenshot', arguments: { session_id, capture_options: { delay_ms: 100 } } }, id++);
    const shotData = parseMcpResponse(shot);
    expect(shotData && (shotData.artifact_path || shotData.screenshot_data)).toBeTruthy();

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });
});

