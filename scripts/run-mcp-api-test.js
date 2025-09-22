/*
  Launches the MCP stdio server and invokes scorm_test_api_integration against a real course.
  Prints the JSON-RPC responses for initialize and tools/call to stdout.
*/
const { spawn } = require('child_process');
const path = require('path');

function startMCP() {
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(cmd, ['run', '-s', 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {}); // discard stderr (logs)
  return child;
}

async function main() {
  const mcp = startMCP();
  let buf = '';
  const pending = new Map();
  mcp.stdout.setEncoding('utf8');
  mcp.stdout.on('data', chunk => {
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
        // ignore non-JSON lines
      }
    }
  });

  function rpc(method, params, id) {
    return new Promise(resolve => {
      pending.set(id, resolve);
      const msg = { jsonrpc: '2.0', id, method, params };
      mcp.stdin.write(JSON.stringify(msg) + '\n');
    });
  }

  let id = 1;
  const initRes = await rpc('initialize', {}, id++);
  const ws = path.resolve('references/real_course_examples/SequencingSimpleRemediation_SCORM20043rdEdition');
  const argumentsObj = {
    workspace_path: ws,
    capture_api_calls: true,
    viewport: { device: 'desktop' },
    test_scenario: {
      steps: ['Initialize', 'SetValue cmi.location hole_1', 'Terminate']
    }
  };
  const callRes = await rpc('tools/call', { name: 'scorm_test_api_integration', arguments: argumentsObj }, id++);

  const out = { init: initRes, result: callRes };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  try { mcp.kill('SIGTERM'); } catch (_) {}
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

