const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP complete navigation workflow on real course', () => {
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

  test('test all navigation methods: next, previous, choice', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Initialize SN
    const snInit = await rpc('tools/call', { name: 'scorm_sn_init', arguments: { session_id } }, id++);
    const snInitData = parseMcpResponse(snInit);
    expect(snInitData.success).toBe(true);

    // Get initial state
    console.log('[TEST] Getting initial navigation state...');
    const state1 = await rpc('tools/call', { name: 'scorm_nav_get_state', arguments: { session_id } }, id++);
    console.log('[TEST] State1 response:', JSON.stringify(state1, null, 2));
    const state1Data = parseMcpResponse(state1);
    console.log('[TEST] Parsed state1 data:', JSON.stringify(state1Data, null, 2));
    if (!state1Data || !state1Data.currentActivity) {
      console.error('[TEST] ERROR: state1Data is missing or has no currentActivity property!');
      console.error('[TEST] Full response:', JSON.stringify(state1, null, 2));
    }
    expect(state1Data.sn_available).toBe(true);
    expect(state1Data.currentActivity).toBeDefined();

    // Test next navigation
    const navNext = await rpc('tools/call', { name: 'scorm_nav_next', arguments: { session_id } }, id++);
    const navNextData = parseMcpResponse(navNext);
    // May or may not be applicable depending on course structure
    expect(navNextData).toBeDefined();
    expect(typeof navNextData.applicable).toBe('boolean');

    // Get state after next
    const state2 = await rpc('tools/call', { name: 'scorm_nav_get_state', arguments: { session_id } }, id++);
    const state2Data = parseMcpResponse(state2);
    expect(state2Data.sn_available).toBe(true);

    // Test previous navigation
    const navPrev = await rpc('tools/call', { name: 'scorm_nav_previous', arguments: { session_id } }, id++);
    const navPrevData = parseMcpResponse(navPrev);
    expect(navPrevData).toBeDefined();
    expect(typeof navPrevData.applicable).toBe('boolean');

    // Get state after previous
    const state3 = await rpc('tools/call', { name: 'scorm_nav_get_state', arguments: { session_id } }, id++);
    const state3Data = parseMcpResponse(state3);
    expect(state3Data.sn_available).toBe(true);

    // Test choice navigation (if we have a target ID)
    if (state3Data.availableActivities && state3Data.availableActivities.length > 0) {
      const targetId = state3Data.availableActivities[0];
      const navChoice = await rpc('tools/call', { 
        name: 'scorm_nav_choice', 
        arguments: { session_id, targetId } 
      }, id++);
      const navChoiceData = parseMcpResponse(navChoice);
      expect(navChoiceData).toBeDefined();
      expect(typeof navChoiceData.applicable).toBe('boolean');
    }

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('test SN reset functionality', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Initialize SN
    const snInit = await rpc('tools/call', { name: 'scorm_sn_init', arguments: { session_id } }, id++);
    const snInitData = parseMcpResponse(snInit);
    expect(snInitData.success).toBe(true);

    // Navigate to change state
    await rpc('tools/call', { name: 'scorm_nav_next', arguments: { session_id } }, id++);

    // Get state before reset
    const stateBefore = await rpc('tools/call', { name: 'scorm_nav_get_state', arguments: { session_id } }, id++);
    const stateBeforeData = parseMcpResponse(stateBefore);
    expect(stateBeforeData.sn_available).toBe(true);

    // Reset SN
    const snReset = await rpc('tools/call', { name: 'scorm_sn_reset', arguments: { session_id } }, id++);
    const snResetData = parseMcpResponse(snReset);
    expect(snResetData.success).toBe(true);

    // Get state after reset
    console.log('[TEST] Getting navigation state after reset...');
    const stateAfter = await rpc('tools/call', { name: 'scorm_nav_get_state', arguments: { session_id } }, id++);
    console.log('[TEST] StateAfter response:', JSON.stringify(stateAfter, null, 2));
    const stateAfterData = parseMcpResponse(stateAfter);
    console.log('[TEST] Parsed stateAfter data:', JSON.stringify(stateAfterData, null, 2));
    if (!stateAfterData || !stateAfterData.currentActivity) {
      console.error('[TEST] ERROR: stateAfterData is missing or has no currentActivity property!');
      console.error('[TEST] Full response:', JSON.stringify(stateAfter, null, 2));
    }
    expect(stateAfterData.sn_available).toBe(true);
    // After reset, should be back to initial state
    expect(stateAfterData.currentActivity).toBeDefined();

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });
});

