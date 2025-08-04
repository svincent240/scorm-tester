/**
 * SCORM 2004 4th Edition Sequencing Engine
 * 
 * Processes SCORM sequencing rules, control modes, and conditions to determine
 * activity flow and navigation according to SCORM 2004 4th Edition
 * Sequencing and Navigation specification.
 * 
 * @fileoverview SCORM sequencing rule processing engine
 */

const { 
  SN_ERROR_CODES,
  RULE_CONDITIONS,
  RULE_ACTIONS,
  CONTROL_MODES,
  ACTIVITY_STATES,
  ATTEMPT_STATES,
  OBJECTIVE_PROGRESS_STATES
} = require('../../../../shared/constants/sn-constants');

/**
 * Sequencing Engine Class
 * Handles all sequencing rule evaluation and processing
 */
class SequencingEngine {
  constructor(activityTreeManager, errorHandler, logger) {
    this.activityTreeManager = activityTreeManager;
    this.errorHandler = errorHandler;
    this.logger = logger;
    
    this.logger?.debug('SequencingEngine initialized');
  }

  /**
   * Evaluate pre-condition rules for an activity
   * @param {ActivityNode} activity - Activity to evaluate
   * @returns {Object} Evaluation result with action and reason
   */
  evaluatePreConditionRules(activity) {
    try {
      if (!activity.sequencing || !activity.sequencing.sequencingRules) {
        return { action: null, reason: 'No sequencing rules defined' };
      }

      const preRules = activity.sequencing.sequencingRules.preConditionRules || [];
      
      for (const rule of preRules) {
        const conditionResult = this.evaluateRuleConditions(rule.conditions, activity);
        
        if (conditionResult.satisfied) {
          this.logger?.debug(`Pre-condition rule triggered: ${rule.action} for ${activity.identifier}`);
          return {
            action: rule.action,
            reason: `Pre-condition rule: ${conditionResult.reason}`,
            rule: rule
          };
        }
      }

      return { action: null, reason: 'No pre-condition rules triggered' };

    } catch (error) {
      this.logger?.error('Error evaluating pre-condition rules:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.RULE_CONDITION_FAILED,
        `Pre-condition evaluation failed: ${error.message}`, 'evaluatePreConditionRules');
      return { action: null, reason: 'Evaluation error', error: error.message };
    }
  }

  /**
   * Evaluate post-condition rules for an activity
   * @param {ActivityNode} activity - Activity to evaluate
   * @returns {Object} Evaluation result with action and reason
   */
  evaluatePostConditionRules(activity) {
    try {
      if (!activity.sequencing || !activity.sequencing.sequencingRules) {
        return { action: null, reason: 'No sequencing rules defined' };
      }

      const postRules = activity.sequencing.sequencingRules.postConditionRules || [];
      
      for (const rule of postRules) {
        const conditionResult = this.evaluateRuleConditions(rule.conditions, activity);
        
        if (conditionResult.satisfied) {
          this.logger?.debug(`Post-condition rule triggered: ${rule.action} for ${activity.identifier}`);
          return {
            action: rule.action,
            reason: `Post-condition rule: ${conditionResult.reason}`,
            rule: rule
          };
        }
      }

      return { action: null, reason: 'No post-condition rules triggered' };

    } catch (error) {
      this.logger?.error('Error evaluating post-condition rules:', error);
      this.errorHandler?.setError(SN_ERROR_CODES.RULE_CONDITION_FAILED,
        `Post-condition evaluation failed: ${error.message}`, 'evaluatePostConditionRules');
      return { action: null, reason: 'Evaluation error', error: error.message };
    }
  }

  /**
   * Evaluate rule conditions
   * @private
   * @param {Array} conditions - Array of rule conditions
   * @param {ActivityNode} activity - Activity context
   * @returns {Object} Condition evaluation result
   */
  evaluateRuleConditions(conditions, activity) {
    if (!conditions || conditions.length === 0) {
      return { satisfied: false, reason: 'No conditions defined' };
    }

    const conditionCombination = conditions.conditionCombination || 'all';
    const results = [];

    for (const condition of conditions) {
      const result = this.evaluateSingleCondition(condition, activity);
      results.push(result);
    }

    // Apply combination logic
    let satisfied = false;
    if (conditionCombination === 'all') {
      satisfied = results.every(r => r.satisfied);
    } else if (conditionCombination === 'any') {
      satisfied = results.some(r => r.satisfied);
    }

    return {
      satisfied,
      reason: `Condition combination (${conditionCombination}): ${results.map(r => r.reason).join(', ')}`,
      results
    };
  }

