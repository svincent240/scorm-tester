/**
 * SCORM 2004 4th Edition Manifest Parser
 * 
 * Parses and validates SCORM manifest XML files according to:
 * - SCORM 2004 4th Edition Content Aggregation Model specification
 * - IMS Content Packaging specification
 * - ADL SCORM extensions
 * 
 * Features:
 * - XML parsing with namespace support
 * - Schema validation against SCORM XSD
 * - Manifest structure extraction
 * - Resource and organization parsing
 * - Sequencing information extraction
 * 
 * @fileoverview SCORM manifest parser implementation
 */

const fs = require('fs').promises;
const path = require('path');
const { DOMParser } = require('xmldom');
const SCORM_CONSTANTS = require('../../../../shared/constants/scorm-constants');
const { ParserError, ParserErrorCode } = require('../../../../shared/errors/parser-error');
// Align with dev_docs: shared logger is at src/shared/utils/logger.js
// From this file (src/main/services/scorm/cam/manifest-parser.js), the correct relative path is:
// src/main/services/scorm/cam -> up to src/main/services/scorm -> src/main/services -> src/main -> src
// ../../../../shared/utils/logger
const logger = require('../../../../shared/utils/logger');

/**
 * SCORM Manifest Parser
 * 
 * Handles parsing of SCORM 2004 4th Edition manifest files with full
 * namespace support and validation.
 */
class ManifestParser {
  constructor(errorHandler) {
    this.errorHandler = errorHandler;
    this.parser = new DOMParser({
      errorHandler: {
        warning: (msg) => {
          // Strict: escalate as ParserError
          const err = new ParserError({
            code: ParserErrorCode.PARSE_XML_ERROR,
            message: `XML Warning: ${msg}`,
            detail: { where: 'DOMParser.warning' }
          });
          this.errorHandler?.setError('301', err.message, 'ManifestParser');
          throw err;
        },
        error: (msg) => {
          const err = new ParserError({
            code: ParserErrorCode.PARSE_XML_ERROR,
            message: `XML Error: ${msg}`,
            detail: { where: 'DOMParser.error' }
          });
          this.errorHandler?.setError('301', err.message, 'ManifestParser');
          throw err;
        },
        fatalError: (msg) => {
          const err = new ParserError({
            code: ParserErrorCode.PARSE_XML_ERROR,
            message: `XML Fatal Error: ${msg}`,
            detail: { where: 'DOMParser.fatalError' }
          });
          this.errorHandler?.setError('301', err.message, 'ManifestParser');
          throw err;
        }
      }
    });
    
    // SCORM namespace definitions
    this.namespaces = {
      imscp: 'http://www.imsglobal.org/xsd/imscp_v1p1',
      adlcp: 'http://www.adlnet.org/xsd/adlcp_v1p3',
      imsss: 'http://www.imsglobal.org/xsd/imsss',
      adlseq: 'http://www.adlnet.org/xsd/adlseq_v1p3',
      adlnav: 'http://www.adlnet.org/xsd/adlnav_v1p3',
      lom: 'http://ltsc.ieee.org/xsd/LOM'
    };
  }

