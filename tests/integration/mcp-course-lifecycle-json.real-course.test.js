const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP course lifecycle with JSON persistence verification', () => {
  jest.setTimeout(120000);

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
        
        // Log SessionStore messages for debugging
        if (line.includes('[SessionStore]')) {
          console.log(line);
        }
        
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

  /**
   * Find the saved JSON file for a course
   */
  function findSavedJson(courseId, namespace = 'mcp') {
    const possiblePaths = [
      path.join(os.homedir(), 'Library', 'Application Support', 'scorm-tester', 'scorm-sessions'),
      path.join(os.homedir(), '.config', 'scorm-tester', 'scorm-sessions'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'scorm-tester', 'scorm-sessions')
    ];
    
    const safeId = courseId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const safeNamespace = namespace.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${safeNamespace}_${safeId}.json`;
    
    for (const basePath of possiblePaths) {
      const fullPath = path.join(basePath, filename);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    
    return null;
  }

  /**
   * Extract course ID from manifest
   */
  function getCourseIdFromManifest(coursePath) {
    const manifestPath = path.join(coursePath, 'imsmanifest.xml');
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const idMatch = manifestContent.match(/identifier="([^"]+)"/);
    return idMatch ? idMatch[1] : 'unknown_course';
  }

  test('Complete lifecycle: open → navigate → close → verify JSON → reopen → verify resume', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const ws = path.resolve('references/real_course_examples/dist');
    const courseId = getCourseIdFromManifest(ws);
    
    console.log(`\n[TEST] ======================================`);
    console.log(`[TEST] Testing with course: ${ws}`);
    console.log(`[TEST] Course ID: ${courseId}`);
    console.log(`[TEST] ======================================\n`);

    // Initialize MCP
    console.log('[TEST] Step 1: Initializing MCP...');
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    // PHASE 1: Open course and make changes
    console.log('[TEST] Step 2: Opening course...');
    const openRes = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { 
        package_path: ws,
        viewport: { width: 1024, height: 768 }
      } 
    }, id++);
    const openData = parseMcpResponse(openRes);
    expect(openData.session_id).toBeTruthy();
    const session1 = openData.session_id;
    console.log(`[TEST] Session opened: ${session1}`);

    // Set some data to track
    console.log('[TEST] Step 3: Wait for course to initialize...');
    // Wait for course JavaScript to finish loading and set its own state
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Click the Next button (#nextBtn)
    console.log('[TEST] Step 3b: Clicking next button (#nextBtn)...');
    await rpc('tools/call', {
      name: 'scorm_dom_click',
      arguments: { 
        session_id: session1, 
        selector: '#nextBtn'
      }
    }, id++);
    console.log('[TEST] Next button clicked');
    
    // Wait for navigation animation to complete
    console.log('[TEST] Step 3c: Waiting for navigation to complete...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Read the course state after navigation
    const checkLocation = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session1, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const locationValue = parseMcpResponse(checkLocation).result;
    console.log(`[TEST] Current cmi.location = "${locationValue}"`);
    
    const checkSuspendData = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session1, method: 'GetValue', args: ['cmi.suspend_data'] }
    }, id++);
    const suspendDataValue = parseMcpResponse(checkSuspendData).result;
    console.log(`[TEST] Current cmi.suspend_data length = ${suspendDataValue.length} bytes`);
    
    const checkCompletion = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session1, method: 'GetValue', args: ['cmi.completion_status'] }
    }, id++);
    const completionValue = parseMcpResponse(checkCompletion).result;
    console.log(`[TEST] Current cmi.completion_status = "${completionValue}"`);

    // PHASE 2: Close course (should Terminate + Save JSON)
    console.log('[TEST] Step 4: Closing course (Terminate + Save JSON)...');
    console.log('[TEST] Session ID:', session1);
    console.log('[TEST] Watch for SessionStore console output:');
    console.log('[TEST] ----------------------------------------');
    
    const closeRes = await rpc('tools/call', { 
      name: 'scorm_close_course', 
      arguments: { session_id: session1 } 
    }, id++);
    console.log('[TEST] Close response:', JSON.stringify(closeRes, null, 2));
    const closeData = parseMcpResponse(closeRes);
    console.log('[TEST] Close data:', JSON.stringify(closeData, null, 2));
    expect(closeData.success).toBe(true);
    console.log('[TEST] ----------------------------------------');
    console.log('[TEST] Course closed successfully');

    // Wait for file I/O
    console.log('[TEST] Step 5: Waiting for file I/O to complete...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // PHASE 3: Verify JSON file was created
    console.log('[TEST] Step 6: Verifying JSON file was created...');
    console.log('[TEST] Looking for:', courseId, 'namespace: mcp');
    console.log('[TEST] Session store path:', path.join(require('os').homedir(), 'Library/Application Support/scorm-tester/scorm-sessions'));
    const files = fs.readdirSync(path.join(require('os').homedir(), 'Library/Application Support/scorm-tester/scorm-sessions'));
    console.log('[TEST] Files in session store:', files);
    const jsonPath = findSavedJson(courseId, 'mcp');
    console.log('[TEST] findSavedJson returned:', jsonPath);
    
    expect(jsonPath).toBeTruthy();
    console.log(`[TEST] ✓ Found saved JSON: ${jsonPath}`);
    
    // Verify JSON content
    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`[TEST] JSON file size: ${JSON.stringify(jsonContent, null, 2).length} bytes`);
    
    expect(jsonContent.coreData).toBeDefined();
    console.log(`[TEST] ✓ JSON has coreData object`);
    
    // Check cmi.exit
    const savedExit = jsonContent.coreData['cmi.exit'];
    console.log(`[TEST] cmi.exit = "${savedExit}"`);
    expect(savedExit).toBe('suspend');
    console.log(`[TEST] ✓ cmi.exit is correctly set to "suspend"`);
    
    // Check our saved data - compare with what we read before close
    const savedLocation = jsonContent.coreData['cmi.location'];
    const savedSuspendData = jsonContent.coreData['cmi.suspend_data'];
    const savedCompletion = jsonContent.coreData['cmi.completion_status'];
    
    console.log(`[TEST] cmi.location = "${savedLocation}" (expected: "${locationValue}")`);
    console.log(`[TEST] cmi.suspend_data length = ${savedSuspendData.length} bytes (expected: ${suspendDataValue.length})`);
    console.log(`[TEST] cmi.completion_status = "${savedCompletion}" (expected: "${completionValue}")`);
    
    expect(savedLocation).toBe(locationValue);
    expect(savedSuspendData).toBe(suspendDataValue);
    expect(savedCompletion).toBe(completionValue);
    console.log(`[TEST] ✓ All data values saved correctly`);
    
    // OUTPUT FULL JSON CONTENT
    console.log('\n[TEST] ========================================');
    console.log('[TEST] FULL JSON CONTENT AFTER SHUTDOWN:');
    console.log('[TEST] ========================================');
    console.log(JSON.stringify(jsonContent, null, 2));
    console.log('[TEST] ========================================\n');

    // PHASE 4: Reopen course (should resume from JSON)
    console.log('[TEST] Step 7: Reopening course (should resume)...');
    const reopen = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const reopenData = parseMcpResponse(reopen);
    const session2 = reopenData.session_id;
    console.log(`[TEST] New session opened: ${session2}`);
    
    // PHASE 5: Verify data was persisted and restored
    console.log('[TEST] Step 8: Verifying data was restored from JSON...');
    
    // Wait for course to initialize with saved data
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Verify location was restored
    const checkLocation2 = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session2, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const locationValue2 = parseMcpResponse(checkLocation2).result;
    console.log(`[TEST] Restored cmi.location = "${locationValue2}" (expected: "${locationValue}")`);
    expect(locationValue2).toBe(locationValue);
    console.log(`[TEST] ✓ Location was restored from JSON`);
    
    // Verify suspend_data was restored (contains navigation state)
    const checkSuspendData2 = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session2, method: 'GetValue', args: ['cmi.suspend_data'] }
    }, id++);
    const suspendDataValue2 = parseMcpResponse(checkSuspendData2).result;
    console.log(`[TEST] Restored cmi.suspend_data length = ${suspendDataValue2.length} bytes (expected: ${suspendDataValue.length})`);
    
    // Parse and check navigation state in suspend_data
    const suspendData2 = JSON.parse(suspendDataValue2);
    const suspendData1 = JSON.parse(suspendDataValue);
    console.log(`[TEST] Restored currentSlideIndex = ${suspendData2.navigation.currentSlideIndex} (expected: ${suspendData1.navigation.currentSlideIndex})`);
    expect(suspendData2.navigation.currentSlideIndex).toBe(suspendData1.navigation.currentSlideIndex);
    console.log(`[TEST] ✓ Navigation state was restored from JSON`);

    // Cleanup
    console.log('[TEST] Step 9: Cleaning up...');
    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id: session2 } }, id++);

    console.log(`\n[TEST] ======================================`);
    console.log(`[TEST] TEST PASSED - JSON persistence verified!`);
    console.log(`[TEST] JSON file: ${jsonPath}`);
    console.log(`[TEST] ======================================\n`);

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('Verify JSON persistence with reload (resume behavior)', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const ws = path.resolve('references/real_course_examples/dist');
    const courseId = getCourseIdFromManifest(ws);

    console.log('[TEST] Initializing MCP...');
    await rpc('initialize', {}, id++);

    // First session: set data
    console.log('[TEST] Opening first session...');
    const open1 = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const session1 = parseMcpResponse(open1).session_id;

    console.log('[TEST] Wait for course to initialize...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Navigate to second slide
    console.log('[TEST] Clicking next button to navigate...');
    await rpc('tools/call', {
      name: 'scorm_dom_click',
      arguments: { 
        session_id: session1, 
        selector: '#nextBtn'
      }
    }, id++);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Read the course state BEFORE reload
    const getLocationBefore = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session1, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const locationBefore = parseMcpResponse(getLocationBefore).result;
    console.log(`[TEST] Location before reload: "${locationBefore}"`);

    // Reload (should auto-close and reopen)
    console.log('[TEST] Reloading course...');
    const reload = await rpc('tools/call', { 
      name: 'scorm_reload_course', 
      arguments: { 
        session_id: session1,
        package_path: ws
      } 
    }, id++);
    const session2 = parseMcpResponse(reload).session_id;

    // Verify JSON was saved and loaded
    console.log('[TEST] Verifying JSON persistence after reload...');
    const jsonPath = findSavedJson(courseId, 'mcp');
    expect(jsonPath).toBeTruthy();
    console.log(`[TEST] JSON file exists: ${jsonPath}`);

    // Wait for course to reinitialize
    await new Promise(resolve => setTimeout(resolve, 1500));

    const getLocationAfter = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session2, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const locationAfter = parseMcpResponse(getLocationAfter).result;
    console.log(`[TEST] Restored location: "${locationAfter}" (expected: "${locationBefore}")`);
    expect(locationAfter).toBe(locationBefore);

    // Cleanup
    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id: session2 } }, id++);

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('Verify reload with force_new skips JSON loading', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const ws = path.resolve('references/real_course_examples/dist');

    console.log('[TEST] Initializing MCP...');
    await rpc('initialize', {}, id++);

    // First session: set data
    console.log('[TEST] Opening first session...');
    const open1 = await rpc('tools/call', { 
      name: 'scorm_open_course', 
      arguments: { package_path: ws } 
    }, id++);
    const session1 = parseMcpResponse(open1).session_id;

    console.log('[TEST] Wait for course to initialize...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Navigate to second slide
    console.log('[TEST] Clicking next button to navigate...');
    await rpc('tools/call', {
      name: 'scorm_dom_click',
      arguments: { 
        session_id: session1, 
        selector: '#nextBtn'
      }
    }, id++);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Read the location BEFORE force_new reload
    const getLocationBefore = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session1, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const locationBeforeReload = parseMcpResponse(getLocationBefore).result;
    console.log(`[TEST] Location before force_new: "${locationBeforeReload}"`);

    // Reload with force_new (should NOT load saved data)
    console.log('[TEST] Reloading with force_new flag...');
    const reload = await rpc('tools/call', { 
      name: 'scorm_reload_course', 
      arguments: { 
        session_id: session1,
        package_path: ws,
        force_new: true
      } 
    }, id++);
    const session2 = parseMcpResponse(reload).session_id;

    // Wait for fresh course to initialize
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Verify data was NOT restored (fresh start)
    console.log('[TEST] Verifying fresh start (no saved data)...');
    const getLocationAfter = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session2, method: 'GetValue', args: ['cmi.location'] }
    }, id++);
    const locationAfterReload = parseMcpResponse(getLocationAfter).result;
    console.log(`[TEST] Location after force_new: "${locationAfterReload}"`);
    
    // With force_new, if there was previous data it should be cleared (location should be back to initial state)
    // The course might set an initial location, so we just verify it's a fresh start
    expect(locationAfterReload).toBe(''); // Fresh SCORM session has empty location

    const checkEntry = await rpc('tools/call', {
      name: 'scorm_api_call',
      arguments: { session_id: session2, method: 'GetValue', args: ['cmi.entry'] }
    }, id++);
    const entry = parseMcpResponse(checkEntry).result;
    console.log(`[TEST] Entry mode: "${entry}"`);
    expect(['ab-initio', '']).toContain(entry);

    // Cleanup
    await rpc('tools/call', { name: 'scorm_close_course', arguments: { session_id: session2 } }, id++);

    try { proc.stdin.end(); } catch (e) { console.log('[TEST] Error ending stdin:', e.message); }
    try { proc.kill(); } catch (e) { console.log('[TEST] Error killing process:', e.message); }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });
});