  /**
   * Evaluate a single rule condition
   * @private
   * @param {Object} condition - Single rule condition
   * @param {ActivityNode} activity - Activity context
   * @returns {Object} Single condition result
   */
  evaluateSingleCondition(condition, activity) {
    const conditionType = condition.condition;
    const operator = condition.operator || 'noOp';
    
    let result = false;
    let reason = '';

    switch (conditionType) {
      case RULE_CONDITIONS.ALWAYS:
        result = true;
        reason = 'Always condition';
        break;

      case RULE_CONDITIONS.SATISFIED:
        result = this.isActivitySatisfied(activity);
        reason = `Activity satisfied: ${result}`;
        break;

      case RULE_CONDITIONS.COMPLETED:
        result = this.isActivityCompleted(activity);
        reason = `Activity completed: ${result}`;
        break;

      case RULE_CONDITIONS.ATTEMPTED:
        result = activity.attemptCount > 0;
        reason = `Activity attempted: ${result} (attempts: ${activity.attemptCount})`;
        break;

      case RULE_CONDITIONS.ACTIVITY_PROGRESS_KNOWN:
        result = activity.attemptState !== ATTEMPT_STATES.UNKNOWN;
        reason = `Activity progress known: ${result} (state: ${activity.attemptState})`;
        break;

      case RULE_CONDITIONS.OBJECTIVE_STATUS_KNOWN:
        result = this.isObjectiveStatusKnown(activity);
        reason = `Objective status known: ${result}`;
        break;

      case RULE_CONDITIONS.OBJECTIVE_MEASURE_KNOWN:
        result = this.isObjectiveMeasureKnown(activity);
        reason = `Objective measure known: ${result}`;
        break;

      case RULE_CONDITIONS.ATTEMPT_LIMIT_EXCEEDED:
        result = this.isAttemptLimitExceeded(activity);
        reason = `Attempt limit exceeded: ${result}`;
        break;

      default:
        reason = `Unknown condition: ${conditionType}`;
        break;
    }

    // Apply operator (not, noOp)
    if (operator === 'not') {
      result = !result;
      reason = `NOT (${reason})`;
    }

    return { satisfied: result, reason, condition: conditionType, operator };
  }

  /**
   * Check if activity is satisfied
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @returns {boolean} True if satisfied
   */
  isActivitySatisfied(activity) {
    if (activity.primaryObjective) {
      return activity.primaryObjective.satisfied;
    }
    // Default satisfaction logic based on completion
    return activity.attemptState === ATTEMPT_STATES.COMPLETED;
  }

  /**
   * Check if activity is completed
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @returns {boolean} True if completed
   */
  isActivityCompleted(activity) {
    return activity.attemptState === ATTEMPT_STATES.COMPLETED;
  }

  /**
   * Check if objective status is known
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @returns {boolean} True if objective status is known
   */
  isObjectiveStatusKnown(activity) {
    if (activity.primaryObjective) {
      return activity.primaryObjective.satisfied !== null;
    }
    return false;
  }

  /**
   * Check if objective measure is known
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @returns {boolean} True if objective measure is known
   */
  isObjectiveMeasureKnown(activity) {
    if (activity.primaryObjective) {
      return activity.primaryObjective.measure !== null;
    }
    return false;
  }

  /**
   * Check if attempt limit is exceeded
   * @private
   * @param {ActivityNode} activity - Activity to check
   * @returns {boolean} True if attempt limit exceeded
   */
  isAttemptLimitExceeded(activity) {
    if (activity.sequencing && activity.sequencing.limitConditions) {
      const attemptLimit = activity.sequencing.limitConditions.attemptLimit;
      if (attemptLimit && attemptLimit > 0) {
        return activity.attemptCount >= attemptLimit;
      }
    }
    return false;
  }

