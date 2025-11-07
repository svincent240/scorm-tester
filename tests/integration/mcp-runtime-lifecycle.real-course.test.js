const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP runtime lifecycle on real course', () => {
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

  test('full runtime lifecycle: open → initialize → API calls → data model → terminate → close', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    // Initialize MCP
    console.log('[TEST] Initializing MCP...');
    const initRes = await rpc('initialize', {}, id++);
    console.log('[TEST] Initialize response:', JSON.stringify(initRes, null, 2));
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    // Open session
    console.log('[TEST] Opening session with workspace:', ws);
    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    console.log('[TEST] Open session response:', JSON.stringify(openSession, null, 2));
    const openData = parseMcpResponse(openSession);
    console.log('[TEST] Parsed open session data:', JSON.stringify(openData, null, 2));
    expect(openData && openData.session_id).toBeTruthy();
    const session_id = openData.session_id;
    console.log('[TEST] Session ID:', session_id);

    // Open runtime
    console.log('[TEST] Opening runtime...');
    const openRuntime = await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);
    console.log('[TEST] Open runtime response:', JSON.stringify(openRuntime, null, 2));
    const runtimeData = parseMcpResponse(openRuntime);
    console.log('[TEST] Parsed runtime data:', JSON.stringify(runtimeData, null, 2));
    expect(runtimeData && runtimeData.runtime_id).toBeTruthy();
    expect(runtimeData.entry_found).toBe(true);

    // Check runtime status (should be open, not initialized)
    console.log('[TEST] Checking runtime status before initialize...');
    const statusBefore = await rpc('tools/call', { name: 'scorm_runtime_status', arguments: { session_id } }, id++);
    console.log('[TEST] Status before response:', JSON.stringify(statusBefore, null, 2));
    const statusBeforeData = parseMcpResponse(statusBefore);
    console.log('[TEST] Parsed status before:', JSON.stringify(statusBeforeData, null, 2));
    expect(statusBeforeData.open).toBe(true);
    expect(statusBeforeData.initialize_state).toBe('none');

    // Initialize SCORM attempt
    console.log('[TEST] Initializing SCORM attempt...');
    console.log('[TEST] Initialize attempt response:', JSON.stringify(initAttempt, null, 2));
    const initAttemptData = parseMcpResponse(initAttempt);
    console.log('[TEST] Parsed init attempt data:', JSON.stringify(initAttemptData, null, 2));
    expect(initAttemptData.result).toBe('true');

    // Check runtime status (should be initialized)
    console.log('[TEST] Checking runtime status after initialize...');
    const statusAfterInit = await rpc('tools/call', { name: 'scorm_runtime_status', arguments: { session_id } }, id++);
    console.log('[TEST] Status after init response:', JSON.stringify(statusAfterInit, null, 2));
    const statusAfterInitData = parseMcpResponse(statusAfterInit);
    console.log('[TEST] Parsed status after init:', JSON.stringify(statusAfterInitData, null, 2));
    expect(statusAfterInitData.open).toBe(true);
    expect(statusAfterInitData.initialize_state).toBe('initialized');
    expect(statusAfterInitData.last_api_method).toBe('Initialize');

    // Make API calls using scorm_api_call
    console.log('[TEST] Setting cmi.location to page_1...');
    const setValue = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id, method: 'SetValue', args: ['cmi.location', 'page_1'] }
    }, id++);
    console.log('[TEST] SetValue response:', JSON.stringify(setValue, null, 2));
    const setValueData = parseMcpResponse(setValue);
    console.log('[TEST] Parsed SetValue data:', JSON.stringify(setValueData, null, 2));
    expect(setValueData.result).toBe('true');

    console.log('[TEST] Getting cmi.location...');
    const getValue = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    console.log('[TEST] GetValue response:', JSON.stringify(getValue, null, 2));
    const getValueData = parseMcpResponse(getValue);
    console.log('[TEST] Parsed GetValue data:', JSON.stringify(getValueData, null, 2));
    expect(getValueData.result).toBe('page_1');

    // Get data model using scorm_data_model_get
    console.log('[TEST] Getting data model with scorm_data_model_get...');
    const dataModel = await rpc('tools/call', {
      name: 'scorm_data_model_get',
      arguments: {
        session_id,
        elements: ['cmi.location', 'cmi.completion_status', 'cmi.success_status'],
        include_metadata: true
      }
    }, id++);
    console.log('[TEST] Data model response:', JSON.stringify(dataModel, null, 2));
    const dataModelData = parseMcpResponse(dataModel);
    console.log('[TEST] Parsed data model data:', JSON.stringify(dataModelData, null, 2));
    if (!dataModelData || !dataModelData.data) {
      console.error('[TEST] ERROR: dataModelData is missing or has no data property!');
      console.error('[TEST] Full dataModel response:', JSON.stringify(dataModel, null, 2));
    }
    expect(dataModelData.data).toBeDefined();
    expect(dataModelData.data['cmi.location']).toBe('page_1');
    expect(dataModelData.element_count).toBeGreaterThanOrEqual(1);
    expect(dataModelData.metadata).toBeDefined();

    // Terminate SCORM attempt
    console.log('[TEST] Terminating SCORM attempt...');
    const terminate = await rpc('tools/call', { name: 'scorm_api_call', arguments: { session_id, method: 'Terminate', args: [''] } }, id++);
    console.log('[TEST] Terminate response:', JSON.stringify(terminate, null, 2));
    const terminateData = parseMcpResponse(terminate);
    console.log('[TEST] Parsed terminate data:', JSON.stringify(terminateData, null, 2));
    expect(terminateData.result).toBe('true');

    // Check runtime status (should be terminated)
    console.log('[TEST] Checking runtime status after terminate...');
    const statusAfterTerminate = await rpc('tools/call', { name: 'scorm_runtime_status', arguments: { session_id } }, id++);
    console.log('[TEST] Status after terminate response:', JSON.stringify(statusAfterTerminate, null, 2));
    const statusAfterTerminateData = parseMcpResponse(statusAfterTerminate);
    console.log('[TEST] Parsed status after terminate:', JSON.stringify(statusAfterTerminateData, null, 2));
    expect(statusAfterTerminateData.open).toBe(true);
    expect(statusAfterTerminateData.initialize_state).toBe('terminated');
    expect(statusAfterTerminateData.last_api_method).toBe('Terminate');

    // Close runtime
    console.log('[TEST] Closing runtime...');
    console.log('[TEST] Close runtime response:', JSON.stringify(closeRuntime, null, 2));
    const closeRuntimeData = parseMcpResponse(closeRuntime);
    console.log('[TEST] Parsed close runtime data:', JSON.stringify(closeRuntimeData, null, 2));
    expect(closeRuntimeData.success).toBe(true);

    // Check runtime status (should be closed)
    console.log('[TEST] Checking runtime status after close...');
    const statusAfterClose = await rpc('tools/call', { name: 'scorm_runtime_status', arguments: { session_id } }, id++);
    console.log('[TEST] Status after close response:', JSON.stringify(statusAfterClose, null, 2));
    const statusAfterCloseData = parseMcpResponse(statusAfterClose);
    console.log('[TEST] Parsed status after close:', JSON.stringify(statusAfterCloseData, null, 2));
    expect(statusAfterCloseData.open).toBe(false);

    // Close session
    console.log('[TEST] Closing session...');
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);
    console.log('[TEST] Session closed successfully');

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_data_model_get with patterns (wildcards)', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP for pattern test...');
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    console.log('[TEST] Opening session for pattern test...');
    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;
    console.log('[TEST] Session ID for pattern test:', session_id);

    console.log('[TEST] Opening runtime for pattern test...');
    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);
    console.log('[TEST] Initializing attempt for pattern test...');

    // Set some interaction data
    console.log('[TEST] Setting interaction data...');
    await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id, method: 'SetValue', args: ['cmi.interactions.0.id', 'q1'] }
    }, id++);
    await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id, method: 'SetValue', args: ['cmi.interactions.0.type', 'choice'] }
    }, id++);

    // Get data model with patterns
    console.log('[TEST] Getting data model with pattern cmi.interactions.*...');
    const dataModel = await rpc('tools/call', {
      name: 'scorm_data_model_get',
      arguments: {
        session_id,
        patterns: ['cmi.interactions.*']
      }
    }, id++);
    console.log('[TEST] Data model pattern response:', JSON.stringify(dataModel, null, 2));
    const dataModelData = parseMcpResponse(dataModel);
    console.log('[TEST] Parsed data model pattern data:', JSON.stringify(dataModelData, null, 2));
    if (!dataModelData || !dataModelData.data) {
      console.error('[TEST] ERROR: Pattern test - dataModelData is missing or has no data property!');
      console.error('[TEST] Full dataModel response:', JSON.stringify(dataModel, null, 2));
    }
    expect(dataModelData.data).toBeDefined();
    expect(dataModelData.element_count).toBeGreaterThan(0);
    // Should have expanded the pattern to include interaction elements
    const keys = Object.keys(dataModelData.data);
    console.log('[TEST] Data model keys:', keys);
    expect(keys.some(k => k.startsWith('cmi.interactions.'))).toBe(true);

    console.log('[TEST] Closing runtime and session for pattern test...');
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });
});

