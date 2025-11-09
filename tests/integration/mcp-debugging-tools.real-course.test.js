const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP debugging and diagnostic tools on real course', () => {
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

  test('console errors, network requests, and page context', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Get console errors
    const consoleErrors = await rpc('tools/call', {
      name: 'scorm_get_console_errors',
      arguments: { session_id, severity: ['error', 'warn'] }
    }, id++);
    const consoleData = parseMcpResponse(consoleErrors);
    console.log('[TEST] Console errors response:', JSON.stringify(consoleErrors, null, 2));
    console.log('[TEST] Parsed consoleData:', JSON.stringify(consoleData, null, 2));
    console.log('[TEST] consoleData keys:', consoleData ? Object.keys(consoleData) : 'undefined');
    expect(consoleData.session_id).toBe(session_id);
    expect(consoleData.error_count).toBeDefined();
    expect(Array.isArray(consoleData.errors)).toBe(true);
    expect(consoleData.categories).toBeDefined();

    // Get network requests
    const networkReqs = await rpc('tools/call', { 
      name: 'scorm_get_network_requests', 
      arguments: { session_id, options: { max_count: 50 } } 
    }, id++);
    const networkData = parseMcpResponse(networkReqs);
    expect(networkData.session_id).toBe(session_id);
    expect(networkData.request_count).toBeDefined();
    expect(Array.isArray(networkData.requests)).toBe(true);

    // Get current page context
    const pageContext = await rpc('tools/call', {
      name: 'scorm_get_current_page_context',
      arguments: { session_id }
    }, id++);
    const contextData = parseMcpResponse(pageContext);
    expect(contextData).toBeDefined();
    expect(contextData.page_type).toBeDefined();
    expect(contextData.url).toBeDefined();
    expect(contextData.navigation_available).toBeDefined();

    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('wait for API call and replay API calls', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Start waiting for Initialize call (in background)
    const waitPromise = rpc('tools/call', {
      name: 'scorm_wait_for_api_call',
      arguments: { session_id, method: 'Initialize', timeout_ms: 5000 }
    }, id++);

    // Trigger Initialize
    await rpc('tools/call', { name: 'scorm_api_call', arguments: { session_id, method: 'Initialize', args: [''] } }, id++);

    // Wait should complete
    const waitResult = await waitPromise;
    const waitData = parseMcpResponse(waitResult);
    console.log('[TEST] Wait result response:', JSON.stringify(waitResult, null, 2));
    console.log('[TEST] Parsed waitData:', JSON.stringify(waitData, null, 2));
    console.log('[TEST] waitData keys:', waitData ? Object.keys(waitData) : 'undefined');
    expect(waitData.found).toBe(true);
    expect(waitData.call).toBeDefined();
    expect(waitData.call.method).toBe('Initialize');

    // Test replay API calls
    const replay = await rpc('tools/call', { 
      name: 'scorm_replay_api_calls', 
      arguments: { 
        session_id,
        calls: [
          { method: 'SetValue', args: ['cmi.location', 'replay_test'] },
          { method: 'GetValue', args: ['cmi.location'] },
          { method: 'Commit', args: [''] }
        ]
      } 
    }, id++);
    const replayData = parseMcpResponse(replay);
    expect(replayData.success).toBe(true);
    expect(replayData.total_calls).toBe(3);
    expect(replayData.executed_calls).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(replayData.results)).toBe(true);

    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('compare data model snapshots', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Get initial snapshot
    const snapshot1 = await rpc('tools/call', { 
      name: 'scorm_data_model_get', 
      arguments: { session_id, elements: ['cmi.location', 'cmi.completion_status'] } 
    }, id++);
    const snapshot1Data = parseMcpResponse(snapshot1);

    // Make changes
    await rpc('tools/call', { 
      name: 'scorm_api_call', 
      arguments: { session_id, method: 'SetValue', args: ['cmi.location', 'changed'] } 
    }, id++);

    // Get second snapshot
    const snapshot2 = await rpc('tools/call', { 
      name: 'scorm_data_model_get', 
      arguments: { session_id, elements: ['cmi.location', 'cmi.completion_status'] } 
    }, id++);
    const snapshot2Data = parseMcpResponse(snapshot2);

    // Compare snapshots
    const compare = await rpc('tools/call', { 
      name: 'scorm_compare_data_model_snapshots', 
      arguments: { 
        before: snapshot1Data.data,
        after: snapshot2Data.data
      } 
    }, id++);
    const compareData = parseMcpResponse(compare);
    expect(compareData.summary).toBeDefined();
    expect(compareData.summary.total_elements).toBeGreaterThan(0);
    expect(compareData.changed).toBeDefined();
    expect(Array.isArray(compareData.changed)).toBe(true);

    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('system_set_log_level', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    // Set log level to debug
    const setLevel = await rpc('tools/call', { 
      name: 'system_set_log_level', 
      arguments: { level: 'debug' } 
    }, id++);
    const setLevelData = parseMcpResponse(setLevel);
    expect(setLevelData.success).toBe(true);
    expect(setLevelData.level).toBe('debug');

    // Set back to info
    const setLevel2 = await rpc('tools/call', { 
      name: 'system_set_log_level', 
      arguments: { level: 'info' } 
    }, id++);
    const setLevel2Data = parseMcpResponse(setLevel2);
    expect(setLevel2Data.success).toBe(true);
    expect(setLevel2Data.level).toBe('info');

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });
});

