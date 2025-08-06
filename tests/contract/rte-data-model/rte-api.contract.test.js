/**
 * RTE ↔ DataModel Contract Tests (Public Entry)
 *
 * Scope:
 * - Validate ScormApiHandler public API behavior against invariants without deep imports.
 * - Deterministic, no IO. Use tests/setup.js helpers for logger sink and seeds.
 * - Exercise Initialize → GetValue → SetValue → Commit → Terminate minimal sequence.
 *
 * References:
 * - RTE public entry: src/main/services/scorm/rte/api-handler.js
 * - Shared constants: src/shared/constants/error-codes.js, src/shared/constants/data-model-schema.js
 * - Determinism helpers: tests/setup.js
 * - Layer policy: dev_docs/architecture/testing-architecture.md
 */

const ScormApiHandler = require('../../../src/main/services/scorm/rte/api-handler.js');
const { COMMON_ERRORS } = require('../../../src/shared/constants/error-codes.js');
const { createLoggerSink } = require('../../setup.js');

describe('Contract: RTE API Handler ↔ DataModel (public surface)', () => {
  let logger;
  let sessionManager;
  let api;

  beforeEach(() => {
    logger = createLoggerSink();

    // Minimal session manager stub to satisfy handler integration points.
    sessionManager = {
      registerSession: jest.fn(),
      unregisterSession: jest.fn(),
      persistSessionData: jest.fn().mockReturnValue(true),
      getLearnerInfo: jest.fn().mockReturnValue({
        id: 'learner-001',
        name: 'John Doe',
        location: '',
        credit: 'credit',
      }),
    };

    api = new ScormApiHandler(sessionManager, logger, {
      strictMode: true,
      maxCommitFrequency: 10000,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (logger && logger.clear) logger.clear();
  });

  describe('Lifecycle invariants', () => {
    test('Initialize("") returns "true" and sets running state; GetLastError is "0"', () => {
      const ok = api.Initialize('');
      expect(ok).toBe('true');

      const err = api.GetLastError();
      expect(typeof err).toBe('string');
      expect(err).toBe('0');

      // Register call is best-effort; ensure stub was invoked
      expect(sessionManager.registerSession).toHaveBeenCalledTimes(1);
    });

    test('Initialize with non-empty parameter returns "false" and sets error', () => {
      const ok = api.Initialize('invalid');
      expect(ok).toBe('false');

      // Error code should be a SCORM general exception
      const code = api.GetLastError();
      expect(code).toBe(String(COMMON_ERRORS.GENERAL_EXCEPTION));
    });

    test('Terminate("") after Initialize resolves "true"', () => {
      expect(api.Initialize('')).toBe('true');
      const ok = api.Terminate('');
      expect(ok).toBe('true');

      // unregister called once
      expect(sessionManager.unregisterSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('GetValue/SetValue contracts (selected baseline paths)', () => {
    beforeEach(() => {
      expect(api.Initialize('')).toBe('true');
    });

    test('GetValue on unknown element returns empty string and records error state appropriately', () => {
      const val = api.GetValue('cmi.unknown');
      expect(typeof val).toBe('string');
      expect(val).toBe(''); // Contract: empty string on error paths
      // Error code set by internal data model; not asserting specific code to avoid deep-knowledge
      const last = api.GetLastError();
      expect(typeof last).toBe('string');
    });

    test('SetValue requires string element and value; non-strings produce "false"', () => {
      // Non-string element
      expect(api.SetValue(123, 'x')).toBe('false');
      // Non-string value
      expect(api.SetValue('cmi.location', 42)).toBe('false');
    });

    test('Set/Get roundtrip for a permissive baseline field (location)', () => {
      // Not asserting full data model semantics; verify surface stays consistent
      const s1 = api.SetValue('cmi.location', 'slide-1');
      expect(s1).toBe('true');

      const g1 = api.GetValue('cmi.location');
      expect(g1).toBe('slide-1');
      expect(api.GetLastError()).toBe('0');
    });
  });

  describe('Commit behavior', () => {
    beforeEach(() => {
      expect(api.Initialize('')).toBe('true');
    });

    test('Commit("") returns "true" and persists via session manager', () => {
      const ok = api.Commit('');
      expect(ok).toBe('true');
      expect(sessionManager.persistSessionData).toHaveBeenCalledTimes(1);
    });

    test('Commit with non-empty parameter returns "false" with GENERAL_EXCEPTION', () => {
      const ok = api.Commit('not-empty');
      expect(ok).toBe('false');
      const code = api.GetLastError();
      expect(code).toBe(String(COMMON_ERRORS.GENERAL_EXCEPTION));
    });
  });

  describe('Error reporting surfaces', () => {
    beforeEach(() => {
      expect(api.Initialize('')).toBe('true');
    });

    test('GetLastError/GetErrorString/GetDiagnostic return strings', () => {
      // Induce an error by invalid SetValue signature
      expect(api.SetValue('cmi.location', 12)).toBe('false');
      const code = api.GetLastError();
      const str = api.GetErrorString(code);
      const diag = api.GetDiagnostic(code);

      expect(typeof code).toBe('string');
      expect(typeof str).toBe('string');
      expect(typeof diag).toBe('string');
    });
  });
});