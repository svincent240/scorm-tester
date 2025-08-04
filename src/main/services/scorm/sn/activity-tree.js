/**
 * SCORM 2004 4th Edition Activity Tree Manager
 * 
 * Builds and manages hierarchical activity structures from CAM manifest data.
 * Handles activity state tracking, attempt management, and tree traversal
 * according to SCORM 2004 4th Edition Sequencing and Navigation specification.
 * 
 * @fileoverview Activity tree construction and management
 */

const { 
  SN_ERROR_CODES, 
  ACTIVITY_STATES, 
  ATTEMPT_STATES, 
  SN_DEFAULTS 
} = require('../../../../shared/constants/sn-constants');

/**
 * Activity Node Class
 * Represents a single activity in the activity tree
 */
class ActivityNode {
  constructor(item, resource = null, parent = null) {
    this.identifier = item.identifier;
    this.title = item.title || '';
    this.parent = parent;
    this.children = [];
    this.resource = resource;
    
    // Activity state tracking
    this.activityState = ACTIVITY_STATES.INACTIVE;
    this.attemptState = ATTEMPT_STATES.NOT_ATTEMPTED;
    this.attemptCount = 0;
    this.suspended = false;
    
    // Sequencing information from manifest
    this.sequencing = item.sequencing || {};
    this.isVisible = item.isvisible !== false;
    this.parameters = item.parameters || '';
    
    // Objective tracking
    this.objectives = new Map();
    this.primaryObjective = null;
    
    // Delivery tracking
    this.deliveryStarted = false;
    this.deliveryCompleted = false;
    
    // Timestamps
    this.createdAt = new Date();
    this.lastAccessedAt = null;
  }

  /**
   * Add child activity
   * @param {ActivityNode} child - Child activity node
   */
  addChild(child) {
    child.parent = this;
    this.children.push(child);
  }

  /**
   * Check if activity is a leaf (has no children)
   * @returns {boolean} True if leaf activity
   */
  isLeaf() {
    return this.children.length === 0;
  }

  /**
   * Check if activity is launchable (has associated resource)
   * @returns {boolean} True if launchable
   */
  isLaunchable() {
    if (!this.resource) {
      return false;
    }
    return this.resource.scormType === 'sco';
  }

  /**
   * Get activity depth in tree
   * @returns {number} Depth level (root = 0)
   */
  getDepth() {
    let depth = 0;
    let current = this.parent;
    while (current) {
      depth++;
      current = current.parent;
    }
    return depth;
  }

  /**
   * Update activity state
   * @param {string} newState - New activity state
   */
  setState(newState) {
    if (Object.values(ACTIVITY_STATES).includes(newState)) {
      this.activityState = newState;
      this.lastAccessedAt = new Date();
    }
  }
}

/**
 * Activity Tree Manager Class
 * Manages the complete activity tree structure and operations
 */
class ActivityTreeManager {
  constructor(errorHandler, logger) {
    this.errorHandler = errorHandler;
    this.logger = logger;
    this.root = null;
    this.activities = new Map(); // identifier -> ActivityNode
    this.currentActivity = null;
    this.globalObjectives = new Map();
    
    this.logger?.debug('ActivityTreeManager initialized');
  }

  /**
   * Build activity tree from CAM manifest data
   * @param {Object} manifest - Parsed CAM manifest
   * @returns {boolean} True if successful
   */
  buildTree(manifest) {
    try {
      if (!manifest.organizations || !manifest.organizations.organizations) {
        this.errorHandler?.setError(SN_ERROR_CODES.INVALID_ACTIVITY_TREE,
          'No organizations found in manifest', 'buildTree');
        return false;
      }

      // Use default organization or first available
      const defaultOrgId = manifest.organizations.default;
      const organization = manifest.organizations.organizations.find(org => 
        org.identifier === defaultOrgId) || manifest.organizations.organizations[0];

      if (!organization) {
        this.errorHandler?.setError(SN_ERROR_CODES.INVALID_ACTIVITY_TREE,
          'No valid organization found', 'buildTree');
        return false;
      }

      // Create resource lookup map
      const resourceMap = new Map();
      if (manifest.resources) {
        manifest.resources.forEach(resource => {
          resourceMap.set(resource.identifier, resource);
        });
      }

      // Build tree from organization
      this.root = this.buildActivityNode(organization, resourceMap);
      if (!this.root) {
        return false;
      }

      // Build items recursively
      if (organization.items) {
        const visitedIds = new Set([organization.identifier]);
        for (const item of organization.items) {
          const childNode = this.buildActivityNode(item, resourceMap, this.root, visitedIds);
          if (!childNode) {
            return false; // Stop if any child fails to build
          }
          this.root.addChild(childNode);
          if (!this.buildChildActivities(item, childNode, resourceMap, visitedIds)) {
            return false; // Stop if any nested child fails
          }
        }
      }

      this.logger?.info(`Activity tree built with ${this.activities.size} activities`);
      return true;

    } catch (error) {
      this.logger?.error('Error building activity tree:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.INVALID_ACTIVITY_TREE,
        `Tree construction failed: ${error.message}`, 'buildTree');
      return false;
    }
  }

