/**
 * SCORM 2004 4th Edition Metadata Handler
 * 
 * Processes Learning Object Metadata (LOM) according to:
 * - IEEE 1484.12.1 Learning Object Metadata standard
 * - SCORM 2004 4th Edition Content Aggregation Model specification
 * - IMS Metadata specification
 * 
 * Features:
 * - LOM metadata extraction and parsing
 * - Metadata validation and normalization
 * - Dublin Core compatibility
 * - Custom SCORM metadata handling
 * - Metadata inheritance processing
 * 
 * @fileoverview SCORM metadata handler implementation
 */

const SCORM_CONSTANTS = require('../../../../shared/constants/scorm-constants');

/**
 * SCORM Metadata Handler
 * 
 * Handles extraction, validation, and processing of metadata from
 * SCORM packages including LOM and custom SCORM metadata.
 */
class MetadataHandler {
  constructor(errorHandler) {
    this.errorHandler = errorHandler;
    
    // LOM category mappings
    this.lomCategories = {
      GENERAL: 'general',
      LIFECYCLE: 'lifecycle', 
      META_METADATA: 'metaMetadata',
      TECHNICAL: 'technical',
      EDUCATIONAL: 'educational',
      RIGHTS: 'rights',
      RELATION: 'relation',
      ANNOTATION: 'annotation',
      CLASSIFICATION: 'classification'
    };

    // Dublin Core to LOM mappings
    this.dublinCoreMapping = {
      'dc:title': 'general.title',
      'dc:creator': 'lifecycle.contribute.entity',
      'dc:subject': 'general.keyword',
      'dc:description': 'general.description',
      'dc:publisher': 'lifecycle.contribute.entity',
      'dc:contributor': 'lifecycle.contribute.entity',
      'dc:date': 'lifecycle.contribute.date',
      'dc:type': 'educational.learningResourceType',
      'dc:format': 'technical.format',
      'dc:identifier': 'general.identifier',
      'dc:source': 'relation.resource.identifier',
      'dc:language': 'general.language',
      'dc:relation': 'relation.resource.identifier',
      'dc:coverage': 'general.coverage',
      'dc:rights': 'rights.description'
    };
  }

  /**
   * Extract metadata from manifest element
   * @param {Element} metadataElement - Metadata DOM element
   * @param {string} basePath - Base path for resolving metadata files
   * @returns {Object} Extracted metadata object
   */
  extractMetadata(metadataElement, basePath = '') {
    if (!metadataElement) return null;

    try {
      const metadata = {
        schema: this.getElementText(metadataElement, 'schema'),
        schemaversion: this.getElementText(metadataElement, 'schemaversion'),
        location: this.getElementText(metadataElement, 'location'),
        lom: null,
        custom: {}
      };

      // Extract LOM metadata
      const lomElement = this.getChildElementNS(metadataElement, 'lom', 'lom');
      if (lomElement) {
        metadata.lom = this.extractLOMMetadata(lomElement);
      }

      // Extract custom metadata elements
      metadata.custom = this.extractCustomMetadata(metadataElement);

      return metadata;
    } catch (error) {
      this.errorHandler?.setError('301', `Metadata extraction failed: ${error.message}`, 'extractMetadata');
      throw error;
    }
  }

  /**
   * Extract LOM metadata
   * @param {Element} lomElement - LOM root element
   * @returns {Object} LOM metadata object
   */
  extractLOMMetadata(lomElement) {
    const lom = {};

    // Extract each LOM category
    for (const [key, category] of Object.entries(this.lomCategories)) {
      const categoryElement = this.getChildElement(lomElement, category);
      if (categoryElement) {
        lom[category] = this.extractLOMCategory(categoryElement, category);
      }
    }

    return lom;
  }

  /**
   * Extract LOM category data
   * @param {Element} categoryElement - Category DOM element
   * @param {string} categoryName - Category name
   * @returns {Object} Category data
   */
  extractLOMCategory(categoryElement, categoryName) {
    switch (categoryName) {
      case 'general':
        return this.extractGeneralMetadata(categoryElement);
      case 'lifecycle':
        return this.extractLifecycleMetadata(categoryElement);
      case 'technical':
        return this.extractTechnicalMetadata(categoryElement);
      case 'educational':
        return this.extractEducationalMetadata(categoryElement);
      case 'rights':
        return this.extractRightsMetadata(categoryElement);
      default:
        return this.extractGenericCategory(categoryElement);
    }
  }