  /**
   * Parse manifest file from file path
   * @param {string} manifestPath - Path to imsmanifest.xml file
   * @returns {Promise<Object>} Parsed manifest object
   */
  async parseManifestFile(manifestPath) {
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf8');
      return this.parseManifestXML(manifestContent, path.dirname(manifestPath));
    } catch (error) {
      this.errorHandler?.setError('301', `Failed to read manifest: ${error.message}`, 'parseManifestFile');
      throw error;
    }
  }

  /**
   * Parse manifest XML content
   * @param {string} xmlContent - XML content string
   * @param {string} basePath - Base path for resolving relative URLs
   * @returns {Object} Parsed manifest object
   */
  parseManifestXML(xmlContent, basePath = '') {
    try {
      logger.info('ManifestParser: start', { phase: 'CAM_PARSE', basePath, inputType: typeof xmlContent, len: xmlContent?.length || 0 });

      if (!xmlContent || xmlContent.trim() === '') {
        const err = new ParserError({
          code: ParserErrorCode.PARSE_EMPTY_INPUT,
          message: 'Empty or null XML content',
          detail: { note: 'No content provided' }
        });
        this.errorHandler?.setError('301', err.message, 'parseManifestXML');
        throw err;
      }

      logger.debug('ManifestParser: xml preview', { phase: 'CAM_PARSE', preview: String(xmlContent).substring(0, 200) });

      const doc = this.parser.parseFromString(xmlContent, 'text/xml');
      const manifestElement = doc.documentElement;

      const parserError = doc.getElementsByTagName('parsererror');
      if (parserError.length > 0) {
        const detail = [];
        for (let i = 0; i < parserError.length; i++) {
          detail.push(String(parserError[i].textContent || '').substring(0, 500));
        }
        const err = new ParserError({
          code: ParserErrorCode.PARSE_XML_ERROR,
          message: 'XML parsing error',
          detail: { errors: detail, count: parserError.length }
        });
        this.errorHandler?.setError('301', err.message, 'parseManifestXML');
        throw err;
      }

      if (!manifestElement) {
        const err = new ParserError({
          code: ParserErrorCode.PARSE_XML_ERROR,
          message: 'Invalid manifest: missing root element'
        });
        this.errorHandler?.setError('301', err.message, 'parseManifestXML');
        throw err;
      }

      const rootLocal = manifestElement.localName || manifestElement.tagName;
      if (rootLocal !== 'manifest') {
        const err = new ParserError({
          code: ParserErrorCode.PARSE_UNSUPPORTED_STRUCTURE,
          message: 'Invalid manifest: root element must be <manifest>',
          detail: { tagName: manifestElement.tagName, localName: manifestElement.localName }
        });
        this.errorHandler?.setError('301', err.message, 'parseManifestXML');
        throw err;
      }

      const identifier = this.getAttribute(manifestElement, 'identifier');
      const version = this.getAttribute(manifestElement, 'version') || '1.0';

      // Parse sub-elements with strict error handling
      let metadata = null, organizations = null, resources = [], subManifests = [];

      try {
        metadata = this.parseMetadata(manifestElement, basePath);
      } catch (metadataError) {
        // Metadata optional: log as info instead of warn to avoid noisy logs for common cases
        logger.info('ManifestParser: metadata parse skipped/failed', { phase: 'CAM_PARSE', message: metadataError?.message || String(metadataError) });
      }

      organizations = this.parseOrganizations(manifestElement, basePath); // may throw ParserError
      resources = this.parseResources(manifestElement, basePath); // may throw ParserError

      // Build a resource map for identifierref validation
      const resourceMap = new Map();
      for (const r of resources) {
        if (r?.identifier) resourceMap.set(r.identifier, r);
      }

      try {
        subManifests = this.parseSubManifests(manifestElement, basePath);
      } catch (subManifestError) {
        logger.info('ManifestParser: sub-manifests parse skipped/failed', { phase: 'CAM_PARSE', message: subManifestError?.message || String(subManifestError) });
        subManifests = [];
      }

      // Validate identifierref across all items in all organizations
      const allItems = [];
      for (const org of organizations.organizations || []) {
        this._collectItems(org.items || [], allItems);
      }
      for (const it of allItems) {
        if (it.identifierref) {
          if (!resourceMap.has(it.identifierref)) {
            const err = new ParserError({
              code: ParserErrorCode.PARSE_VALIDATION_ERROR,
              message: `Item identifierref does not resolve to a resource: ${it.identifierref}`,
              detail: { itemId: it.identifier, identifierref: it.identifierref, knownResourceIds: Array.from(resourceMap.keys()) }
            });
            this.errorHandler?.setError('301', err.message, 'parseManifestXML');
            throw err;
          }
        }
      }

      const result = {
        identifier,
        version,
        metadata,
        organizations,
        resources,
        manifest: subManifests
      };

      // Success snapshot log per approved contract
      const defaultOrgId = result.organizations?.default || null;
      const defaultOrg = (result.organizations?.organizations || []).find(o => o.identifier === defaultOrgId) || (result.organizations?.organizations || [])[0] || null;
      const topCount = Array.isArray(defaultOrg?.items) ? defaultOrg.items.length : 0;

      logger.info('ManifestParser: success', {
        phase: 'CAM_PARSE',
        code: 'PARSE_SUCCESS',
        message: 'Manifest parsed successfully',
        manifestId: identifier || null,
        defaultOrgId,
        stats: {
          orgCount: Array.isArray(result.organizations?.organizations) ? result.organizations.organizations.length : 0,
          topCount
        },
        severity: 'INFO'
      });

      return result;
    } catch (error) {
      if (!(error instanceof ParserError)) {
        const err = new ParserError({
          code: ParserErrorCode.PARSE_VALIDATION_ERROR,
          message: `Manifest parsing failed: ${error.message}`,
          detail: { stack: error.stack }
        });
        this.errorHandler?.setError('301', err.message, 'parseManifestXML');
        throw err;
      }
      this.errorHandler?.setError('301', error.message, 'parseManifestXML');
      throw error;
    }
  }

  /**
   * Parse metadata section
   * @param {Element} manifestElement - Manifest root element
   * @param {string} basePath - Base path for resolving URLs
   * @returns {Object} Metadata information
   */
  parseMetadata(manifestElement, basePath) {
    const metadataElement = this.getChildElement(manifestElement, 'metadata');
    if (!metadataElement) return null;

    return {
      schema: this.getElementText(metadataElement, 'schema'),
      schemaversion: this.getElementText(metadataElement, 'schemaversion'),
      location: this.getElementText(metadataElement, 'location'),
      lom: this.parseLOMMetadata(metadataElement)
    };
  }

  /**
   * Parse organizations section
   * @param {Element} manifestElement - Manifest root element
   * @param {string} basePath - Base path for resolving URLs
   * @returns {Object} Organizations information
   */
  parseOrganizations(manifestElement, basePath) {
    const organizationsElement =
      this.selectFirstNS(manifestElement, ['imscp:organizations', 'organizations']);
    if (!organizationsElement) {
      throw new ParserError({
        code: ParserErrorCode.PARSE_VALIDATION_ERROR,
        message: 'Manifest missing required organizations element',
        detail: { path: 'manifest/organizations' }
      });
    }

    const defaultOrg = organizationsElement.getAttributeNS
      ? (organizationsElement.getAttributeNS(null, 'default') || organizationsElement.getAttribute('default'))
      : this.getAttribute(organizationsElement, 'default');

    const orgElements = this.selectChildrenNS(organizationsElement, ['imscp:organization', 'organization']);
    const organizations = [];
    for (const orgElement of orgElements) {
      organizations.push(this.parseOrganization(orgElement, basePath));
    }

    if (organizations.length === 0) {
      throw new ParserError({
        code: ParserErrorCode.PARSE_VALIDATION_ERROR,
        message: 'No organizations found in manifest',
        detail: { path: 'manifest/organizations' }
      });
    }

    if (defaultOrg) {
      const exists = organizations.some(o => (o.identifier || '') === defaultOrg);
      if (!exists) {
        throw new ParserError({
          code: ParserErrorCode.PARSE_VALIDATION_ERROR,
          message: `Default organization not found: ${defaultOrg}`,
          detail: { default: defaultOrg, orgIds: organizations.map(o => o.identifier) }
        });
      }
    }

    return {
      default: defaultOrg || organizations[0]?.identifier || null,
      organizations
    };
  }

  /**
   * Parse single organization
   * @param {Element} orgElement - Organization element
   * @param {string} basePath - Base path for resolving URLs
   * @returns {Object} Organization information
   */
  parseOrganization(orgElement, basePath) {
    return {
      identifier: this.getAttribute(orgElement, 'identifier'),
      title: this.getElementText(orgElement, 'title'),
      structure: this.getAttribute(orgElement, 'structure') || 'hierarchical',
      objectivesGlobalToSystem: this.getAttribute(orgElement, 'adlseq:objectivesGlobalToSystem') === 'true',
      sharedDataGlobalToSystem: this.getAttribute(orgElement, 'adlcp:sharedDataGlobalToSystem') === 'true',
      items: this.parseItems(orgElement, basePath),
      sequencing: this.parseSequencing(orgElement),
      metadata: this.parseMetadata(orgElement, basePath)
    };
  }

  /**
   * Parse resources section
   * @param {Element} manifestElement - Manifest root element
   * @param {string} basePath - Base path for resolving URLs
   * @returns {Array} Array of resource objects
   */
  parseResources(manifestElement, basePath) {
    const resourcesElement =
      this.selectFirstNS(manifestElement, ['imscp:resources', 'resources']);
    if (!resourcesElement) {
      throw new ParserError({
        code: ParserErrorCode.PARSE_VALIDATION_ERROR,
        message: 'Manifest missing required resources element',
        detail: { path: 'manifest/resources' }
      });
    }

    const resources = [];
    const resourceElements = this.selectChildrenNS(resourcesElement, ['imscp:resource', 'resource']);

    const ids = new Set();
    for (const resourceElement of resourceElements) {
      const r = this.parseResource(resourceElement, basePath);
      if (r.identifier) {
        if (ids.has(r.identifier)) {
          throw new ParserError({
            code: ParserErrorCode.PARSE_VALIDATION_ERROR,
            message: `Duplicate resource identifier: ${r.identifier}`
          });
        }
        ids.add(r.identifier);
      }
      if (!r.scormType) {
        r.scormType = 'asset';
      }
      resources.push(r);
    }

    return resources;
  }

  /**
   * Parse single resource
   * @param {Element} resourceElement - Resource element
   * @param {string} basePath - Base path for resolving URLs
   * @returns {Object} Resource information
   */
  parseResource(resourceElement, basePath) {
    const xmlBase = this.getAttribute(resourceElement, 'xml:base') || '';
    const resolvedBase = path.resolve(basePath, xmlBase);

    // Resolve attributes with namespace awareness for adlcp:scormType and xml:base
    const getAttr = (el, qn, nsMap) => {
      if (!el) return null;
      if (qn.includes(':') && el.getAttributeNS) {
        const [p, local] = qn.split(':');
        const ns = nsMap[p];
        const v = ns ? el.getAttributeNS(ns, local) : null;
        return v || el.getAttribute(qn) || null;
      }
      // null namespace for unqualified
      return (el.getAttributeNS ? el.getAttributeNS(null, qn) : null) || el.getAttribute(qn) || null;
    };
    const nsMap = this.namespaces;
    const scormTypeAttr = getAttr(resourceElement, 'adlcp:scormType', nsMap) || getAttr(resourceElement, 'scormType', nsMap);
    const hrefAttr = getAttr(resourceElement, 'href', nsMap);
    const identifier = getAttr(resourceElement, 'identifier', nsMap);

    // Validate required attributes
    if (!identifier) {
      throw new ParserError({
        code: ParserErrorCode.PARSE_VALIDATION_ERROR,
        message: 'Resource missing required identifier attribute'
      });
    }
    if (String(scormTypeAttr || '').toLowerCase() === 'sco' && !hrefAttr) {
      throw new ParserError({
        code: ParserErrorCode.PARSE_VALIDATION_ERROR,
        message: `SCO resource must have href attribute (Resource: ${identifier})`
      });
    }

    return {
      identifier,
      type: getAttr(resourceElement, 'type', nsMap),
      scormType: scormTypeAttr,
      href: hrefAttr,
      xmlBase: xmlBase,
      resolvedBase: resolvedBase,
      files: this.parseFiles(resourceElement, resolvedBase),
      dependencies: this.parseDependencies(resourceElement),
      metadata: this.parseMetadata(resourceElement, basePath)
    };
  }

  /**
   * Helper method to get attribute value
   * @param {Element} element - DOM element
   * @param {string} attributeName - Attribute name
   * @returns {string|null} Attribute value
   */
  getAttribute(element, attributeName) {
    return element.getAttribute(attributeName) || null;
  }

  /**
   * Helper method to get child element (namespace-aware and scoped)
   * IMPORTANT: getElementsByTagName() is not namespace-aware and searches
   * descendants globally. For SCORM/IMS (e.g., imsss:*), we must:
   *  - Respect the namespace prefix in tagName when provided
   *  - Restrict search to direct children to avoid picking deeper descendants
   */
  getChildElement(parent, tagName) {
    if (!parent) return null;
    const wantNs = tagName.includes(':') ? tagName.split(':')[0] : null;
    const wantLocal = tagName.includes(':') ? tagName.split(':')[1] : tagName;

    const childNodes = parent.childNodes || [];
    for (let i = 0; i < childNodes.length; i++) {
      const node = childNodes[i];
      if (!node || node.nodeType !== 1 /* ELEMENT_NODE */) continue;

      const local = node.localName || node.nodeName;
      const prefix = node.prefix || (node.nodeName.includes(':') ? node.nodeName.split(':')[0] : null);

      if (local === wantLocal) {
        if (wantNs) {
          if (prefix === wantNs) {
            return node;
          }
          if (node.namespaceURI && this.namespaces[wantNs] && node.namespaceURI === this.namespaces[wantNs]) {
            return node;
          }
        } else {
          return node;
        }
      }
    }
    return null;
  }

  /**
   * Helper method to get all child elements (namespace-aware and scoped)
   * Only returns direct children that match tagName (with optional prefix).
   */
  getChildElements(parent, tagName) {
    const results = [];
    if (!parent) return results;

    const wantNs = tagName.includes(':') ? tagName.split(':')[0] : null;
    const wantLocal = tagName.includes(':') ? tagName.split(':')[1] : tagName;

    const childNodes = parent.childNodes || [];
    for (let i = 0; i < childNodes.length; i++) {
      const node = childNodes[i];
      if (!node || node.nodeType !== 1 /* ELEMENT_NODE */) continue;

      const local = node.localName || node.nodeName;
      const prefix = node.prefix || (node.nodeName.includes(':') ? node.nodeName.split(':')[0] : null);

      if (local === wantLocal) {
        if (wantNs) {
          if (prefix === wantNs) {
            results.push(node);
            continue;
          }
          if (node.namespaceURI && this.namespaces[wantNs] && node.namespaceURI === this.namespaces[wantNs]) {
            results.push(node);
            continue;
          }
        } else {
          results.push(node);
        }
      }
    }
    return results;
  }

  /**
   * Helper method to get element text content
   * @param {Element} parent - Parent element
   * @param {string} tagName - Tag name to find
   * @returns {string|null} Text content
   */
  getElementText(parent, tagName) {
    const element = this.getChildElement(parent, tagName);
    if (!element) return null;
    const text = element.textContent;
    return typeof text === 'string' ? text.trim() : null;
  }

  // Namespace-first selection helpers to avoid duplicated collections while
  // still supporting unprefixed fallback when zero matches exist.
  selectChildrenNS(parent, orderedQualifiedNames) {
    // orderedQualifiedNames example: ['imscp:item', 'item']
    for (const qn of orderedQualifiedNames) {
      const arr = this.getChildElements(parent, qn);
      if (arr.length > 0) return arr;
    }
    return [];
  }

  selectFirstNS(parent, orderedQualifiedNames) {
    for (const qn of orderedQualifiedNames) {
      const el = this.getChildElement(parent, qn);
      if (el) return el;
    }
    return null;
  }
  /**
   * Parse items recursively
   * @param {Element} parentElement - Parent element (organization or item)
   * @param {string} basePath - Base path for resolving URLs
   * @returns {Array} Array of item objects
   */
  parseItems(parentElement, basePath) {
    const items = [];
    const itemElements = this.selectChildrenNS(parentElement, ['imscp:item', 'item']);

    const siblingIds = new Set();
    for (const itemElement of itemElements) {
      const id = this.getAttribute(itemElement, 'identifier');
      if (id) {
        if (siblingIds.has(id)) {
          throw new ParserError({
            code: ParserErrorCode.PARSE_VALIDATION_ERROR,
            message: `Duplicate item identifier at same level: ${id}`,
            detail: { parent: parentElement?.getAttribute?.('identifier') || parentElement?.localName || 'node' }
          });
        }
        siblingIds.add(id);
      }

      items.push({
        identifier: id,
        identifierref: this.getAttribute(itemElement, 'identifierref'),
        isvisible: this.getAttribute(itemElement, 'isvisible') !== 'false',
        parameters: this.getAttribute(itemElement, 'parameters'),
        title: this.getElementText(itemElement, 'title'),
        children: this.parseItems(itemElement, basePath),
        sequencing: this.parseSequencing(itemElement),
        metadata: this.parseMetadata(itemElement, basePath)
      });
    }
    return items;
  }

  /**
   * Parse sequencing information
   * @param {Element} element - Parent element (organization or item)
   * @returns {Object|null} Sequencing information
   */
  parseSequencing(element) {
    // Namespace-aware lookup for sequencing
    // Prefer imsss namespace; accept matching namespaceURI even if prefix differs
    const sequencingElement = this.getChildElement(element, 'imsss:sequencing')
      || this.getChildElement(element, 'sequencing'); // fallback if parser stripped prefix but namespaceURI matches in helper
    if (!sequencingElement) return null;

    return {
      controlMode: this.parseControlMode(sequencingElement),
      sequencingRules: this.parseSequencingRules(sequencingElement),
      limitConditions: this.parseLimitConditions(sequencingElement),
      rollupRules: this.parseRollupRules(sequencingElement),
      objectives: this.parseObjectives(sequencingElement),
      randomizationControls: this.parseRandomizationControls(sequencingElement),
      deliveryControls: this.parseDeliveryControls(sequencingElement)
    };
  }

  /**
   * Parse files within a resource
   * @param {Element} resourceElement - Resource element
   * @param {string} resolvedBase - Resolved base path for the resource
   * @returns {Array} Array of file objects
   */
  parseFiles(resourceElement, resolvedBase) {
    const files = [];
    const fileElements = this.getChildElements(resourceElement, 'file');
    for (const fileElement of fileElements) {
      files.push({
        href: this.getAttribute(fileElement, 'href'),
        resolvedPath: path.resolve(resolvedBase, this.getAttribute(fileElement, 'href'))
      });
    }
    return files;
  }

  /**
   * Parse dependencies within a resource
   * @param {Element} resourceElement - Resource element
   * @returns {Array} Array of dependency objects
   */
  parseDependencies(resourceElement) {
    const dependencies = [];
    const dependencyElements = this.getChildElements(resourceElement, 'dependency');
    for (const dependencyElement of dependencyElements) {
      dependencies.push({
        identifierref: this.getAttribute(dependencyElement, 'identifierref')
      });
    }
    return dependencies;
  }

  /**
   * Parse LOM metadata
   * @param {Element} metadataElement - Metadata element
   * @returns {Object|null} LOM metadata
   */
  parseLOMMetadata(metadataElement) {
    const lomElement = this.getChildElement(metadataElement, 'lom');
    if (!lomElement) return null;

    return {
      general: this.parseLOMGeneral(lomElement),
      lifecycle: this.parseLOMLifecycle(lomElement),
      metaMetadata: this.parseLOMMetaMetadata(lomElement),
      technical: this.parseLOMTechnical(lomElement),
      educational: this.parseLOMEducational(lomElement),
      rights: this.parseLOMRights(lomElement),
      relation: this.parseLOMRelation(lomElement),
      annotation: this.parseLOMAnnotation(lomElement),
      classification: this.parseLOMClassification(lomElement)
    };
  }

  /**
   * Parse sub-manifests (organizations within organizations)
   * @param {Element} manifestElement - Manifest root element
   * @param {string} basePath - Base path for resolving URLs
   * @returns {Array} Array of sub-manifest objects
   */
  parseSubManifests(manifestElement, basePath) {
    // This method would handle <manifest> elements nested within other <manifest> elements
    // which is not common in SCORM but allowed by IMS CP.
    // For SCORM, organizations are typically top-level within the main manifest.
    return [];
  }

  /**
   * Parse controlMode element
   * @param {Element} sequencingElement - Sequencing element
   * @returns {Object|null} Control mode information
   */
  parseControlMode(sequencingElement) {
    const controlModeElement = this.getChildElement(sequencingElement, 'imsss:controlMode')
      || this.getChildElement(sequencingElement, 'controlMode');
    if (!controlModeElement) return null;

    return {
      choice: this.getAttribute(controlModeElement, 'choice') === 'true',
      flow: this.getAttribute(controlModeElement, 'flow') === 'true',
      forwardOnly: this.getAttribute(controlModeElement, 'forwardOnly') === 'true',
      choiceExit: this.getAttribute(controlModeElement, 'choiceExit') === 'true',
      flowExit: this.getAttribute(controlModeElement, 'flowExit') === 'true',
      trackLMS: this.getAttribute(controlModeElement, 'trackLMS') === 'true',
      trackSCO: this.getAttribute(controlModeElement, 'trackSCO') === 'true',
      useCurrentAttemptObjectiveInfo: this.getAttribute(controlModeElement, 'useCurrentAttemptObjectiveInfo') === 'true',
      useCurrentAttemptProgressInfo: this.getAttribute(controlModeElement, 'useCurrentAttemptProgressInfo') === 'true'
    };
  }

  /**
   * Parse sequencingRules element
   * @param {Element} sequencingElement - Sequencing element
   * @returns {Object|null} Sequencing rules information
   */
  parseSequencingRules(sequencingElement) {
    const sequencingRulesElement = this.getChildElement(sequencingElement, 'imsss:sequencingRules');
    if (!sequencingRulesElement) return null;

    return {
      preConditionRules: this.parseRules(sequencingRulesElement, 'imsss:preConditionRule'),
      postConditionRules: this.parseRules(sequencingRulesElement, 'imsss:postConditionRule'),
      exitConditionRules: this.parseRules(sequencingRulesElement, 'imsss:exitConditionRule')
    };
  }

  /**
   * Helper to parse rule elements (preConditionRule, postConditionRule, exitConditionRule)
   * @param {Element} parentElement - Parent element (sequencingRules)
   * @param {string} tagName - Tag name of the rule element
   * @returns {Array} Array of rule objects
   */
  parseRules(parentElement, tagName) {
    const rules = [];
    const ruleElements = this.getChildElements(parentElement, tagName);
    for (const ruleElement of ruleElements) {
      rules.push({
        conditions: this.parseConditions(ruleElement),
        actions: this.parseRuleActions(ruleElement)
      });
    }
    return rules;
  }

  /**
   * Parse conditions element
   * @param {Element} ruleElement - Rule element
   * @returns {Object|null} Conditions information
   */
  parseConditions(ruleElement) {
    const conditionsElement = this.getChildElement(ruleElement, 'imsss:ruleConditions')
      || this.getChildElement(ruleElement, 'ruleConditions');
    if (!conditionsElement) return null;

    return {
      conditionCombination: this.getAttribute(conditionsElement, 'conditionCombination') || 'all',
      conditions: (this.getChildElements(conditionsElement, 'imsss:ruleCondition')
        .concat(this.getChildElements(conditionsElement, 'ruleCondition'))).map(conditionElement => ({
        condition: this.getAttribute(conditionElement, 'condition'),
        operator: this.getAttribute(conditionElement, 'operator') || 'noOp',
        measureThreshold: this.getAttribute(conditionElement, 'measureThreshold'),
        referencedObjective: this.getAttribute(conditionElement, 'referencedObjective')
      }))
    };
  }

  /**
   * Parse ruleActions element
   * @param {Element} ruleElement - Rule element
   * @returns {Object|null} Rule actions information
   */
  parseRuleActions(ruleElement) {
    const actionsElement = this.getChildElement(ruleElement, 'imsss:ruleActions')
      || this.getChildElement(ruleElement, 'ruleActions');
    if (!actionsElement) return null;

    return {
      action: this.getAttribute(actionsElement, 'action')
    };
  }

  /**
   * Parse limitConditions element
   * @param {Element} sequencingElement - Sequencing element
   * @returns {Object|null} Limit conditions information
   */
  parseLimitConditions(sequencingElement) {
    const limitConditionsElement = this.getChildElement(sequencingElement, 'imsss:limitConditions');
    if (!limitConditionsElement) return null;

    return {
      attemptLimit: this.getAttribute(limitConditionsElement, 'attemptLimit'),
      attemptAbsoluteDurationLimit: this.getAttribute(limitConditionsElement, 'attemptAbsoluteDurationLimit'),
      attemptExperiencedDurationLimit: this.getAttribute(limitConditionsElement, 'attemptExperiencedDurationLimit')
    };
  }

  /**
   * Parse rollupRules element
   * @param {Element} sequencingElement - Sequencing element
   * @returns {Object|null} Rollup rules information
   */
  parseRollupRules(sequencingElement) {
    const rollupRulesElement = this.getChildElement(sequencingElement, 'imsss:rollupRules')
      || this.getChildElement(sequencingElement, 'rollupRules');
    if (!rollupRulesElement) return null;

    return {
      rollupObjectiveSatisfied: this.getAttribute(rollupRulesElement, 'rollupObjectiveSatisfied') === 'true',
      rollupProgressCompletion: this.getAttribute(rollupRulesElement, 'rollupProgressCompletion') === 'true',
      rollupTrackingAttempts: this.getAttribute(rollupRulesElement, 'rollupTrackingAttempts') === 'true',
      rollupSuccess: this.getAttribute(rollupRulesElement, 'rollupSuccess'),
      rollupProgress: this.getAttribute(rollupRulesElement, 'rollupProgress'),
      rollupConsiderations: this.parseRollupConsiderations(rollupRulesElement),
      rollupRules: this.parseRules(rollupRulesElement, 'imsss:rollupRule')
    };
  }

  /**
   * Parse rollupConsiderations element
   * @param {Element} rollupRulesElement - Rollup rules element
   * @returns {Object|null} Rollup considerations information
   */
  parseRollupConsiderations(rollupRulesElement) {
    const rollupConsiderationsElement = this.getChildElement(rollupRulesElement, 'imsss:rollupConsiderations')
      || this.getChildElement(rollupRulesElement, 'rollupConsiderations');
    if (!rollupConsiderationsElement) return null;

    return {
      measureSatisfactionIfActive: this.getAttribute(rollupConsiderationsElement, 'measureSatisfactionIfActive') === 'true',
      contributeToRollup: this.getAttribute(rollupConsiderationsElement, 'contributeToRollup'),
      requiredForSatisfied: this.getAttribute(rollupConsiderationsElement, 'requiredForSatisfied'),
      requiredForNotSatisfied: this.getAttribute(rollupConsiderationsElement, 'requiredForNotSatisfied'),
      requiredForCompleted: this.getAttribute(rollupConsiderationsElement, 'requiredForCompleted'),
      requiredForIncomplete: this.getAttribute(rollupConsiderationsElement, 'requiredForIncomplete')
    };
  }

  /**
   * Parse objectives element
   * @param {Element} sequencingElement - Sequencing element
   * @returns {Object|null} Objectives information
   */
  parseObjectives(sequencingElement) {
    const objectivesElement = this.getChildElement(sequencingElement, 'imsss:objectives')
      || this.getChildElement(sequencingElement, 'objectives');
    if (!objectivesElement) return null;

    return {
      primaryObjective: this.parseObjective(objectivesElement, 'imsss:primaryObjective'),
      objectives: this.getChildElements(objectivesElement, 'imsss:objective').map(objElement => this.parseObjective(objElement))
    };
  }

  /**
   * Helper to parse a single objective element
   * @param {Element} parentElement - Parent element (objectives or primaryObjective)
   * @param {string} [tagName='imsss:objective'] - Tag name of the objective element
   * @returns {Object|null} Objective information
   */
  parseObjective(parentElement, tagName = 'imsss:objective') {
    const objectiveElement = this.getChildElement(parentElement, tagName)
      || (tagName === 'imsss:objective' ? this.getChildElement(parentElement, 'objective') : null);
    if (!objectiveElement) return null;

    return {
      satisfiedByMeasure: this.getAttribute(objectiveElement, 'satisfiedByMeasure') === 'true',
      objectiveID: this.getAttribute(objectiveElement, 'objectiveID'),
      minNormalizedMeasure: this.getElementText(objectiveElement, 'imsss:minNormalizedMeasure'),
      mapInfo: this.parseMapInfo(objectiveElement)
    };
  }

  /**
   * Parse mapInfo element
   * @param {Element} objectiveElement - Objective element
   * @returns {Object|null} Map info information
   */
  parseMapInfo(objectiveElement) {
    const mapInfoElement = this.getChildElement(objectiveElement, 'imsss:mapInfo')
      || this.getChildElement(objectiveElement, 'mapInfo');
    if (!mapInfoElement) return null;

    return {
      targetObjectiveID: this.getAttribute(mapInfoElement, 'targetObjectiveID'),
      readSatisfiedStatus: this.getAttribute(mapInfoElement, 'readSatisfiedStatus') === 'true',
      readNormalizedMeasure: this.getAttribute(mapInfoElement, 'readNormalizedMeasure') === 'true',
      writeSatisfiedStatus: this.getAttribute(mapInfoElement, 'writeSatisfiedStatus') === 'true',
      writeNormalizedMeasure: this.getAttribute(mapInfoElement, 'writeNormalizedMeasure') === 'true'
    };
  }

  /**
   * Parse randomizationControls element
   * @param {Element} sequencingElement - Sequencing element
   * @returns {Object|null} Randomization controls information
   */
  parseRandomizationControls(sequencingElement) {
    const randomizationControlsElement = this.getChildElement(sequencingElement, 'imsss:randomizationControls')
      || this.getChildElement(sequencingElement, 'randomizationControls');
    if (!randomizationControlsElement) return null;

    return {
      randomizationTiming: this.getAttribute(randomizationControlsElement, 'randomizationTiming'),
      reorderChildren: this.getAttribute(randomizationControlsElement, 'reorderChildren') === 'true',
      selectionCount: this.getAttribute(randomizationControlsElement, 'selectionCount'),
      selectionTiming: this.getAttribute(randomizationControlsElement, 'selectionTiming')
    };
  }

  /**
   * Parse deliveryControls element
   * @param {Element} sequencingElement - Sequencing element
   * @returns {Object|null} Delivery controls information
   */
  parseDeliveryControls(sequencingElement) {
    const deliveryControlsElement = this.getChildElement(sequencingElement, 'imsss:deliveryControls')
      || this.getChildElement(sequencingElement, 'deliveryControls');
    if (!deliveryControlsElement) return null;

    return {
      tracked: this.getAttribute(deliveryControlsElement, 'tracked') === 'true',
      completionSetByContent: this.getAttribute(deliveryControlsElement, 'completionSetByContent') === 'true',
      objectiveSetByContent: this.getAttribute(deliveryControlsElement, 'objectiveSetByContent') === 'true'
    };
  }

  /**
   * Parse LOM General element
   * @param {Element} lomElement - LOM element
   * @returns {Object|null} General metadata
   */
  parseLOMGeneral(lomElement) {
    const generalElement = this.getChildElement(lomElement, 'lom:general');
    if (!generalElement) return null;

    return {
      identifier: this.parseLOMIdentifiers(generalElement),
      title: this.parseLOMLangString(generalElement, 'lom:title'),
      language: this.getElementText(generalElement, 'lom:language'),
      description: this.parseLOMLangString(generalElement, 'lom:description'),
      keyword: this.getChildElements(generalElement, 'lom:keyword').map(el => this.getElementText(el, 'lom:string')),
      coverage: this.parseLOMLangString(generalElement, 'lom:coverage'),
      structure: this.parseLOMVocabulary(generalElement, 'lom:structure'),
      aggregationLevel: this.parseLOMVocabulary(generalElement, 'lom:aggregationLevel')
    };
  }

  /**
   * Parse LOM Lifecycle element
   * @param {Element} lomElement - LOM element
   * @returns {Object|null} Lifecycle metadata
   */
  parseLOMLifecycle(lomElement) {
    const lifecycleElement = this.getChildElement(lomElement, 'lom:lifecycle');
    if (!lifecycleElement) return null;

    return {
      version: this.parseLOMLangString(lifecycleElement, 'lom:version'),
      status: this.parseLOMVocabulary(lifecycleElement, 'lom:status'),
      contribute: this.getChildElements(lifecycleElement, 'lom:contribute').map(el => ({
        role: this.parseLOMVocabulary(el, 'lom:role'),
        entity: this.getElementText(el, 'lom:entity'),
        date: this.parseLOMDateTime(el, 'lom:date')
      }))
    };
  }

  /**
   * Parse LOM MetaMetadata element
   * @param {Element} lomElement - LOM element
   * @returns {Object|null} Meta-metadata
   */
  parseLOMMetaMetadata(lomElement) {
    const metaMetadataElement = this.getChildElement(lomElement, 'lom:metaMetadata');
    if (!metaMetadataElement) return null;

    return {
      identifier: this.parseLOMIdentifiers(metaMetadataElement),
      catalogEntry: this.getChildElements(metaMetadataElement, 'lom:catalogEntry').map(el => ({
        catalog: this.getElementText(el, 'lom:catalog'),
        entry: this.parseLOMLangString(el, 'lom:entry')
      })),
      language: this.getElementText(metaMetadataElement, 'lom:language'),
      contribute: this.getChildElements(metaMetadataElement, 'lom:contribute').map(el => ({
        role: this.parseLOMVocabulary(el, 'lom:role'),
        entity: this.getElementText(el, 'lom:entity'),
        date: this.parseLOMDateTime(el, 'lom:date')
      }))
    };
  }

  /**
   * Parse LOM Technical element
   * @param {Element} lomElement - LOM element
   * @returns {Object|null} Technical metadata
   */
  parseLOMTechnical(lomElement) {
    const technicalElement = this.getChildElement(lomElement, 'lom:technical');
    if (!technicalElement) return null;

    return {
      format: this.getChildElements(technicalElement, 'lom:format').map(el => el.textContent.trim()),
      size: this.getElementText(technicalElement, 'lom:size'),
      location: this.getChildElements(technicalElement, 'lom:location').map(el => el.textContent.trim()),
      requirement: this.getChildElements(technicalElement, 'lom:requirement').map(el => ({
        orComposite: this.getChildElements(el, 'lom:orComposite').map(orEl => ({
          type: this.parseLOMVocabulary(orEl, 'lom:type'),
          name: this.parseLOMVocabulary(orEl, 'lom:name'),
          minimumVersion: this.getElementText(orEl, 'lom:minimumVersion'),
          maximumVersion: this.getElementText(orEl, 'lom:maximumVersion')
        }))
      })),
      installationRemarks: this.parseLOMLangString(technicalElement, 'lom:installationRemarks'),
      otherPlatformRequirements: this.parseLOMLangString(technicalElement, 'lom:otherPlatformRequirements'),
      duration: this.parseLOMDuration(technicalElement)
    };
  }

  /**
   * Parse LOM Educational element
   * @param {Element} lomElement - LOM element
   * @returns {Object|null} Educational metadata
   */
  parseLOMEducational(lomElement) {
    const educationalElements = this.getChildElements(lomElement, 'lom:educational');
    if (educationalElements.length === 0) return null;

    return educationalElements.map(educationalElement => ({
      interactivityType: this.parseLOMVocabulary(educationalElement, 'lom:interactivityType'),
      learningResourceType: this.parseLOMVocabulary(educationalElement, 'lom:learningResourceType'),
      interactivityLevel: this.parseLOMVocabulary(educationalElement, 'lom:interactivityLevel'),
      semanticDensity: this.parseLOMVocabulary(educationalElement, 'lom:semanticDensity'),
      intendedEndUserRole: this.parseLOMVocabulary(educationalElement, 'lom:intendedEndUserRole'),
      context: this.parseLOMVocabulary(educationalElement, 'lom:context'),
      typicalAgeRange: this.parseLOMLangString(educationalElement, 'lom:typicalAgeRange'),
      difficulty: this.parseLOMVocabulary(educationalElement, 'lom:difficulty'),
      typicalLearningTime: this.parseLOMDuration(educationalElement),
      description: this.parseLOMLangString(educationalElement, 'lom:description'),
      language: this.getElementText(educationalElement, 'lom:language')
    }));
  }

  /**
   * Parse LOM Rights element
   * @param {Element} lomElement - LOM element
   * @returns {Object|null} Rights metadata
   */
  parseLOMRights(lomElement) {
    const rightsElement = this.getChildElement(lomElement, 'lom:rights');
    if (!rightsElement) return null;

    return {
      cost: this.parseLOMVocabulary(rightsElement, 'lom:cost'),
      copyrightAndOtherRestrictions: this.parseLOMVocabulary(rightsElement, 'lom:copyrightAndOtherRestrictions'),
      description: this.parseLOMLangString(rightsElement, 'lom:description')
    };
  }

  /**
   * Parse LOM Relation element
   * @param {Element} lomElement - LOM element
   * @returns {Object|null} Relation metadata
   */
  parseLOMRelation(lomElement) {
    const relationElements = this.getChildElements(lomElement, 'lom:relation');
    if (relationElements.length === 0) return null;

    return relationElements.map(relationElement => ({
      kind: this.parseLOMVocabulary(relationElement, 'lom:kind'),
      resource: {
        identifier: this.parseLOMIdentifiers(relationElement),
        description: this.parseLOMLangString(relationElement, 'lom:description')
      }
    }));
  }

  /**
   * Parse LOM Annotation element
   * @param {Element} lomElement - LOM element
   * @returns {Object|null} Annotation metadata
   */
  parseLOMAnnotation(lomElement) {
    const annotationElements = this.getChildElements(lomElement, 'lom:annotation');
    if (annotationElements.length === 0) return null;

    return annotationElements.map(annotationElement => ({
      entity: this.getElementText(annotationElement, 'lom:entity'),
      date: this.parseLOMDateTime(annotationElement, 'lom:date'),
      description: this.parseLOMLangString(annotationElement, 'lom:description')
    }));
  }

  /**
   * Parse LOM Classification element
   * @param {Element} lomElement - LOM element
   * @returns {Object|null} Classification metadata
   */
  parseLOMClassification(lomElement) {
    const classificationElements = this.getChildElements(lomElement, 'lom:classification');
    if (classificationElements.length === 0) return null;

    return classificationElements.map(classificationElement => ({
      purpose: this.parseLOMVocabulary(classificationElement, 'lom:purpose'),
      taxonPath: this.getChildElements(classificationElement, 'lom:taxonPath').map(el => ({
        source: this.parseLOMLangString(el, 'lom:source'),
        taxon: this.getChildElements(el, 'lom:taxon').map(taxonEl => ({
          id: this.getElementText(taxonEl, 'lom:id'),
          entry: this.parseLOMLangString(taxonEl, 'lom:entry')
        }))
      })),
      description: this.parseLOMLangString(classificationElement, 'lom:description'),
      keyword: this.getChildElements(classificationElement, 'lom:keyword').map(el => this.parseLOMLangString(el, 'lom:string'))
    }));
  }

  /**
   * Helper to parse lom:langstring elements
   * @param {Element} parentElement - Parent element
   * @param {string} tagName - Tag name (e.g., 'lom:title', 'lom:description')
   * @returns {Object|null} Language string object
   */
  parseLOMLangString(parentElement, tagName) {
    const langStringElement = this.getChildElement(parentElement, tagName);
    if (!langStringElement) return null;
    const stringElement = this.getChildElement(langStringElement, 'lom:string');
    if (!stringElement) return null;
    return {
      lang: this.getAttribute(stringElement, 'xml:lang'),
      value: stringElement.textContent.trim()
    };
  }

  /**
   * Helper to parse lom:vocabulary elements
   * @param {Element} parentElement - Parent element
   * @param {string} tagName - Tag name (e.g., 'lom:structure', 'lom:status')
   * @returns {Object|null} Vocabulary object
   */
  parseLOMVocabulary(parentElement, tagName) {
    const vocabularyElement = this.getChildElement(parentElement, tagName);
    if (!vocabularyElement) return null;
    return {
      source: this.getElementText(vocabularyElement, 'lom:source'),
      value: this.getElementText(vocabularyElement, 'lom:value')
    };
  }

  /**
   * Helper to parse lom:dateTime elements
   * @param {Element} parentElement - Parent element
   * @param {string} tagName - Tag name (e.g., 'lom:date')
   * @returns {Object|null} Date time object
   */
  parseLOMDateTime(parentElement, tagName) {
    const dateTimeElement = this.getChildElement(parentElement, tagName);
    if (!dateTimeElement) return null;
    return {
      dateTime: this.getElementText(dateTimeElement, 'lom:dateTime'),
      description: this.parseLOMLangString(dateTimeElement, 'lom:description')
    };
  }

  /**
   * Helper to parse lom:duration elements
   * @param {Element} parentElement - Parent element
   * @param {string} tagName - Tag name (e.g., 'lom:duration')
   * @returns {Object|null} Duration object
   */
  parseLOMDuration(parentElement, tagName = 'lom:duration') {
    const durationElement = this.getChildElement(parentElement, tagName);
    if (!durationElement) return null;
    return {
      duration: this.getElementText(durationElement, 'lom:duration'),
      description: this.parseLOMLangString(durationElement, 'lom:description')
    };
  }

  /**
   * Helper to parse lom:identifier elements
   * @param {Element} parentElement - Parent element
   * @returns {Array} Array of identifier objects
   */
  parseLOMIdentifiers(parentElement) {
    const identifiers = [];
    const identifierElements = this.getChildElements(parentElement, 'lom:identifier');
    for (const identifierElement of identifierElements) {
      identifiers.push({
        catalog: this.getElementText(identifierElement, 'lom:catalog'),
        entry: this.getElementText(identifierElement, 'lom:entry')
      });
    }
    return identifiers.length > 0 ? identifiers : null;
  }

  // Placeholder for LOM parsing methods

  /**
   * Depth-first collect all items from a starting items array into out array.
   * @param {Array} items
   * @param {Array} out
   */
  _collectItems(items, out) {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it) continue;
      out.push(it);
      if (Array.isArray(it.children) && it.children.length > 0) {
        this._collectItems(it.children, out);
      }
    }
  }
}

module.exports = ManifestParser;