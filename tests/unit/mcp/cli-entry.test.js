const { runCli } = require('../../../src/mcp/cli');

describe('MCP CLI entry', () => {
  test('dry run parses flags without starting server', () => {
    const res1 = runCli({ argv: [], dryRun: true });
    expect(res1.flags.allow_network).toBe(false);

    const res2 = runCli({ argv: ['--allow-network', '--debug=true'], dryRun: true });
    expect(res2.flags.allow_network).toBe(true);
    expect(res2.flags.debug).toBe(true);
  });
});