  /**
   * Extract general metadata
   * @param {Element} generalElement - General category element
   * @returns {Object} General metadata
   */
  extractGeneralMetadata(generalElement) {
    return {
      identifier: this.extractIdentifier(generalElement),
      title: this.extractLangString(generalElement, 'title'),
      language: this.extractLanguages(generalElement),
      description: this.extractLangString(generalElement, 'description'),
      keyword: this.extractKeywords(generalElement),
      coverage: this.extractLangString(generalElement, 'coverage'),
      structure: this.extractVocabulary(generalElement, 'structure'),
      aggregationLevel: this.extractVocabulary(generalElement, 'aggregationLevel')
    };
  }

  /**
   * Extract lifecycle metadata
   * @param {Element} lifecycleElement - Lifecycle category element
   * @returns {Object} Lifecycle metadata
   */
  extractLifecycleMetadata(lifecycleElement) {
    return {
      version: this.extractLangString(lifecycleElement, 'version'),
      status: this.extractVocabulary(lifecycleElement, 'status'),
      contribute: this.extractContributions(lifecycleElement)
    };
  }

  /**
   * Extract technical metadata
   * @param {Element} technicalElement - Technical category element
   * @returns {Object} Technical metadata
   */
  extractTechnicalMetadata(technicalElement) {
    return {
      format: this.extractMultipleValues(technicalElement, 'format'),
      size: this.getElementText(technicalElement, 'size'),
      location: this.extractMultipleValues(technicalElement, 'location'),
      requirement: this.extractRequirements(technicalElement),
      installationRemarks: this.extractLangString(technicalElement, 'installationRemarks'),
      otherPlatformRequirements: this.extractLangString(technicalElement, 'otherPlatformRequirements'),
      duration: this.extractDuration(technicalElement)
    };
  }

  /**
   * Extract educational metadata
   * @param {Element} educationalElement - Educational category element
   * @returns {Object} Educational metadata
   */
  extractEducationalMetadata(educationalElement) {
    return {
      interactivityType: this.extractVocabulary(educationalElement, 'interactivityType'),
      learningResourceType: this.extractVocabularyArray(educationalElement, 'learningResourceType'),
      interactivityLevel: this.extractVocabulary(educationalElement, 'interactivityLevel'),
      semanticDensity: this.extractVocabulary(educationalElement, 'semanticDensity'),
      intendedEndUserRole: this.extractVocabularyArray(educationalElement, 'intendedEndUserRole'),
      context: this.extractVocabularyArray(educationalElement, 'context'),
      typicalAgeRange: this.extractLangStringArray(educationalElement, 'typicalAgeRange'),
      difficulty: this.extractVocabulary(educationalElement, 'difficulty'),
      typicalLearningTime: this.extractDuration(educationalElement),
      description: this.extractLangString(educationalElement, 'description'),
      language: this.extractLanguages(educationalElement)
    };
  }

  /**
   * Extract rights metadata
   * @param {Element} rightsElement - Rights category element
   * @returns {Object} Rights metadata
   */
  extractRightsMetadata(rightsElement) {
    return {
      cost: this.extractVocabulary(rightsElement, 'cost'),
      copyrightAndOtherRestrictions: this.extractVocabulary(rightsElement, 'copyrightAndOtherRestrictions'),
      description: this.extractLangString(rightsElement, 'description')
    };
  }

  /**
   * Extract custom metadata elements
   * @param {Element} metadataElement - Metadata root element
   * @returns {Object} Custom metadata
   */
  extractCustomMetadata(metadataElement) {
    const custom = {};
    
    // Extract any non-standard metadata elements
    const children = Array.from(metadataElement.childNodes);
    for (const child of children) {
      if (child.nodeType === 1 && // Element node
          !['schema', 'schemaversion', 'location', 'lom'].includes(child.localName)) {
        custom[child.localName] = this.extractElementValue(child);
      }
    }

    return custom;
  }

