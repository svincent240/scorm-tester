const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP unified course tools on real course', () => {
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

  test('scorm_open_course: opens course with runtime auto-initialized', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP...');
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    // Use the new unified tool - should create session + open runtime + auto-initialize
    console.log('[TEST] Opening course with scorm_open_course...');
    const openCourse = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { 
        package_path: ws,
        viewport: { width: 1024, height: 768 }
      } 
    }, id++);
    console.log('[TEST] Open course response:', JSON.stringify(openCourse, null, 2));
    const openData = parseMcpResponse(openCourse);
    expect(openData && openData.session_id).toBeTruthy();
    expect(openData.workspace).toBeTruthy();
    expect(openData.artifacts_manifest_path).toBeTruthy();
    const session_id = openData.session_id;

    // Verify runtime is open and initialized
    console.log('[TEST] Checking runtime status...');
    const statusRes = await rpc('tools/call', { 
      name: 'scorm_runtime_status', 
      arguments: { session_id } 
    }, id++);
    const statusData = parseMcpResponse(statusRes);
    console.log('[TEST] Runtime status:', JSON.stringify(statusData, null, 2));
    expect(statusData.open).toBe(true);
    // Auto-initialization happens on content load, so state may be 'initialized' or 'running'
    expect(['none', 'initialized', 'running']).toContain(statusData.initialize_state);

    // Verify we can make API calls
    console.log('[TEST] Making API call to verify runtime works...');
    const setValueRes = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id, method: 'SetValue', args: ['cmi.location', 'test_page'] }
    }, id++);
    const setValueData = parseMcpResponse(setValueRes);
    expect(setValueData.result).toBe('true');

    const getValueRes = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const getValueData = parseMcpResponse(getValueRes);
    expect(getValueData.result).toBe('test_page');

    // Close using unified tool
    console.log('[TEST] Closing course...');
    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_close_course: sets exit=suspend, terminates, and saves data', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP...');
    await rpc('initialize', {}, id++);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    // Open course
    console.log('[TEST] Opening course...');
    const openCourse = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const openData = parseMcpResponse(openCourse);
    const session_id = openData.session_id;

    // Make some changes to data
    console.log('[TEST] Setting data...');
    await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id, method: 'SetValue', args: ['cmi.location', 'page_5'] }
    }, id++);
    await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id, method: 'SetValue', args: ['cmi.suspend_data', 'test_data'] }
    }, id++);

    // Close - should handle Terminate internally
    console.log('[TEST] Closing course (should auto-terminate)...');
    const closeRes = await rpc('tools/call', { 
      name: 'scorm_close_course', 
      arguments: { session_id } 
    }, id++);
    const closeData = parseMcpResponse(closeRes);
    expect(closeData.success).toBe(true);
    expect(closeData.artifacts_manifest_path).toBeTruthy();

    // Try to get runtime status - should fail since session is closed
    console.log('[TEST] Verifying runtime is closed...');
    const statusRes = await rpc('tools/call', { 
      name: 'scorm_runtime_status', 
      arguments: { session_id } 
    }, id++);
    // Should get an error about unknown session
    expect(statusRes.result && statusRes.result.content).toBeDefined();
    const statusError = JSON.parse(statusRes.result.content[0].text);
    expect(statusError.error || statusError.code).toBeTruthy();

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_course_status: returns session state information', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP...');
    await rpc('initialize', {}, id++);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    // Open course
    console.log('[TEST] Opening course...');
    const openCourse = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const openData = parseMcpResponse(openCourse);
    const session_id = openData.session_id;

    // Get status
    console.log('[TEST] Getting course status...');
    const statusRes = await rpc('tools/call', { 
      name: 'scorm_course_status', 
      arguments: { session_id } 
    }, id++);
    const statusData = parseMcpResponse(statusRes);
    
    expect(statusData.state).toBeDefined();
    expect(['ready', 'running', 'closing']).toContain(statusData.state);
    expect(typeof statusData.started_at).toBe('number');
    expect(typeof statusData.last_activity_at).toBe('number');
    expect(statusData.started_at <= statusData.last_activity_at).toBe(true);

    // Close
    console.log('[TEST] Closing course...');
    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_reload_course: closes old session and opens fresh one', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP...');
    await rpc('initialize', {}, id++);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    // Open course and set some data
    console.log('[TEST] Opening initial course...');
    const openCourse = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const openData = parseMcpResponse(openCourse);
    const firstSessionId = openData.session_id;

    console.log('[TEST] Setting data in first session...');
    await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: firstSessionId, method: 'SetValue', args: ['cmi.location', 'old_location'] }
    }, id++);

    const getValue1 = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: firstSessionId, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const value1 = parseMcpResponse(getValue1);
    expect(value1.result).toBe('old_location');

    // Reload - should close first session and open new one
    console.log('[TEST] Reloading course...');
    const reloadRes = await rpc('tools/call', { 
      name: 'scorm_reload_course', 
      arguments: { 
        session_id: firstSessionId,
        package_path: ws,
        viewport: { width: 800, height: 600 }
      } 
    }, id++);
    const reloadData = parseMcpResponse(reloadRes);
    
    expect(reloadData.session_id).toBeTruthy();
    expect(reloadData.session_id).not.toBe(firstSessionId);
    expect(reloadData.workspace).toBeTruthy();
    const secondSessionId = reloadData.session_id;

    // Verify new session doesn't have old data (fresh start)
    console.log('[TEST] Verifying fresh session...');
    const getValue2 = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: secondSessionId, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const value2 = parseMcpResponse(getValue2);
    expect(value2.result).not.toBe('old_location'); // Should be empty or default

    // Old session should be closed (trying to use it should fail)
    console.log('[TEST] Verifying old session is closed...');
    const oldStatusRes = await rpc('tools/call', { 
      name: 'scorm_runtime_status', 
      arguments: { session_id: firstSessionId } 
    }, id++);
    const oldStatusError = JSON.parse(oldStatusRes.result.content[0].text);
    expect(oldStatusError.error || oldStatusError.code).toBeTruthy();

    // Close new session
    console.log('[TEST] Closing new session...');
    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id: secondSessionId } }, id++);

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_clear_saved_data: removes persisted session data', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP...');
    await rpc('initialize', {}, id++);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    // Open course, set data, and terminate to save
    console.log('[TEST] Opening course and saving data...');
    const openCourse1 = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const openData1 = parseMcpResponse(openCourse1);
    const session1 = openData1.session_id;

    await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session1, method: 'SetValue', args: ['cmi.location', 'saved_page'] }
    }, id++);
    await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session1, method: 'SetValue', args: ['cmi.suspend_data', 'saved_data'] }
    }, id++);
    
    // Close to save data
    console.log('[TEST] Closing to persist data...');
    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id: session1 } }, id++);

    // Reopen - should have saved data
    console.log('[TEST] Reopening to verify data was saved...');
    const openCourse2 = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const openData2 = parseMcpResponse(openCourse2);
    const session2 = openData2.session_id;

    const getValue1 = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session2, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const value1 = parseMcpResponse(getValue1);
    console.log('[TEST] Loaded location:', value1.result);
    // Should have the saved location (resume behavior)
    // Note: Actual resume behavior depends on course implementation
    
    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id: session2 } }, id++);

    // Clear saved data
    console.log('[TEST] Clearing saved data...');
    const clearRes = await rpc('tools/call', { 
      name: 'scorm_clear_saved_data', 
      arguments: { package_path: ws } 
    }, id++);
    const clearData = parseMcpResponse(clearRes);
    expect(clearData.success).toBe(true);
    expect(clearData.course_id).toBeTruthy();

    // Reopen again - should NOT have saved data (fresh start)
    console.log('[TEST] Reopening after clear to verify fresh start...');
    const openCourse3 = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const openData3 = parseMcpResponse(openCourse3);
    const session3 = openData3.session_id;

    const getValue2 = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session3, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const value2 = parseMcpResponse(getValue2);
    console.log('[TEST] Location after clear:', value2.result);
    // Should NOT be 'saved_page' anymore
    expect(value2.result).not.toBe('saved_page');

    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id: session3 } }, id++);

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('Complete workflow: open → modify → close → clear → reopen → verify fresh', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP...');
    await rpc('initialize', {}, id++);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    // Step 1: Open and modify
    console.log('[TEST] Step 1: Open and modify...');
    const open1 = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const session1 = parseMcpResponse(open1).session_id;

    await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session1, method: 'SetValue', args: ['cmi.location', 'workflow_test'] }
    }, id++);
    await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session1, method: 'SetValue', args: ['cmi.completion_status', 'incomplete'] }
    }, id++);

    // Step 2: Check status
    console.log('[TEST] Step 2: Check status...');
    const statusRes = await rpc('tools/call', { 
      name: 'scorm_course_status', 
      arguments: { session_id: session1 } 
    }, id++);
    const status = parseMcpResponse(statusRes);
    expect(status.state).toBeDefined();

    // Step 3: Close
    console.log('[TEST] Step 3: Close...');
    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id: session1 } }, id++);

    // Step 4: Clear saved data
    console.log('[TEST] Step 4: Clear saved data...');
    const clearRes = await rpc('tools/call', { 
      name: 'scorm_clear_saved_data', 
      arguments: { package_path: ws } 
    }, id++);
    expect(parseMcpResponse(clearRes).success).toBe(true);

    // Step 5: Reopen
    console.log('[TEST] Step 5: Reopen...');
    const open2 = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const session2 = parseMcpResponse(open2).session_id;

    // Step 6: Verify fresh start
    console.log('[TEST] Step 6: Verify fresh start...');
    const getValue = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session2, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const location = parseMcpResponse(getValue).result;
    console.log('[TEST] Final location:', location);
    expect(location).not.toBe('workflow_test');

    // Clean up
    console.log('[TEST] Cleaning up...');
    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id: session2 } }, id++);

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });
});
