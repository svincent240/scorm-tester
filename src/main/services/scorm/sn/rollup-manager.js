/**
 * SCORM 2004 4th Edition Rollup Manager
 * 
 * Handles objective and completion status aggregation up the activity tree
 * according to SCORM rollup rules, global objective management, and
 * measure calculation per SCORM 2004 4th Edition specification.
 * 
 * @fileoverview Objective and completion rollup processing
 */

const { 
  SN_ERROR_CODES,
  ROLLUP_ACTIONS,
  OBJECTIVE_PROGRESS_STATES,
  ATTEMPT_STATES,
  SN_DEFAULTS
} = require('../../../../shared/constants/sn-constants');

/**
 * Rollup Manager Class
 * Manages objective and completion status rollup processing
 */
class RollupManager {
  constructor(activityTreeManager, errorHandler, logger) {
    this.activityTreeManager = activityTreeManager;
    this.errorHandler = errorHandler;
    this.logger = logger;
    
    // Global objectives storage
    this.globalObjectives = new Map();
    
    // Rollup processing state
    this.rollupInProgress = false;
    this.rollupResults = new Map();
    
    this.logger?.debug('RollupManager initialized');
  }

  /**
   * Process rollup for an activity and its ancestors
   * @param {ActivityNode} activity - Starting activity for rollup
   * @returns {Object} Rollup processing result
   */
  processRollup(activity) {
    try {
      if (this.rollupInProgress) {
        return { success: false, reason: 'Rollup already in progress' };
      }

      this.rollupInProgress = true;
      this.rollupResults.clear();

      this.logger?.debug(`Starting rollup process for activity: ${activity.identifier}`);

      // Process rollup from current activity up to root
      let currentActivity = activity;
      while (currentActivity) {
        const rollupResult = this.processActivityRollup(currentActivity);
        this.rollupResults.set(currentActivity.identifier, rollupResult);
        
        if (!rollupResult.success) {
          this.logger?.warn(`Rollup failed for activity: ${currentActivity.identifier}`, rollupResult);
        }
        
        currentActivity = currentActivity.parent;
      }

      this.rollupInProgress = false;
      
      return {
        success: true,
        reason: 'Rollup processing completed',
        results: Object.fromEntries(this.rollupResults)
      };

    } catch (error) {
      this.rollupInProgress = false;
      this.logger?.error('Error during rollup processing:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.ROLLUP_PROCESSING_FAILED,
        `Rollup processing failed: ${error.message}`, 'processRollup');
      return { success: false, reason: 'Rollup processing error', error: error.message };
    }
  }

  /**
   * Process rollup for a single activity
   * @private
   * @param {ActivityNode} activity - Activity to process
   * @returns {Object} Activity rollup result
   */
  processActivityRollup(activity) {
    try {
      const rollupRules = this.getRollupRules(activity);
      const result = {
        success: true,
        activityId: activity.identifier,
        objectiveRollup: null,
        completionRollup: null,
        measureRollup: null
      };

      // Process objective rollup
      if (rollupRules.rollupObjectiveSatisfied) {
        result.objectiveRollup = this.processObjectiveRollup(activity, rollupRules);
      }

      // Process completion rollup
      if (rollupRules.rollupProgressCompletion) {
        result.completionRollup = this.processCompletionRollup(activity, rollupRules);
      }

      // Process measure rollup
      if (rollupRules.objectiveMeasureWeight > 0) {
        result.measureRollup = this.processMeasureRollup(activity, rollupRules);
      }

      // Update global objectives
      this.updateGlobalObjectives(activity);

      return result;

    } catch (error) {
      this.logger?.error(`Error processing rollup for activity ${activity.identifier}:`, error);
      return {
        success: false,
        activityId: activity.identifier,
        error: error.message
      };
    }
  }

  /**
   * Get rollup rules for an activity
   * @private
   * @param {ActivityNode} activity - Activity to get rules for
   * @returns {Object} Rollup rules configuration
   */
  getRollupRules(activity) {
    const defaultRules = {
      rollupObjectiveSatisfied: true,
      rollupProgressCompletion: true,
      objectiveMeasureWeight: SN_DEFAULTS.DEFAULT_OBJECTIVE_WEIGHT,
      requiredForSatisfied: 'always',
      requiredForNotSatisfied: 'always',
      requiredForCompleted: 'always',
      requiredForIncomplete: 'always'
    };

    if (activity.sequencing && activity.sequencing.rollupRules) {
      return { ...defaultRules, ...activity.sequencing.rollupRules };
    }

    return defaultRules;
  }

