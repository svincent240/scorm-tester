const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP new tools (screenshot compression, bulk state, click by text, slide navigation)', () => {
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

  test('scorm_capture_screenshot returns only artifact_path by default (no base64 bloat)', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Capture screenshot without explicit return_base64 flag
    const screenshot = await rpc('tools/call', {
      name: 'scorm_capture_screenshot',
      arguments: { session_id }
    }, id++);
    const screenshotData = parseMcpResponse(screenshot);

    // Should have artifact_path
    expect(screenshotData.artifact_path).toBeDefined();
    expect(typeof screenshotData.artifact_path).toBe('string');
    
    // Should NOT have screenshot_data (to avoid token bloat)
    expect(screenshotData.screenshot_data).toBeUndefined();

    // Verify artifact file exists and is JPEG (compressed)
    expect(fs.existsSync(screenshotData.artifact_path)).toBe(true);
    expect(screenshotData.artifact_path).toMatch(/\.jpg$/);

    // Verify file size is reasonable (JPEG should be much smaller than PNG)
    const stats = fs.statSync(screenshotData.artifact_path);
    expect(stats.size).toBeGreaterThan(0);
    expect(stats.size).toBeLessThan(500000); // Should be < 500KB with compression

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_capture_screenshot returns base64 when explicitly requested', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Capture screenshot WITH return_base64 flag
    const screenshot = await rpc('tools/call', {
      name: 'scorm_capture_screenshot',
      arguments: { session_id, return_base64: true }
    }, id++);
    const screenshotData = parseMcpResponse(screenshot);

    // Should have both artifact_path AND screenshot_data
    expect(screenshotData.artifact_path).toBeDefined();
    expect(screenshotData.screenshot_data).toBeDefined();
    expect(typeof screenshotData.screenshot_data).toBe('string');
    expect(screenshotData.screenshot_data.length).toBeGreaterThan(0);

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_get_page_state returns comprehensive state in single call', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_attempt_initialize', arguments: { session_id } }, id++);

    // Get comprehensive page state
    const pageState = await rpc('tools/call', {
      name: 'scorm_get_page_state',
      arguments: { 
        session_id,
        include: {
          page_context: true,
          interactive_elements: true,
          data_model: true,
          console_errors: true,
          network_requests: true
        }
      }
    }, id++);
    const stateData = parseMcpResponse(pageState);

    console.log('[TEST] Page state response:', JSON.stringify(pageState, null, 2));
    console.log('[TEST] Parsed stateData:', JSON.stringify(stateData, null, 2));

    // Verify all components are present
    expect(stateData).toBeDefined();
    expect(stateData.page_context).toBeDefined();
    expect(stateData.interactive_elements).toBeDefined();
    expect(stateData.data_model).toBeDefined();
    expect(stateData.console_errors).toBeDefined();
    expect(stateData.network_requests).toBeDefined();
    expect(stateData.timestamp).toBeDefined();

    // Verify page_context structure
    expect(stateData.page_context.url).toBeDefined();
    expect(stateData.page_context.page_type).toBeDefined();

    // Verify interactive_elements structure
    expect(stateData.interactive_elements.session_id).toBe(session_id);
    expect(Array.isArray(stateData.interactive_elements.buttons)).toBe(true);

    // Verify data_model structure
    expect(stateData.data_model.session_id).toBe(session_id);
    expect(stateData.data_model.elements).toBeDefined();

    // Verify console_errors structure
    expect(stateData.console_errors.session_id).toBe(session_id);
    expect(Array.isArray(stateData.console_errors.errors)).toBe(true);

    // Verify network_requests structure
    expect(stateData.network_requests.session_id).toBe(session_id);
    expect(Array.isArray(stateData.network_requests.requests)).toBe(true);

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_get_page_state with selective includes', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Get only page_context and console_errors
    const pageState = await rpc('tools/call', {
      name: 'scorm_get_page_state',
      arguments: { 
        session_id,
        include: {
          page_context: true,
          interactive_elements: false,
          data_model: false,
          console_errors: true,
          network_requests: false
        }
      }
    }, id++);
    const stateData = parseMcpResponse(pageState);

    // Should have requested components
    expect(stateData.page_context).toBeDefined();
    expect(stateData.console_errors).toBeDefined();

    // Should NOT have unrequested components (null)
    expect(stateData.interactive_elements).toBeNull();
    expect(stateData.data_model).toBeNull();
    expect(stateData.network_requests).toBeNull();

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
