const { spawn } = require('child_process');
const path = require('path');
const { parseMcpResponse } = require('../helpers/mcp-response-parser');

describe('MCP scorm_dom_evaluate error handling on real course', () => {
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

  test('successful JavaScript execution returns result', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP for successful execution test...');
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    console.log('[TEST] Opening session...');
    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    console.log('[TEST] Opening runtime...');
    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Test successful execution - simple expression
    console.log('[TEST] Testing successful simple expression...');
    const simpleExpr = await rpc('tools/call', {
      name: 'scorm_dom_evaluate',
      arguments: {
        session_id,
        expression: '2 + 2'
      }
    }, id++);
    const simpleData = parseMcpResponse(simpleExpr);
    expect(simpleData.result).toBe(4);

    // Test successful execution - DOM query
    console.log('[TEST] Testing successful DOM query...');
    const domQuery = await rpc('tools/call', {
      name: 'scorm_dom_evaluate',
      arguments: {
        session_id,
        expression: 'document.querySelectorAll("*").length'
      }
    }, id++);
    const domData = parseMcpResponse(domQuery);
    expect(typeof domData.result).toBe('number');
    expect(domData.result).toBeGreaterThan(0);

    // Test successful execution - object return
    console.log('[TEST] Testing object return...');
    const objExpr = await rpc('tools/call', {
      name: 'scorm_dom_evaluate',
      arguments: {
        session_id,
        expression: '({ foo: "bar", count: 42 })'
      }
    }, id++);
    const objData = parseMcpResponse(objExpr);
    expect(objData.result).toEqual({ foo: 'bar', count: 42 });

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('syntax error provides detailed error message', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP for syntax error test...');
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    console.log('[TEST] Opening session...');
    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    console.log('[TEST] Opening runtime...');
    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Test syntax error - missing value after assignment
    console.log('[TEST] Testing syntax error...');
    const syntaxError = await rpc('tools/call', {
      name: 'scorm_dom_evaluate',
      arguments: {
        session_id,
        expression: 'const x = ;'
      }
    }, id++);

    console.log('[TEST] Syntax error response:', JSON.stringify(syntaxError, null, 2));
    expect(syntaxError.result).toBeDefined();
    expect(syntaxError.result.isError).toBe(true);
    expect(syntaxError.result.content).toBeDefined();
    expect(syntaxError.result.content[0].text).toContain('SyntaxError');
    expect(syntaxError.result.content[0].text).toContain('DOM evaluate failed');

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('reference error provides detailed error message', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP for reference error test...');
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    console.log('[TEST] Opening session...');
    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    console.log('[TEST] Opening runtime...');
    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Test reference error - accessing undefined variable
    console.log('[TEST] Testing reference error...');
    const refError = await rpc('tools/call', {
      name: 'scorm_dom_evaluate',
      arguments: {
        session_id,
        expression: 'nonExistentVariable.someMethod()'
      }
    }, id++);

    console.log('[TEST] Reference error response:', JSON.stringify(refError, null, 2));
    expect(refError.result).toBeDefined();
    expect(refError.result.isError).toBe(true);
    expect(refError.result.content).toBeDefined();
    expect(refError.result.content[0].text).toContain('ReferenceError');
    expect(refError.result.content[0].text).toContain('DOM evaluate failed');
    expect(refError.result.content[0].text).toContain('nonExistentVariable');

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('type error provides detailed error message', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP for type error test...');
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    console.log('[TEST] Opening session...');
    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    console.log('[TEST] Opening runtime...');
    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Test type error - calling method on null
    console.log('[TEST] Testing type error...');
    const typeError = await rpc('tools/call', {
      name: 'scorm_dom_evaluate',
      arguments: {
        session_id,
        expression: 'null.someMethod()'
      }
    }, id++);

    console.log('[TEST] Type error response:', JSON.stringify(typeError, null, 2));
    expect(typeError.result).toBeDefined();
    expect(typeError.result.isError).toBe(true);
    expect(typeError.result.content).toBeDefined();
    expect(typeError.result.content[0].text).toContain('TypeError');
    expect(typeError.result.content[0].text).toContain('DOM evaluate failed');

    await rpc('tools/call', { name: 'scorm_runtime_close', arguments: { session_id } }, id++);
    await rpc('tools/call', { name: 'scorm_session_close', arguments: { session_id } }, id++);

    try { proc.stdin.end(); } catch (_) {}
    try { proc.kill(); } catch (_) {}
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000))
    ]);
  });

  test('complex expression with button click works correctly', async () => {
    const { proc, rpc } = rpcClient();
    let id = 1;

    console.log('[TEST] Initializing MCP for complex expression test...');
    const initRes = await rpc('initialize', {}, id++);
    expect(initRes && !initRes.error).toBe(true);

    const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');

    console.log('[TEST] Opening session...');
    const openSession = await rpc('tools/call', { name: 'scorm_session_open', arguments: { package_path: ws } }, id++);
    const openData = parseMcpResponse(openSession);
    const session_id = openData.session_id;

    console.log('[TEST] Opening runtime...');
    await rpc('tools/call', { name: 'scorm_runtime_open', arguments: { session_id } }, id++);

    // Test complex expression - find and click button (should work or return meaningful result)
    console.log('[TEST] Testing complex button search expression...');
    const complexExpr = await rpc('tools/call', {
      name: 'scorm_dom_evaluate',
      arguments: {
        session_id,
        expression: `
          (() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return {
              totalButtons: buttons.length,
              buttonTexts: buttons.slice(0, 5).map(b => b.textContent.trim())
            };
          })()
        `
      }
    }, id++);

    const complexData = parseMcpResponse(complexExpr);
    console.log('[TEST] Complex expression result:', JSON.stringify(complexData, null, 2));
    expect(complexData.result).toBeDefined();
    expect(typeof complexData.result.totalButtons).toBe('number');
    expect(Array.isArray(complexData.result.buttonTexts)).toBe(true);

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