  /**
   * Process objective satisfaction rollup
   * @private
   * @param {ActivityNode} activity - Activity to process
   * @param {Object} rollupRules - Rollup rules
   * @returns {Object} Objective rollup result
   */
  processObjectiveRollup(activity, rollupRules) {
    const children = activity.children;
    if (children.length === 0) {
      // Leaf activity - use its own objective status
      return {
        satisfied: this.getActivityObjectiveStatus(activity),
        reason: 'Leaf activity objective status',
        contributingActivities: [activity.identifier]
      };
    }

    // Aggregate child objective statuses
    const childStatuses = children.map(child => ({
      activityId: child.identifier,
      satisfied: this.getActivityObjectiveStatus(child),
      weight: this.getActivityWeight(child, rollupRules)
    }));

    // Apply rollup logic based on rules
    const satisfiedCount = childStatuses.filter(status => status.satisfied === true).length;
    const notSatisfiedCount = childStatuses.filter(status => status.satisfied === false).length;
    const unknownCount = childStatuses.filter(status => status.satisfied === null).length;

    let rollupSatisfied = null;
    let reason = '';

    // Determine rollup result based on required conditions
    if (rollupRules.requiredForSatisfied === 'always') {
      if (satisfiedCount === children.length) {
        rollupSatisfied = true;
        reason = 'All children satisfied';
      } else if (notSatisfiedCount > 0) {
        rollupSatisfied = false;
        reason = 'Some children not satisfied';
      }
    } else if (rollupRules.requiredForSatisfied === 'ifAttempted') {
      const attemptedChildren = children.filter(child => child.attemptCount > 0);
      if (attemptedChildren.length > 0) {
        const attemptedSatisfied = attemptedChildren.filter(child => 
          this.getActivityObjectiveStatus(child) === true).length;
        rollupSatisfied = attemptedSatisfied === attemptedChildren.length;
        reason = `Attempted children rollup: ${attemptedSatisfied}/${attemptedChildren.length}`;
      }
    }

    return {
      satisfied: rollupSatisfied,
      reason,
      contributingActivities: childStatuses.map(s => s.activityId),
      childStatuses
    };
  }

  /**
   * Process completion status rollup
   * @private
   * @param {ActivityNode} activity - Activity to process
   * @param {Object} rollupRules - Rollup rules
   * @returns {Object} Completion rollup result
   */
  processCompletionRollup(activity, rollupRules) {
    const children = activity.children;
    if (children.length === 0) {
      // Leaf activity - use its own completion status
      return {
        completed: activity.attemptState === ATTEMPT_STATES.COMPLETED,
        reason: 'Leaf activity completion status',
        contributingActivities: [activity.identifier]
      };
    }

    // Aggregate child completion statuses
    const childStatuses = children.map(child => ({
      activityId: child.identifier,
      completed: child.attemptState === ATTEMPT_STATES.COMPLETED,
      attempted: child.attemptCount > 0
    }));

    const completedCount = childStatuses.filter(status => status.completed).length;
    const attemptedCount = childStatuses.filter(status => status.attempted).length;

    let rollupCompleted = false;
    let reason = '';

    // Apply completion rollup logic
    if (rollupRules.requiredForCompleted === 'always') {
      rollupCompleted = completedCount === children.length;
      reason = `Completion rollup: ${completedCount}/${children.length} completed`;
    } else if (rollupRules.requiredForCompleted === 'ifAttempted') {
      if (attemptedCount > 0) {
        const attemptedCompleted = childStatuses.filter(status => 
          status.attempted && status.completed).length;
        rollupCompleted = attemptedCompleted === attemptedCount;
        reason = `Attempted completion rollup: ${attemptedCompleted}/${attemptedCount}`;
      }
    }

    return {
      completed: rollupCompleted,
      reason,
      contributingActivities: childStatuses.map(s => s.activityId),
      childStatuses
    };
  }

