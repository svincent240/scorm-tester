'use strict';

const ManifestParser = require('../../../../src/main/services/scorm/cam/manifest-parser');
const { ParserError, ParserErrorCode } = require('../../../../src/shared/errors/parser-error');

describe('ManifestParser error boundaries', () => {
  let parser;
  let errorHandler;
  const basePath = process.cwd();

  beforeEach(() => {
    // Minimal errorHandler stub capturing setError calls
    const calls = [];
    errorHandler = {
      calls,
      setError: jest.fn((code, message, where) => calls.push({ code, message, where })),
      getLastError: jest.fn(() => '0'),
      clearError: jest.fn()
    };
    parser = new ManifestParser(errorHandler);
  });

  function expectParserError(fn, expectedCode, messageIncludes) {
    try {
      fn();
      throw new Error('Expected ParserError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ParserError');
      expect(err.code).toBe(expectedCode);
      expect(typeof err.message).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
      if (messageIncludes) {
        expect(err.message).toEqual(expect.stringContaining(messageIncludes));
      }
    }
  }

  test('Empty input → PARSE_EMPTY_INPUT', () => {
    expectParserError(() => parser.parseManifestXML('', basePath), ParserErrorCode.PARSE_EMPTY_INPUT, 'Empty');
  });

  test('Malformed XML → PARSE_XML_ERROR', () => {
    const xml = '<?xml version="1.0"?><manifest><organizations></manifest>'; // unbalanced
    expectParserError(() => parser.parseManifestXML(xml, basePath), ParserErrorCode.PARSE_XML_ERROR, 'XML');
  });

  test('Wrong root → PARSE_UNSUPPORTED_STRUCTURE', () => {
    const xml = '<?xml version="1.0"?><badroot></badroot>';
    expectParserError(() => parser.parseManifestXML(xml, basePath), ParserErrorCode.PARSE_UNSUPPORTED_STRUCTURE, 'root element');
  });

  test('Missing/empty orgs → PARSE_VALIDATION_ERROR', () => {
    // A) No organizations element
    const a = '<?xml version="1.0"?><manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"><resources></resources></manifest>';
    expectParserError(() => parser.parseManifestXML(a, basePath), ParserErrorCode.PARSE_VALIDATION_ERROR, 'organizations');

    // B) Organizations present but empty
    const b = `<?xml version="1.0"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">
  <organizations></organizations>
  <resources></resources>
</manifest>`;
    expectParserError(() => parser.parseManifestXML(b, basePath), ParserErrorCode.PARSE_VALIDATION_ERROR, 'No organizations');
  });

  test('Missing default org reference → PARSE_VALIDATION_ERROR', () => {
    const xml = `<?xml version="1.0"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" identifier="M1">
  <organizations default="ORG-MISSING">
    <organization identifier="ORG-1"><title>T</title></organization>
  </organizations>
  <resources></resources>
</manifest>`;
    expectParserError(() => parser.parseManifestXML(xml, basePath), ParserErrorCode.PARSE_VALIDATION_ERROR, 'Default organization');
  });

  test('Unresolved item.identifierref → PARSE_VALIDATION_ERROR', () => {
    const xml = `<?xml version="1.0"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" identifier="M1">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>T</title>
      <item identifier="ITEM-1" identifierref="RES-NOPE"><title>I1</title></item>
    </organization>
  </organizations>
  <resources>
  </resources>
</manifest>`;
    expectParserError(() => parser.parseManifestXML(xml, basePath), ParserErrorCode.PARSE_VALIDATION_ERROR, 'identifierref');
  });

  test('SCO without href → PARSE_VALIDATION_ERROR', () => {
    const xml = `<?xml version="1.0"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" identifier="M1">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>T</title>
      <item identifier="ITEM-1" identifierref="RES-1"><title>I1</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco">
      <file href="index.html" />
    </resource>
  </resources>
</manifest>`;
    expectParserError(() => parser.parseManifestXML(xml, basePath), ParserErrorCode.PARSE_VALIDATION_ERROR, 'href');
  });
});