  /**
   * Build activity node from manifest item
   * @private
   * @param {Object} item - Manifest item/organization
   * @param {Map} resourceMap - Resource lookup map
   * @param {ActivityNode} parent - Parent activity node
   * @returns {ActivityNode|null} Created activity node
   */
  buildActivityNode(item, resourceMap, parent = null, visitedIds = new Set()) {
    // Validate required fields first
    if (!item.identifier) {
      this.errorHandler?.setError(SN_ERROR_CODES.INVALID_ACTIVITY_TREE,
        'Activity identifier is required', 'buildActivityNode');
      return null;
    }

    // Check for circular references
    if (visitedIds.has(item.identifier)) {
      this.errorHandler?.setError(SN_ERROR_CODES.CIRCULAR_ACTIVITY_REFERENCE,
        `Circular reference detected: ${item.identifier}`, 'buildActivityNode');
      return null;
    }

    // Check depth limit
    const depth = parent ? parent.getDepth() + 1 : 0;
    if (depth > SN_DEFAULTS.MAX_ACTIVITY_DEPTH) {
      this.errorHandler?.setError(SN_ERROR_CODES.MAX_DEPTH_EXCEEDED,
        `Maximum activity depth exceeded: ${depth}`, 'buildActivityNode');
      return null;
    }

    // Add to visited set for circular reference detection
    visitedIds.add(item.identifier);

    // Get associated resource if referenced
    let resource = null;
    if (item.identifierref) {
      resource = resourceMap.get(item.identifierref);
    }

    // Create activity node
    const activityNode = new ActivityNode(item, resource, parent);
    
    // Initialize objectives from sequencing
    this.initializeObjectives(activityNode);
    
    // Register activity
    this.activities.set(item.identifier, activityNode);
    
    return activityNode;
  }

  /**
   * Build child activities recursively
   * @private
   * @param {Object} item - Parent manifest item
   * @param {ActivityNode} parentNode - Parent activity node
   * @param {Map} resourceMap - Resource lookup map
   */
  buildChildActivities(item, parentNode, resourceMap, visitedIds = new Set()) {
    if (item.children) {
      for (const childItem of item.children) {
        // Pass the same visitedIds set to maintain circular reference detection
        const childNode = this.buildActivityNode(childItem, resourceMap, parentNode, visitedIds);
        if (!childNode) {
          return false; // Stop if child fails to build
        }
        parentNode.addChild(childNode);
        if (!this.buildChildActivities(childItem, childNode, resourceMap, visitedIds)) {
          return false; // Stop if nested child fails
        }
      }
    }
    return true;
  }

  /**
   * Initialize objectives for activity
   * @private
   * @param {ActivityNode} activity - Activity node
   */
  initializeObjectives(activity) {
    if (activity.sequencing && activity.sequencing.objectives) {
      const objectives = activity.sequencing.objectives;
      
      // Handle primary objective
      if (objectives.primaryObjective) {
        activity.primaryObjective = {
          objectiveID: objectives.primaryObjective.objectiveID,
          satisfied: false,
          measure: null,
          mapInfo: objectives.primaryObjective.mapInfo || {}
        };
      }
    }
  }

  /**
   * Get activity by identifier
   * @param {string} identifier - Activity identifier
   * @returns {ActivityNode|null} Activity node or null if not found
   */
  getActivity(identifier) {
    return this.activities.get(identifier) || null;
  }

  /**
   * Set current activity
   * @param {string} identifier - Activity identifier
   * @returns {boolean} True if successful
   */
  setCurrentActivity(identifier) {
    const activity = this.getActivity(identifier);
    if (!activity) {
      this.errorHandler?.setError(SN_ERROR_CODES.ACTIVITY_NOT_FOUND,
        `Activity not found: ${identifier}`, 'setCurrentActivity');
      return false;
    }

    this.currentActivity = activity;
    activity.setState(ACTIVITY_STATES.ACTIVE);
    this.logger?.debug(`Current activity set to: ${identifier}`);
    return true;
  }

  /**
   * Get all leaf activities (launchable content)
   * @returns {ActivityNode[]} Array of leaf activities
   */
  getLeafActivities() {
    const leaves = [];
    this.traverseTree(this.root, (activity) => {
      if (activity.isLeaf()) {
        leaves.push(activity);
      }
    });
    return leaves;
  }

  /**
   * Traverse activity tree with callback
   * @param {ActivityNode} node - Starting node
   * @param {Function} callback - Callback function for each node
   */
  traverseTree(node, callback) {
    if (!node) return;
    
    callback(node);
    node.children.forEach(child => {
      this.traverseTree(child, callback);
    });
  }

  /**
   * Get tree statistics
   * @returns {Object} Tree statistics
   */
  getTreeStats() {
    let totalActivities = 0;
    let leafActivities = 0;
    let launchableActivities = 0;
    let maxDepth = 0;

    this.traverseTree(this.root, (activity) => {
      totalActivities++;
      if (activity.isLeaf()) {
        leafActivities++;
      }
      if (activity.isLaunchable()) {
        launchableActivities++;
      }
      maxDepth = Math.max(maxDepth, activity.getDepth());
    });

    return {
      totalActivities,
      leafActivities,
      launchableActivities,
      maxDepth,
      globalObjectives: this.globalObjectives.size
    };
  }

  /**
   * Reset activity tree to initial state
   */
  reset() {
    this.activities.clear();
    this.globalObjectives.clear();
    this.currentActivity = null;
    this.root = null;
    this.logger?.debug('Activity tree reset');
  }
}

module.exports = { ActivityTreeManager, ActivityNode };