  /**
   * Check control mode permissions
   * @param {ActivityNode} activity - Activity to check
   * @param {string} requestType - Type of navigation request
   * @returns {boolean} True if allowed by control modes
   */
  checkControlModePermissions(activity, requestType) {
    if (!activity.sequencing || !activity.sequencing.controlMode) {
      return true; // Default to allowing all navigation
    }

    const controlMode = activity.sequencing.controlMode;

    switch (requestType) {
      case 'choice':
        return controlMode.choice !== false;
      case 'choiceExit':
        return controlMode.choiceExit !== false;
      case 'flow':
        return controlMode.flow !== false;
      case 'forwardOnly':
        return controlMode.forwardOnly === true;
      default:
        return true;
    }
  }

  /**
   * Process sequencing action
   * @param {string} action - Sequencing action to process
   * @param {ActivityNode} activity - Activity context
   * @returns {Object} Action processing result
   */
  processSequencingAction(action, activity) {
    try {
      switch (action) {
        case RULE_ACTIONS.SKIP:
          return this.processSkipAction(activity);
        case RULE_ACTIONS.DISABLED:
          return this.processDisabledAction(activity);
        case RULE_ACTIONS.HIDDEN_FROM_CHOICE:
          return this.processHiddenFromChoiceAction(activity);
        case RULE_ACTIONS.EXIT_PARENT:
          return this.processExitParentAction(activity);
        case RULE_ACTIONS.EXIT_ALL:
          return this.processExitAllAction(activity);
        case RULE_ACTIONS.RETRY:
          return this.processRetryAction(activity);
        case RULE_ACTIONS.CONTINUE:
          return this.processContinueAction(activity);
        case RULE_ACTIONS.PREVIOUS:
          return this.processPreviousAction(activity);
        default:
          return { success: false, reason: `Unknown action: ${action}` };
      }
    } catch (error) {
      this.logger?.error(`Error processing sequencing action ${action}:`, error);
      return { success: false, reason: `Action processing failed: ${error.message}` };
    }
  }

  /**
   * Process skip action
   * @private
   */
  processSkipAction(activity) {
    activity.setState(ACTIVITY_STATES.INACTIVE);
    return { success: true, reason: 'Activity skipped', nextAction: 'continue' };
  }

  /**
   * Process disabled action
   * @private
   */
  processDisabledAction(activity) {
    return { success: true, reason: 'Activity disabled', nextAction: 'block' };
  }

  /**
   * Process hidden from choice action
   * @private
   */
  processHiddenFromChoiceAction(activity) {
    activity.isVisible = false;
    return { success: true, reason: 'Activity hidden from choice' };
  }

  /**
   * Process exit parent action
   * @private
   */
  processExitParentAction(activity) {
    if (activity.parent) {
      activity.parent.setState(ACTIVITY_STATES.INACTIVE);
      return { success: true, reason: 'Exited parent activity', targetActivity: activity.parent };
    }
    return { success: false, reason: 'No parent activity to exit' };
  }

  /**
   * Process exit all action
   * @private
   */
  processExitAllAction(activity) {
    // Exit all activities up to root
    let current = activity;
    while (current) {
      current.setState(ACTIVITY_STATES.INACTIVE);
      current = current.parent;
    }
    return { success: true, reason: 'Exited all activities', nextAction: 'terminate' };
  }

  /**
   * Process retry action
   * @private
   */
  processRetryAction(activity) {
    activity.attemptCount++;
    activity.setState(ACTIVITY_STATES.ACTIVE);
    return { success: true, reason: 'Activity retry initiated', nextAction: 'restart' };
  }

  /**
   * Process continue action
   * @private
   */
  processContinueAction(activity) {
    return { success: true, reason: 'Continue to next activity', nextAction: 'continue' };
  }

  /**
   * Process previous action
   * @private
   */
  processPreviousAction(activity) {
    return { success: true, reason: 'Return to previous activity', nextAction: 'previous' };
  }
}

module.exports = SequencingEngine;