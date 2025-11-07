const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP assessment workflow on real course', () => {
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

  test('discover interactive elements and fill form batch', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP for interactive elements test...');
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    console.log('[TEST] Opening session for interactive elements test...');
    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;
    console.log('[TEST] Session ID:', session_id);

    console.log('[TEST] Opening runtime...');
    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);
    console.log('[TEST] Initializing attempt...');

    // Discover interactive elements
    console.log('[TEST] Discovering interactive elements...');
    const findElements = await rpc('tools/call', {
      name: 'scorm_dom_find_interactive_elements',
      arguments: { session_id }
    }, id++);
    console.log('[TEST] Find elements response:', JSON.stringify(findElements, null, 2));
    const elementsData = parseMcpResponse(findElements);
    console.log('[TEST] Parsed elements data:', JSON.stringify(elementsData, null, 2));
    if (!elementsData) {
      console.error('[TEST] ERROR: elementsData is null or undefined!');
      console.error('[TEST] Full findElements response:', JSON.stringify(findElements, null, 2));
    }
    expect(elementsData).toBeDefined();
    expect(elementsData.forms).toBeDefined();
    expect(elementsData.buttons).toBeDefined();
    expect(elementsData.inputs).toBeDefined();
    expect(elementsData.interactive_elements).toBeDefined();

    // If there are form inputs, test batch fill
    if (elementsData.inputs && elementsData.inputs.length > 0) {
      const fields = elementsData.inputs.slice(0, 2).map(input => ({
        selector: input.selector,
        value: input.type === 'checkbox' ? true : 'test_value'
      }));

      if (fields.length > 0) {
        const fillBatch = await rpc('tools/call', { 
          name: 'scorm_dom_fill_form_batch', 
          arguments: { session_id, fields } 
        }, id++);
        const fillData = parseMcpResponse(fillBatch);
        expect(fillData.total_fields).toBe(fields.length);
        expect(fillData.successful).toBeGreaterThanOrEqual(0);
      }
    }

    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('assessment interaction trace with DOM actions', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;
    console.log('[TEST] Session opened, ID:', session_id);

    const runtimeOpenRes = await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);
    console.log('[TEST] Runtime open response:', JSON.stringify(runtimeOpenRes, null, 2));
    const runtimeOpenData = parseMcpResponse(runtimeOpenRes);
    console.log('[TEST] Runtime open data:', JSON.stringify(runtimeOpenData, null, 2));

    const attemptInitRes = await rpc('tools/call', { name: 'scorm_api_call', arguments: { session_id, method: 'Initialize', args: [''] } }, id++);
    console.log('[TEST] Initialize response:', JSON.stringify(attemptInitRes, null, 2));

    // Trace assessment interactions with simple actions
    const trace = await rpc('tools/call', { 
      name: 'scorm_assessment_interaction_trace', 
      arguments: { 
        session_id,
        actions: [
          { type: 'wait', ms: 100 }
        ],
        capture_mode: 'standard'
      } 
    }, id++);
    const traceData = parseMcpResponse(trace);
    console.log('[TEST] Trace response:', JSON.stringify(trace, null, 2));
    console.log('[TEST] Parsed traceData:', JSON.stringify(traceData, null, 2));
    console.log('[TEST] traceData keys:', traceData ? Object.keys(traceData) : 'undefined');
    expect(traceData.steps).toBeDefined();
    expect(Array.isArray(traceData.steps)).toBe(true);
    expect(traceData.summary).toBeDefined();
    expect(traceData.summary.total_actions).toBe(1);
    expect(traceData.issues_detected).toBeDefined();

    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('validate data model state and capture screenshot', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_api_call', arguments: { session_id, method: 'Initialize', args: [''] } }, id++);

    // Set some values
    await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id, method: 'SetValue', args: ['cmi.location', 'test_location'] }
    }, id++);

    // Validate data model state
    const validate = await rpc('tools/call', { 
      name: 'scorm_validate_data_model_state', 
      arguments: { 
        session_id,
        expected: {
          'cmi.location': 'test_location'
        }
      } 
    }, id++);
    const validateData = parseMcpResponse(validate);
    console.log('[TEST] Validate response:', JSON.stringify(validate, null, 2));
    console.log('[TEST] Parsed validateData:', JSON.stringify(validateData, null, 2));
    console.log('[TEST] validateData keys:', validateData ? Object.keys(validateData) : 'undefined');
    expect(validateData.valid).toBe(true);
    expect(validateData.matches).toBeGreaterThanOrEqual(1);
    expect(validateData.matched_elements).toContain('cmi.location');

    // Capture screenshot
    const screenshot = await rpc('tools/call', { 
      name: 'scorm_capture_screenshot', 
      arguments: { session_id, capture_options: { delay_ms: 100 } } 
    }, id++);
    const screenshotData = parseMcpResponse(screenshot);
    expect(screenshotData.artifact_path || screenshotData.screenshot_data).toBeTruthy();

    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });
});

