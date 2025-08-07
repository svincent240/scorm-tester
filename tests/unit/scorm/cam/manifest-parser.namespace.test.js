'use strict';

const ManifestParser = require('../../../../src/main/services/scorm/cam/manifest-parser');

describe('ManifestParser namespace-first selection', () => {
  let parser;
  let errorHandler;
  const basePath = process.cwd();

  beforeEach(() => {
    const calls = [];
    errorHandler = {
      calls,
      setError: jest.fn((code, message, where) => calls.push({ code, message, where })),
      getLastError: jest.fn(() => '0'),
      clearError: jest.fn()
    };
    parser = new ManifestParser(errorHandler);
  });

  function parse(xml) {
    return parser.parseManifestXML(xml, basePath);
  }

  test('Prefers namespaced elements when both namespaced and non-namespaced exist', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:imscp="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
          xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
          identifier="M1">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Course</title>
      <!-- Both namespaced and non-namespaced item; parser should pick prefixed first -->
      <imscp:item identifier="ITEM-NS" identifierref="RES-NS">
        <title>NS Item</title>
        <!-- Sequencing provided in namespaced form -->
        <imsss:sequencing>
          <imsss:controlMode flow="true" />
        </imsss:sequencing>
      </imscp:item>
      <item identifier="ITEM-PLAIN" identifierref="RES-PLAIN">
        <title>Plain Item</title>
        <sequencing>
          <controlMode flow="true" />
        </sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-NS" type="webcontent" adlcp:scormType="sco" href="ns.html">
      <file href="ns.html" />
    </resource>
    <resource identifier="RES-PLAIN" type="webcontent" adlcp:scormType="sco" href="plain.html">
      <file href="plain.html" />
    </resource>
  </resources>
</manifest>`;
    const result = parse(xml);
    expect(result).toBeDefined();
    const org = result.organizations.organizations[0];
    expect(org).toBeDefined();
    // selectChildrenNS should have returned namespaced item first
    expect(org.items.length).toBeGreaterThanOrEqual(1);
    expect(org.items[0].identifier).toBe('ITEM-NS');
    // Sequencing from namespaced element should be parsed
    expect(org.items[0].sequencing?.controlMode?.flow).toBe(true);
  });

  test('Falls back to non-namespaced elements when namespaced variants are absent', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
          identifier="M2">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Course</title>
      <item identifier="ITEM-1" identifierref="RES-1">
        <title>Only Plain Item</title>
        <sequencing>
          <controlMode flow="true" />
        </sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="i1.html">
      <file href="i1.html" />
    </resource>
  </resources>
</manifest>`;
    const result = parse(xml);
    const org = result.organizations.organizations[0];
    expect(org.items.length).toBe(1);
    expect(org.items[0].identifier).toBe('ITEM-1');
    expect(org.items[0].sequencing?.controlMode?.flow).toBe(true);
  });

  test('Mixed namespaced/non-namespaced sequencing children still resolve correctly', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:imscp="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
          identifier="M3">
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>Course</title>
      <imscp:item identifier="ITEM-1" identifierref="RES-1">
        <title>NS Item</title>
        <!-- sequencing element is non-namespaced but children are namespaced -->
        <sequencing>
          <imsss:controlMode flow="true" />
        </sequencing>
      </imscp:item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="i1.html">
      <file href="i1.html" />
    </resource>
  </resources>
</manifest>`;
    const result = parse(xml);
    const org = result.organizations.organizations[0];
    expect(org.items.length).toBe(1);
    const seq = org.items[0].sequencing;
    expect(seq).toBeDefined();
    expect(seq.controlMode?.flow).toBe(true);
  });
});