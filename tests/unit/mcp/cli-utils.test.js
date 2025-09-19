const { parseCliArgs } = require('../../../src/mcp/cli-utils');

describe('CLI Utils - parseCliArgs', () => {
  test('returns flags with defaults', () => {
    const flags = parseCliArgs([]);
    expect(flags).toBeTruthy();
    expect(flags.allow_network).toBe(false);
  });

  test('parses --allow-network and --key=value', () => {
    const flags = parseCliArgs(['--allow-network', '--timeout_ms=5000', '--debug=true']);
    expect(flags.allow_network).toBe(true);
    expect(flags.timeout_ms).toBe('5000');
    expect(flags.debug).toBe(true);
  });
});

