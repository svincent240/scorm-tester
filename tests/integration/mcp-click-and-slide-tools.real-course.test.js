const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP click by text and slide navigation tools', () => {
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

  test('scorm_dom_click_by_text finds and clicks button by text', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // First, find interactive elements to see what buttons exist
    const elements = await rpc('tools/call', {
      name: 'scorm_dom_find_interactive_elements',
      arguments: { session_id }
    }, id++);
    const elementsData = parseMcpResponse(elements);
    
    // Should have some buttons
    expect(Array.isArray(elementsData.buttons)).toBe(true);
    
    if (elementsData.buttons.length > 0) {
      const firstButton = elementsData.buttons[0];
      const buttonText = firstButton.label || firstButton.text;
      
      if (buttonText) {
        // Try to click by text (fuzzy match)
        const clickResult = await rpc('tools/call', {
          name: 'scorm_dom_click_by_text',
          arguments: { 
            session_id,
            text: buttonText.substring(0, 5), // Use partial text for fuzzy match
            options: { exact_match: false }
          }
        }, id++);
        const clickData = parseMcpResponse(clickResult);
        
        expect(clickData.clicked).toBe(true);
        expect(clickData.element).toBeDefined();
        expect(clickData.element.tagName).toBeDefined();
      }
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

  test('scorm_dom_click_by_text handles whitespace normalization', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Create a test button with extra whitespace
    await rpc('tools/call', {
      name: 'scorm_dom_evaluate',
      arguments: {
        session_id,
        expression: `
          (() => {
            const btn = document.createElement('button');
            btn.id = 'test-whitespace-btn';
            btn.textContent = '  Click   Me  ';
            document.body.appendChild(btn);
            return true;
          })()
        `
      }
    }, id++);

    // Click with normalized text (no extra spaces)
    const clickResult = await rpc('tools/call', {
      name: 'scorm_dom_click_by_text',
      arguments: { 
        session_id,
        text: 'click me',
        options: { exact_match: true }
      }
    }, id++);
    const clickData = parseMcpResponse(clickResult);
    
    expect(clickData.clicked).toBe(true);
    expect(clickData.element.id).toBe('test-whitespace-btn');

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_dom_click_by_text fails gracefully when text not found', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Try to click non-existent button
    const clickResult = await rpc('tools/call', {
      name: 'scorm_dom_click_by_text',
      arguments: { 
        session_id,
        text: 'ThisButtonDoesNotExist12345'
      }
    }, id++);
    
    // Should return error
    expect(clickResult.result).toBeDefined();
    expect(clickResult.result.isError).toBe(true);
    expect(clickResult.result.content[0].text).toContain('No element found with text');

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_get_slide_map discovers slides in course', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Get slide map
    const slideMap = await rpc('tools/call', {
      name: 'scorm_get_slide_map',
      arguments: { session_id }
    }, id++);
    const mapData = parseMcpResponse(slideMap);

    // Verify structure
    expect(mapData.total_slides).toBeDefined();
    expect(typeof mapData.total_slides).toBe('number');
    expect(mapData.current_slide_index).toBeDefined();
    expect(Array.isArray(mapData.slides)).toBe(true);

    // If slides found, verify slide structure
    if (mapData.total_slides > 0) {
      const firstSlide = mapData.slides[0];
      expect(firstSlide.index).toBeDefined();
      expect(typeof firstSlide.index).toBe('number');
      expect(firstSlide.visible).toBeDefined();
      expect(typeof firstSlide.visible).toBe('boolean');
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

  test('scorm_navigate_to_slide navigates by index', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Create test slides
    await rpc('tools/call', {
      name: 'scorm_dom_evaluate',
      arguments: {
        session_id,
        expression: `
          (() => {
            // Create 3 test slides
            for (let i = 0; i < 3; i++) {
              const slide = document.createElement('section');
              slide.id = 'slide-' + i;
              slide.setAttribute('data-slide-id', 'slide-' + i);
              slide.style.display = i === 0 ? 'block' : 'none';
              const title = document.createElement('h2');
              title.textContent = 'Slide ' + (i + 1);
              slide.appendChild(title);
              document.body.appendChild(slide);
            }
            return true;
          })()
        `
      }
    }, id++);

    // Navigate to slide 1 (second slide)
    const navResult = await rpc('tools/call', {
      name: 'scorm_navigate_to_slide',
      arguments: { 
        session_id,
        slide_identifier: 1
      }
    }, id++);
    const navData = parseMcpResponse(navResult);

    expect(navData.success).toBe(true);
    expect(navData.slide_index).toBe(1);

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) { /* intentionally empty */ }
    try { proc.kill(); } catch (_) { /* intentionally empty */ }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('scorm_navigate_to_slide navigates by title substring', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Create test slides with titles
    await rpc('tools/call', {
      name: 'scorm_dom_evaluate',
      arguments: {
        session_id,
        expression: `
          (() => {
            const titles = ['Introduction', 'Assessment', 'Summary'];
            for (let i = 0; i < titles.length; i++) {
              const slide = document.createElement('section');
              slide.id = 'slide-' + i;
              slide.setAttribute('data-slide-id', 'slide-' + i);
              slide.style.display = i === 0 ? 'block' : 'none';
              const title = document.createElement('h2');
              title.textContent = titles[i];
              slide.appendChild(title);
              document.body.appendChild(slide);
            }
            return true;
          })()
        `
      }
    }, id++);

    // Navigate to "Assessment" slide by title substring
    const navResult = await rpc('tools/call', {
      name: 'scorm_navigate_to_slide',
      arguments: { 
        session_id,
        slide_identifier: 'assess'
      }
    }, id++);
    const navData = parseMcpResponse(navResult);

    expect(navData.success).toBe(true);
    expect(navData.slide_index).toBe(1); // Assessment is second slide

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

