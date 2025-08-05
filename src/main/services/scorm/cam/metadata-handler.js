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
  extractMetadata(parsedMetadataObject) {
    if (!parsedMetadataObject) return null;

    try {
      const metadata = {
        schema: parsedMetadataObject.schema,
        schemaversion: parsedMetadataObject.schemaversion,
        location: parsedMetadataObject.location,
        lom: null,
        custom: {} // Custom metadata is not directly parsed by ManifestParser, so it remains empty for now
      };

      // Extract LOM metadata
      if (parsedMetadataObject.lom) {
        metadata.lom = this.extractLOMMetadata(parsedMetadataObject.lom);
      }

      // Custom metadata extraction would require re-parsing the original XML or a different approach
      // For now, we'll assume custom metadata is not passed in the parsed object.

      return metadata;
    } catch (error) {
      this.errorHandler?.setError('301', `Metadata extraction failed: ${error.message}`, 'extractMetadata');
      throw error;
    }
  }

  /**
   * Extract LOM metadata
   * @param {Object} parsedLOMObject - Parsed LOM object from ManifestParser
   * @returns {Object} LOM metadata object
   */
  extractLOMMetadata(parsedLOMObject) {
    const lom = {};

    // Extract each LOM category
    for (const [key, category] of Object.entries(this.lomCategories)) {
      if (parsedLOMObject[category]) {
        lom[category] = this.extractLOMCategory(parsedLOMObject[category], category);
      }
    }

    return lom;
  }

  /**
   * Extract LOM category data
   * @param {Object} parsedCategoryObject - Parsed category object from ManifestParser
   * @param {string} categoryName - Category name
   * @returns {Object} Category data
   */
  extractLOMCategory(parsedCategoryObject, categoryName) {
    switch (categoryName) {
      case 'general':
        return this.extractGeneralMetadata(parsedCategoryObject);
      case 'lifecycle':
        return this.extractLifecycleMetadata(parsedCategoryObject);
      case 'technical':
        return this.extractTechnicalMetadata(parsedCategoryObject);
      case 'educational':
        return this.extractEducationalMetadata(parsedCategoryObject);
      case 'rights':
        return this.extractRightsMetadata(parsedCategoryObject);
      default:
        // For other categories, return the object as is if it's already parsed
        return parsedCategoryObject;
    }
  }

  /**
   * Extract general metadata
   * @param {Object} generalObject - General category object
   * @returns {Object} General metadata
   */
  extractGeneralMetadata(generalObject) {
    return {
      identifier: generalObject.identifier,
      title: generalObject.title,
      language: generalObject.language,
      description: generalObject.description,
      keyword: generalObject.keyword,
      coverage: generalObject.coverage,
      structure: generalObject.structure,
      aggregationLevel: generalObject.aggregationLevel
    };
  }

  /**
   * Extract lifecycle metadata
   * @param {Object} lifecycleObject - Lifecycle category object
   * @returns {Object} Lifecycle metadata
   */
  extractLifecycleMetadata(lifecycleObject) {
    return {
      version: lifecycleObject.version,
      status: lifecycleObject.status,
      contribute: lifecycleObject.contribute
    };
  }

  /**
   * Extract technical metadata
   * @param {Object} technicalObject - Technical category object
   * @returns {Object} Technical metadata
   */
  extractTechnicalMetadata(technicalObject) {
    return {
      format: technicalObject.format,
      size: technicalObject.size,
      location: technicalObject.location,
      requirement: technicalObject.requirement,
      installationRemarks: technicalObject.installationRemarks,
      otherPlatformRequirements: technicalObject.otherPlatformRequirements,
      duration: technicalObject.duration
    };
  }

  /**
   * Extract educational metadata
   * @param {Object} educationalObject - Educational category object
   * @returns {Object} Educational metadata
   */
  extractEducationalMetadata(educationalObject) {
    return {
      interactivityType: educationalObject.interactivityType,
      learningResourceType: educationalObject.learningResourceType,
      interactivityLevel: educationalObject.interactivityLevel,
      semanticDensity: educationalObject.semanticDensity,
      intendedEndUserRole: educationalObject.intendedEndUserRole,
      context: educationalObject.context,
      typicalAgeRange: educationalObject.typicalAgeRange,
      difficulty: educationalObject.difficulty,
      typicalLearningTime: educationalObject.typicalLearningTime,
      description: educationalObject.description,
      language: educationalObject.language
    };
  }

  /**
   * Extract rights metadata
   * @param {Object} rightsObject - Rights category object
   * @returns {Object} Rights metadata
   */
  extractRightsMetadata(rightsObject) {
    return {
      cost: rightsObject.cost,
      copyrightAndOtherRestrictions: rightsObject.copyrightAndOtherRestrictions,
      description: rightsObject.description
    };
  }

  /**
   * Extract custom metadata elements (not applicable for already parsed object)
   * @param {Object} parsedMetadataObject - Parsed metadata object
   * @returns {Object} Custom metadata (empty for now)
   */
  extractCustomMetadata(parsedMetadataObject) {
    // Custom metadata is not directly parsed by ManifestParser, so it remains empty for now
    return {};
  }

  // Helper methods for metadata extraction (no longer needed as we work with parsed objects)
  // These methods were for DOM manipulation and are now obsolete.
  // Keeping them commented out for reference during refactoring.

  // getChildElement(parent, tagName) { /* ... */ }
  // getChildElementNS(parent, namespace, tagName) { /* ... */ }
  // getElementText(parent, tagName) { /* ... */ }
  // extractLangString(parent, tagName) { /* ... */ }
  // extractVocabulary(parent, tagName) { /* ... */ }
  // extractIdentifier(parent) { /* ... */ }
  // extractLanguages(parent) { /* ... */ }
  // extractKeywords(parent) { /* ... */ }
  // extractMultipleValues(parent, tagName) { /* ... */ }
  // extractVocabularyArray(parent, tagName) { /* ... */ }
  // extractLangStringArray(parent, tagName) { /* ... */ }
  // extractContributions(parent) { /* ... */ }
  // extractRequirements(parent) { /* ... */ }
  // extractOrComposite(parent) { /* ... */ }
  // extractDuration(parent) { /* ... */ }
  // extractDateTime(parent) { /* ... */ }
  // extractElementValue(element) { /* ... */ }
  // extractGenericCategory(categoryElement) { /* ... */ }
}

module.exports = MetadataHandler;