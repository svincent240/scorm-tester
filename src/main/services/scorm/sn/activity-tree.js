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
    this.location = ''; // Added for cmi.location tracking
    
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
 
  addChild(child) {
    child.parent = this;
    this.children.push(child);
  }
 
  isLeaf() {
    return this.children.length === 0;
  }
 
  isLaunchable() {
    if (!this.resource) return false;
    return this.resource.scormType === 'sco';
  }
 
  getDepth() {
    let depth = 0;
    let current = this.parent;
    while (current) {
      depth++;
      current = current.parent;
    }
    return depth;
  }
 
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
      // Validate organizations presence
      const orgs = manifest?.organizations;
      const orgList = orgs?.organizations || orgs?.organization || [];
      if (!orgs || orgList.length === 0) {
        this.errorHandler?.setError(
          SN_ERROR_CODES.INVALID_ACTIVITY_TREE,
          'No organizations found in manifest',
          'buildTree'
        );
        return false;
      }
 
      // Select organization (default or first)
      const defaultOrgId = orgs.default;
      const organization = (Array.isArray(orgList) ? orgList : [orgList]).find(org =>
        org.identifier === defaultOrgId) || (Array.isArray(orgList) ? orgList[0] : orgList);
 
      if (!organization) {
        this.errorHandler?.setError(
          SN_ERROR_CODES.INVALID_ACTIVITY_TREE,
          'No valid organization found',
          'buildTree'
        );
        return false;
      }
 
      // Create resource lookup map (support both canonical and legacy shapes)
      const res = manifest.resources;
      const resList = Array.isArray(res) ? res : (res?.resource || res?.resources || []);
      const resourceMap = new Map();
      (Array.isArray(resList) ? resList : [resList]).forEach(resource => {
        if (resource && resource.identifier) resourceMap.set(resource.identifier, resource);
      });
 
      const visiting = new Set();

      // Build root
      this.root = this.buildActivityNode(organization, resourceMap, null, visiting);
      if (!this.root) {
        return false;
      }
      
      visiting.add(this.root.identifier);

      // Process children
      const topItems = organization.items || organization.children || [];
      if (Array.isArray(topItems)) {
        for (const item of topItems) {
          if (!this.addChildSubtree(item, this.root, resourceMap, visiting)) {
            return false;
          }
        }
      }

      visiting.delete(this.root.identifier);

      this.logger?.info(`Activity tree built with ${this.activities.size} activities`);
      return true;
 
    } catch (error) {
      this.logger?.error('Error building activity tree:', error);
      this.errorHandler?.setError(
        SN_ERROR_CODES.INVALID_ACTIVITY_TREE,
        `Tree construction failed: ${error.message}`,
        'buildTree'
      );
      return false;
    }
  }
 
  /**
   * Build a node with cycle detection (DFS)
   */
  buildActivityNode(item, resourceMap, parent = null, visiting = new Set()) {
    // Validate identifier
    if (!item || !item.identifier) {
      this.errorHandler?.setError(
        SN_ERROR_CODES.INVALID_ACTIVITY_TREE,
        'Activity identifier is required',
        'buildActivityNode'
      );
      return null;
    }

    const id = item.identifier;
    
    // Check for circular reference (currently in recursion stack)
    if (visiting.has(id)) {
      this.errorHandler?.setError(
        SN_ERROR_CODES.CIRCULAR_ACTIVITY_REFERENCE,
        `Circular reference detected: ${id}`,
        'buildActivityNode'
      );
      return null;
    }
    
    // Check for duplicate (already processed)
    if (this.activities.has(id)) {
      this.logger?.warn(`Duplicate identifier skipped: ${id}`);
      return null;
    }

    // Depth check
    const depth = parent ? parent.getDepth() + 1 : 0;
    const MAX_DEPTH = SN_DEFAULTS?.MAX_ACTIVITY_DEPTH || 1024;
    if (depth > MAX_DEPTH) {
      this.errorHandler?.setError(
        SN_ERROR_CODES.MAX_DEPTH_EXCEEDED,
        `Maximum activity depth exceeded: ${depth}`,
        'buildActivityNode'
      );
      return null;
    }

    visiting.add(id);

    // Resolve resource
    let resource = null;
    if (item.identifierref) {
      resource = resourceMap.get(item.identifierref) || null;
    }

    const node = new ActivityNode(item, resource, parent);
    this.initializeObjectives(node);
    this.activities.set(id, node);

    return node;
  }
 
  /**
   * Recursively add child subtree with proper cycle handling
   */
  addChildSubtree(item, parentNode, resourceMap, visiting) {
    const node = this.buildActivityNode(item, resourceMap, parentNode, visiting);
    if (!node) {
      // Skip duplicates silently, fail on errors
      return !this.activities.has(item?.identifier);
    }

    parentNode.addChild(node);
    
    const children = item.children || item.items || [];
    if (Array.isArray(children)) {
      for (const child of children) {
        if (!this.addChildSubtree(child, node, resourceMap, visiting)) {
          return false;
        }
      }
    }
    
    visiting.delete(node.identifier);
    return true;
  }
 
  initializeObjectives(activity) {
    if (activity.sequencing && activity.sequencing.objectives) {
      const objectives = activity.sequencing.objectives;
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
 
  getActivity(identifier) {
    return this.activities.get(identifier) || null;
  }

  /**
   * Find activity by identifier (alias for getActivity)
   * @param {string} identifier - Activity identifier
   * @returns {ActivityNode|null} Activity node or null if not found
   */
  findActivity(identifier) {
    return this.getActivity(identifier);
  }
 
  setCurrentActivity(identifier) {
    const activity = this.getActivity(identifier);
    if (!activity) {
      this.errorHandler?.setError(
        SN_ERROR_CODES.ACTIVITY_NOT_FOUND,
        `Activity not found: ${identifier}`,
        'setCurrentActivity'
      );
      return false;
    }
    this.currentActivity = activity;
    activity.setState(ACTIVITY_STATES.ACTIVE);
    this.logger?.debug(`Current activity set to: ${identifier}`);
    return true;
  }
 
  getLeafActivities() {
    const leaves = [];
    this.traverseTree(this.root, (activity) => {
      if (activity.isLeaf()) leaves.push(activity);
    });
    return leaves;
  }
 
  traverseTree(node, callback) {
    if (!node) return;
    callback(node);
    node.children.forEach(child => this.traverseTree(child, callback));
  }
 
  getTreeStats() {
    let totalActivities = 0;
    let leafActivities = 0;
    let launchableActivities = 0;
    let maxDepth = 0;
    this.traverseTree(this.root, (activity) => {
      totalActivities++;
      if (activity.isLeaf()) leafActivities++;
      if (activity.isLaunchable()) launchableActivities++;
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
 
  reset() {
    this.activities.clear();
    this.globalObjectives.clear();
    this.currentActivity = null;
    this.root = null;
    this.logger?.debug('Activity tree reset');
  }
}
 
module.exports = { ActivityTreeManager, ActivityNode };