  /**
   * Process measure rollup (weighted scoring)
   * @private
   * @param {ActivityNode} activity - Activity to process
   * @param {Object} rollupRules - Rollup rules
   * @returns {Object} Measure rollup result
   */
  processMeasureRollup(activity, rollupRules) {
    const children = activity.children;
    if (children.length === 0) {
      // Leaf activity - use its own measure
      const measure = this.getActivityMeasure(activity);
      return {
        measure,
        reason: 'Leaf activity measure',
        contributingActivities: [activity.identifier]
      };
    }

    // Calculate weighted average of child measures
    let totalWeightedScore = 0;
    let totalWeight = 0;
    const childMeasures = [];

    children.forEach(child => {
      const childMeasure = this.getActivityMeasure(child);
      const childWeight = this.getActivityWeight(child, rollupRules);
      
      if (childMeasure !== null) {
        totalWeightedScore += childMeasure * childWeight;
        totalWeight += childWeight;
        childMeasures.push({
          activityId: child.identifier,
          measure: childMeasure,
          weight: childWeight
        });
      }
    });

    const rollupMeasure = totalWeight > 0 ? totalWeightedScore / totalWeight : null;

    return {
      measure: rollupMeasure,
      reason: `Weighted average: ${totalWeightedScore}/${totalWeight}`,
      contributingActivities: childMeasures.map(m => m.activityId),
      childMeasures
    };
  }

  /**
   * Get activity objective status
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @returns {boolean|null} Objective satisfaction status
   */
  getActivityObjectiveStatus(activity) {
    if (activity.primaryObjective) {
      return activity.primaryObjective.satisfied;
    }
    // Default to completion-based satisfaction
    return activity.attemptState === ATTEMPT_STATES.COMPLETED ? true : null;
  }

  /**
   * Get activity measure (score)
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @returns {number|null} Activity measure
   */
  getActivityMeasure(activity) {
    if (activity.primaryObjective && activity.primaryObjective.measure !== null) {
      return activity.primaryObjective.measure;
    }
    return null;
  }

  /**
   * Get activity weight for rollup calculations
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @param {Object} rollupRules - Rollup rules
   * @returns {number} Activity weight
   */
  getActivityWeight(activity, rollupRules) {
    if (activity.sequencing && activity.sequencing.rollupRules) {
      return activity.sequencing.rollupRules.objectiveMeasureWeight || rollupRules.objectiveMeasureWeight;
    }
    return rollupRules.objectiveMeasureWeight;
  }

  /**
   * Update global objectives based on activity objective mapping
   * @private
   * @param {ActivityNode} activity - Activity to process
   */
  updateGlobalObjectives(activity) {
    if (!activity.primaryObjective || !activity.primaryObjective.mapInfo) {
      return;
    }

    const mapInfo = activity.primaryObjective.mapInfo;
    const targetObjectiveID = mapInfo.targetObjectiveID;

    if (targetObjectiveID) {
      // Update global objective if mapping allows writing
      if (mapInfo.writeSatisfiedStatus) {
        this.setGlobalObjective(targetObjectiveID, 'satisfied', activity.primaryObjective.satisfied);
      }
      if (mapInfo.writeNormalizedMeasure && activity.primaryObjective.measure !== null) {
        this.setGlobalObjective(targetObjectiveID, 'measure', activity.primaryObjective.measure);
      }

      // Read from global objective if mapping allows reading
      if (mapInfo.readSatisfiedStatus) {
        const globalSatisfied = this.getGlobalObjective(targetObjectiveID, 'satisfied');
        if (globalSatisfied !== null) {
          activity.primaryObjective.satisfied = globalSatisfied;
        }
      }
    }
  }

  /**
   * Set global objective value
   * @param {string} objectiveID - Global objective identifier
   * @param {string} property - Property to set ('satisfied' or 'measure')
   * @param {*} value - Value to set
   */
  setGlobalObjective(objectiveID, property, value) {
    if (!this.globalObjectives.has(objectiveID)) {
      this.globalObjectives.set(objectiveID, {
        satisfied: null,
        measure: null
      });
    }

    const objective = this.globalObjectives.get(objectiveID);
    objective[property] = value;
    
    this.logger?.debug(`Global objective updated: ${objectiveID}.${property} = ${value}`);
  }

  /**
   * Get global objective value
   * @param {string} objectiveID - Global objective identifier
   * @param {string} property - Property to get ('satisfied' or 'measure')
   * @returns {*} Objective property value or null
   */
  getGlobalObjective(objectiveID, property) {
    const objective = this.globalObjectives.get(objectiveID);
    return objective ? objective[property] : null;
  }

  /**
   * Get all global objectives
   * @returns {Object} Map of all global objectives
   */
  getAllGlobalObjectives() {
    return Object.fromEntries(this.globalObjectives);
  }

  /**
   * Reset rollup manager state
   */
  reset() {
    this.globalObjectives.clear();
    this.rollupResults.clear();
    this.rollupInProgress = false;
    this.logger?.debug('RollupManager reset');
  }
}

module.exports = RollupManager;