  // Helper methods for metadata extraction
  getChildElement(parent, tagName) {
    const children = parent.getElementsByTagName(tagName);
    return children.length > 0 ? children[0] : null;
  }

  getChildElementNS(parent, namespace, tagName) {
    const children = parent.getElementsByTagNameNS(namespace, tagName);
    return children.length > 0 ? children[0] : null;
  }

  getElementText(parent, tagName) {
    const element = this.getChildElement(parent, tagName);
    return element ? element.textContent.trim() : null;
  }

  extractLangString(parent, tagName) {
    const element = this.getChildElement(parent, tagName);
    if (!element) return null;
    
    return {
      value: element.textContent.trim(),
      language: element.getAttribute('xml:lang') || element.getAttribute('lang') || 'en'
    };
  }

  extractVocabulary(parent, tagName) {
    const element = this.getChildElement(parent, tagName);
    if (!element) return null;
    
    const sourceElement = this.getChildElement(element, 'source');
    const valueElement = this.getChildElement(element, 'value');
    
    return {
      source: sourceElement ? sourceElement.textContent.trim() : null,
      value: valueElement ? valueElement.textContent.trim() : null
    };
  }

  extractIdentifier(parent) {
    const identifierElement = this.getChildElement(parent, 'identifier');
    if (!identifierElement) return null;
    
    return {
      catalog: this.getElementText(identifierElement, 'catalog'),
      entry: this.getElementText(identifierElement, 'entry')
    };
  }

  extractLanguages(parent) {
    const elements = parent.getElementsByTagName('language');
    return Array.from(elements).map(el => el.textContent.trim());
  }

  extractKeywords(parent) {
    const elements = parent.getElementsByTagName('keyword');
    return Array.from(elements).map(el => this.extractLangString(el.parentNode, 'keyword'));
  }

  extractMultipleValues(parent, tagName) {
    const elements = parent.getElementsByTagName(tagName);
    return Array.from(elements).map(el => el.textContent.trim());
  }

  extractVocabularyArray(parent, tagName) {
    const elements = parent.getElementsByTagName(tagName);
    return Array.from(elements).map(el => this.extractVocabulary(el.parentNode, tagName));
  }

  extractLangStringArray(parent, tagName) {
    const elements = parent.getElementsByTagName(tagName);
    return Array.from(elements).map(el => this.extractLangString(el.parentNode, tagName));
  }

  extractContributions(parent) {
    const elements = parent.getElementsByTagName('contribute');
    return Array.from(elements).map(el => ({
      role: this.extractVocabulary(el, 'role'),
      entity: this.extractMultipleValues(el, 'entity'),
      date: this.extractDateTime(el)
    }));
  }

  extractRequirements(parent) {
    const elements = parent.getElementsByTagName('requirement');
    return Array.from(elements).map(el => ({
      orComposite: this.extractOrComposite(el)
    }));
  }

  extractOrComposite(parent) {
    return {
      type: this.extractVocabulary(parent, 'type'),
      name: this.extractVocabulary(parent, 'name'),
      minimumVersion: this.getElementText(parent, 'minimumVersion'),
      maximumVersion: this.getElementText(parent, 'maximumVersion')
    };
  }

  extractDuration(parent) {
    const durationElement = this.getChildElement(parent, 'typicalLearningTime') || 
                           this.getChildElement(parent, 'duration');
    if (!durationElement) return null;
    
    return {
      duration: this.getElementText(durationElement, 'duration'),
      description: this.extractLangString(durationElement, 'description')
    };
  }

  extractDateTime(parent) {
    const dateElement = this.getChildElement(parent, 'date');
    if (!dateElement) return null;
    
    return {
      dateTime: this.getElementText(dateElement, 'dateTime'),
      description: this.extractLangString(dateElement, 'description')
    };
  }

  extractElementValue(element) {
    if (element.children.length === 0) {
      return element.textContent.trim();
    }
    
    const result = {};
    for (const child of element.children) {
      result[child.localName] = this.extractElementValue(child);
    }
    return result;
  }

  extractGenericCategory(categoryElement) {
    return this.extractElementValue(categoryElement);
  }
}

module.exports = MetadataHandler;