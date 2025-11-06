"use strict";

const sessions = require("../session");
const { RuntimeManager } = require("../runtime-manager");

/**
 * Click a DOM element by selector
 * Enables testing of interactive SCORM content (buttons, links, navigation controls)
 */
async function scorm_dom_click(params = {}) {
  const session_id = params.session_id;
  const selector = params.selector;
  const options = params.options || {};

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (!selector || typeof selector !== 'string') {
    const e = new Error('selector is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  // Build click script with options
  const clickType = options.click_type || 'single'; // single, double, right
  const waitForSelector = options.wait_for_selector !== false; // default true
  const waitTimeout = options.wait_timeout_ms || 5000;

  const script = `
    (async () => {
      const selector = ${JSON.stringify(selector)};
      const clickType = ${JSON.stringify(clickType)};
      const waitForSelector = ${JSON.stringify(waitForSelector)};
      const waitTimeout = ${waitTimeout};

      // Wait for element if requested
      if (waitForSelector) {
        const start = Date.now();
        while (!document.querySelector(selector)) {
          if (Date.now() - start > waitTimeout) {
            throw new Error('Element not found: ' + selector);
          }
          await new Promise(r => setTimeout(r, 100));
        }
      }

      const el = document.querySelector(selector);
      if (!el) {
        throw new Error('Element not found: ' + selector);
      }

      // Scroll element into view
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 100));

      // Perform click based on type
      if (clickType === 'double') {
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
      } else if (clickType === 'right') {
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
      } else {
        el.click();
      }

      return {
        success: true,
        element: {
          tagName: el.tagName,
          id: el.id || null,
          className: el.className || null,
          textContent: el.textContent?.substring(0, 100) || null
        }
      };
    })()
  `;

  try {
    sessions.emit && sessions.emit({ session_id, type: 'dom:click_start', payload: { selector, clickType } });
    const result = await RuntimeManager.executeJS(null, script, session_id);
    sessions.emit && sessions.emit({ session_id, type: 'dom:click_complete', payload: { selector } });
    return result;
  } catch (err) {
    const e = new Error(`DOM click failed: ${err.message}`);
    e.code = 'DOM_CLICK_FAILED';
    throw e;
  }
}

/**
 * Fill a form input element by selector
 * Supports text inputs, textareas, select dropdowns, checkboxes, and radio buttons
 */
async function scorm_dom_fill(params = {}) {
  const session_id = params.session_id;
  const selector = params.selector;
  const value = params.value;
  const options = params.options || {};

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (!selector || typeof selector !== 'string') {
    const e = new Error('selector is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (value === undefined || value === null) {
    const e = new Error('value is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  const waitForSelector = options.wait_for_selector !== false;
  const waitTimeout = options.wait_timeout_ms || 5000;
  const triggerEvents = options.trigger_events !== false; // default true

  const script = `
    (async () => {
      const selector = ${JSON.stringify(selector)};
      const value = ${JSON.stringify(value)};
      const waitForSelector = ${JSON.stringify(waitForSelector)};
      const waitTimeout = ${waitTimeout};
      const triggerEvents = ${JSON.stringify(triggerEvents)};

      // Wait for element if requested
      if (waitForSelector) {
        const start = Date.now();
        while (!document.querySelector(selector)) {
          if (Date.now() - start > waitTimeout) {
            throw new Error('Element not found: ' + selector);
          }
          await new Promise(r => setTimeout(r, 100));
        }
      }

      const el = document.querySelector(selector);
      if (!el) {
        throw new Error('Element not found: ' + selector);
      }

      // Scroll into view
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 100));

      const tagName = el.tagName.toLowerCase();
      const inputType = el.type ? el.type.toLowerCase() : '';

      // Handle different input types
      if (tagName === 'select') {
        // Select dropdown
        el.value = value;
        if (triggerEvents) {
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else if (inputType === 'checkbox' || inputType === 'radio') {
        // Checkbox or radio button
        const shouldCheck = value === true || value === 'true' || value === '1' || value === 'checked';
        el.checked = shouldCheck;
        if (triggerEvents) {
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else if (tagName === 'input' || tagName === 'textarea') {
        // Text input or textarea
        el.value = String(value);
        if (triggerEvents) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        throw new Error('Unsupported element type: ' + tagName + (inputType ? ' (' + inputType + ')' : ''));
      }

      return {
        success: true,
        element: {
          tagName: el.tagName,
          type: el.type || null,
          id: el.id || null,
          className: el.className || null,
          value: el.value || null,
          checked: el.checked || null
        }
      };
    })()
  `;

  try {
    sessions.emit && sessions.emit({ session_id, type: 'dom:fill_start', payload: { selector, value } });
    const result = await RuntimeManager.executeJS(null, script, session_id);
    sessions.emit && sessions.emit({ session_id, type: 'dom:fill_complete', payload: { selector } });
    return result;
  } catch (err) {
    const e = new Error(`DOM fill failed: ${err.message}`);
    e.code = 'DOM_FILL_FAILED';
    throw e;
  }
}

/**
 * Query DOM element state (text, attributes, visibility, computed styles)
 * Essential for verifying SCORM content rendering and state
 */
async function scorm_dom_query(params = {}) {
  const session_id = params.session_id;
  const selector = params.selector;
  const query_type = params.query_type || 'all'; // all, text, attributes, visibility, styles, value

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (!selector || typeof selector !== 'string') {
    const e = new Error('selector is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  const script = `
    (() => {
      const selector = ${JSON.stringify(selector)};
      const queryType = ${JSON.stringify(query_type)};

      const el = document.querySelector(selector);
      if (!el) {
        return { found: false, selector };
      }

      const result = { found: true, selector };

      // Get text content
      if (queryType === 'all' || queryType === 'text') {
        result.textContent = el.textContent || '';
        result.innerText = el.innerText || '';
        result.innerHTML = el.innerHTML || '';
      }

      // Get attributes
      if (queryType === 'all' || queryType === 'attributes') {
        result.attributes = {};
        for (const attr of el.attributes) {
          result.attributes[attr.name] = attr.value;
        }
        result.id = el.id || null;
        result.className = el.className || null;
      }

      // Get visibility state
      if (queryType === 'all' || queryType === 'visibility') {
        const style = window.getComputedStyle(el);
        result.visible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        result.display = style.display;
        result.visibility = style.visibility;
        result.opacity = style.opacity;
      }

      // Get computed styles
      if (queryType === 'all' || queryType === 'styles') {
        const style = window.getComputedStyle(el);
        result.computedStyles = {
          width: style.width,
          height: style.height,
          backgroundColor: style.backgroundColor,
          color: style.color,
          fontSize: style.fontSize,
          display: style.display,
          position: style.position
        };
      }

      // Get form value
      if (queryType === 'all' || queryType === 'value') {
        result.value = el.value !== undefined ? el.value : null;
        result.checked = el.checked !== undefined ? el.checked : null;
      }

      // Get element metadata
      result.tagName = el.tagName;
      result.type = el.type || null;

      return result;
    })()
  `;

  try {
    const result = await RuntimeManager.executeJS(null, script, session_id);
    return result;
  } catch (err) {
    const e = new Error(`DOM query failed: ${err.message}`);
    e.code = 'DOM_QUERY_FAILED';
    throw e;
  }
}

/**
 * Execute JavaScript in the browser context and return serializable results
 * Powerful tool for custom DOM interactions and debugging
 */
async function scorm_dom_evaluate(params = {}) {
  const session_id = params.session_id;
  const expression = params.expression;

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (!expression || typeof expression !== 'string') {
    const e = new Error('expression is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  try {
    sessions.emit && sessions.emit({ session_id, type: 'dom:evaluate_start', payload: { expression: expression.substring(0, 100) } });
    const result = await RuntimeManager.executeJS(null, expression, session_id);
    sessions.emit && sessions.emit({ session_id, type: 'dom:evaluate_complete', payload: {} });
    return { result };
  } catch (err) {
    // Format error message with JavaScript error details if available
    let errorMessage = `DOM evaluate failed: ${err.message}`;

    // If we have detailed error information from the browser context, include it
    if (err.code === 'SCRIPT_EXECUTION_ERROR' && err.details) {
      const details = err.details;
      errorMessage = `DOM evaluate failed: ${details.name}: ${details.message}`;

      // Add location information if available
      if (details.lineNumber !== null || details.columnNumber !== null) {
        const line = details.lineNumber !== null ? `line ${details.lineNumber}` : '';
        const col = details.columnNumber !== null ? `column ${details.columnNumber}` : '';
        const location = [line, col].filter(Boolean).join(', ');
        if (location) {
          errorMessage += ` (at ${location})`;
        }
      }

      // Add first few lines of stack trace for debugging
      if (details.stack) {
        const stackLines = details.stack.split('\n').slice(0, 3);
        errorMessage += `\n  Stack trace:\n  ${stackLines.join('\n  ')}`;
      }
    }

    const e = new Error(errorMessage);
    e.code = 'DOM_EVALUATE_FAILED';
    // Preserve original error details for programmatic access
    if (err.details) {
      e.details = err.details;
    }
    throw e;
  }
}

/**
 * Wait for a DOM condition to be met
 * Essential for synchronizing test steps with dynamic SCORM content
 */
async function scorm_dom_wait_for(params = {}) {
  const session_id = params.session_id;
  const condition = params.condition;
  const timeout_ms = params.timeout_ms || 10000;

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (!condition || typeof condition !== 'object') {
    const e = new Error('condition is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  // Build wait condition script
  const script = `
    (async () => {
      const condition = ${JSON.stringify(condition)};
      const timeout = ${timeout_ms};
      const start = Date.now();

      while (Date.now() - start < timeout) {
        let conditionMet = false;

        // Check selector exists
        if (condition.selector) {
          const el = document.querySelector(condition.selector);
          if (!el) {
            await new Promise(r => setTimeout(r, 100));
            continue;
          }

          // Check visibility if requested
          if (condition.visible !== undefined) {
            const style = window.getComputedStyle(el);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            if (isVisible !== condition.visible) {
              await new Promise(r => setTimeout(r, 100));
              continue;
            }
          }

          // Check text content if requested
          if (condition.text !== undefined) {
            const text = el.textContent || el.innerText || '';
            if (!text.includes(condition.text)) {
              await new Promise(r => setTimeout(r, 100));
              continue;
            }
          }

          // Check attribute if requested
          if (condition.attribute && condition.attribute_value !== undefined) {
            const attrValue = el.getAttribute(condition.attribute);
            if (attrValue !== condition.attribute_value) {
              await new Promise(r => setTimeout(r, 100));
              continue;
            }
          }

          conditionMet = true;
        }

        // Check custom expression if provided
        if (condition.expression) {
          try {
            const result = eval(condition.expression);
            if (!result) {
              await new Promise(r => setTimeout(r, 100));
              continue;
            }
            conditionMet = true;
          } catch (e) {
            await new Promise(r => setTimeout(r, 100));
            continue;
          }
        }

        if (conditionMet) {
          return {
            success: true,
            elapsed_ms: Date.now() - start
          };
        }

        await new Promise(r => setTimeout(r, 100));
      }

      throw new Error('Wait condition timeout after ' + timeout + 'ms');
    })()
  `;

  try {
    sessions.emit && sessions.emit({ session_id, type: 'dom:wait_start', payload: { condition } });
    const result = await RuntimeManager.executeJS(null, script, session_id);
    sessions.emit && sessions.emit({ session_id, type: 'dom:wait_complete', payload: { elapsed_ms: result.elapsed_ms } });
    return result;
  } catch (err) {
    const e = new Error(`DOM wait failed: ${err.message}`);
    e.code = 'DOM_WAIT_FAILED';
    throw e;
  }
}

/**
 * Simulate keyboard typing in a focused element
 * Useful for testing text input in SCORM assessments
 */
async function scorm_keyboard_type(params = {}) {
  const session_id = params.session_id;
  const text = params.text;
  const options = params.options || {};

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (text === undefined || text === null) {
    const e = new Error('text is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  const selector = options.selector || null;
  const delay_ms = options.delay_ms || 0; // delay between keystrokes

  const script = `
    (async () => {
      const text = ${JSON.stringify(text)};
      const selector = ${JSON.stringify(selector)};
      const delayMs = ${delay_ms};

      let targetEl = null;
      if (selector) {
        targetEl = document.querySelector(selector);
        if (!targetEl) {
          throw new Error('Element not found: ' + selector);
        }
        targetEl.focus();
      } else {
        targetEl = document.activeElement;
        if (!targetEl || targetEl === document.body) {
          throw new Error('No focused element. Provide a selector or focus an element first.');
        }
      }

      // Type each character
      for (const char of text) {
        targetEl.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        targetEl.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));

        // Update value for input elements
        if (targetEl.value !== undefined) {
          targetEl.value += char;
          targetEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        targetEl.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));

        if (delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }

      // Trigger change event after typing
      targetEl.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        success: true,
        characters_typed: text.length,
        element: {
          tagName: targetEl.tagName,
          id: targetEl.id || null,
          value: targetEl.value || null
        }
      };
    })()
  `;

  try {
    sessions.emit && sessions.emit({ session_id, type: 'keyboard:type_start', payload: { text: text.substring(0, 50) } });
    const result = await RuntimeManager.executeJS(null, script, session_id);
    sessions.emit && sessions.emit({ session_id, type: 'keyboard:type_complete', payload: { characters: result.characters_typed } });
    return result;
  } catch (err) {
    const e = new Error(`Keyboard type failed: ${err.message}`);
    e.code = 'KEYBOARD_TYPE_FAILED';
    throw e;
  }
}

/**
 * Discover all interactive elements on the current page
 * Returns structured data about forms, buttons, inputs, assessments
 */
async function scorm_dom_find_interactive_elements(params = {}) {
  const session_id = params.session_id;

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  try {
    const result = await RuntimeManager.executeJS(null, `
      (() => {
        const result = {
          forms: [],
          buttons: [],
          inputs: [],
          assessments: [],
          navigation: [],
          interactive_elements: []
        };

        // Find all forms
        document.querySelectorAll('form').forEach((form, formIndex) => {
          const formData = {
            selector: form.id ? '#' + form.id : 'form:nth-of-type(' + (formIndex + 1) + ')',
            id: form.id || null,
            name: form.name || null,
            action: form.action || null,
            method: form.method || null,
            inputs: [],
            submit_button: null
          };

          // Find inputs within this form
          form.querySelectorAll('input, select, textarea').forEach(input => {
            const inputData = {
              selector: input.id ? '#' + input.id : null,
              type: input.type || input.tagName.toLowerCase(),
              name: input.name || null,
              id: input.id || null,
              value: input.value || null,
              checked: input.checked || null,
              label: null,
              placeholder: input.placeholder || null,
              required: input.required || false
            };

            // Try to find associated label
            if (input.id) {
              const label = document.querySelector('label[for="' + input.id + '"]');
              if (label) inputData.label = label.textContent.trim();
            }
            if (!inputData.label) {
              const parentLabel = input.closest('label');
              if (parentLabel) inputData.label = parentLabel.textContent.trim();
            }

            formData.inputs.push(inputData);
          });

          // Find submit button
          const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
          if (submitBtn) {
            formData.submit_button = {
              selector: submitBtn.id ? '#' + submitBtn.id : null,
              text: submitBtn.textContent?.trim() || submitBtn.value || 'Submit',
              type: submitBtn.type
            };
          }

          result.forms.push(formData);
        });

        // Find standalone buttons (not in forms)
        document.querySelectorAll('button:not(form button), input[type="button"], a[role="button"]').forEach(btn => {
          const text = btn.textContent?.trim() || btn.value || btn.getAttribute('aria-label') || '';
          const btnData = {
            selector: btn.id ? '#' + btn.id : null,
            text: text,
            type: btn.type || 'button',
            purpose: null,
            disabled: btn.disabled || false
          };

          // Infer purpose from text/class
          const lowerText = text.toLowerCase();
          const className = btn.className || '';
          if (lowerText.includes('next') || className.includes('next')) {
            btnData.purpose = 'navigation_next';
          } else if (lowerText.includes('prev') || lowerText.includes('back') || className.includes('prev')) {
            btnData.purpose = 'navigation_previous';
          } else if (lowerText.includes('submit') || className.includes('submit')) {
            btnData.purpose = 'submit';
          } else if (lowerText.includes('menu') || className.includes('menu')) {
            btnData.purpose = 'menu';
          }

          result.buttons.push(btnData);
        });

        // Find all standalone inputs (not in forms)
        document.querySelectorAll('input:not(form input), select:not(form select), textarea:not(form textarea)').forEach(input => {
          const inputData = {
            selector: input.id ? '#' + input.id : null,
            type: input.type || input.tagName.toLowerCase(),
            name: input.name || null,
            id: input.id || null,
            value: input.value || null,
            label: null
          };

          if (input.id) {
            const label = document.querySelector('label[for="' + input.id + '"]');
            if (label) inputData.label = label.textContent.trim();
          }

          result.inputs.push(inputData);
        });

        // Try to detect assessment patterns
        const questionContainers = document.querySelectorAll('[class*="question"], [id*="question"], [data-question]');
        questionContainers.forEach((container, idx) => {
          const assessment = {
            type: null,
            question_text: null,
            question_id: container.id || 'question-' + idx,
            answers: [],
            container_selector: container.id ? '#' + container.id : null
          };

          // Extract question text
          const questionText = container.querySelector('[class*="question-text"], [class*="prompt"], h3, h4, p');
          if (questionText) {
            assessment.question_text = questionText.textContent.trim();
          }

          // Find answer options
          const radioInputs = container.querySelectorAll('input[type="radio"]');
          const checkboxInputs = container.querySelectorAll('input[type="checkbox"]');

          if (radioInputs.length > 0) {
            assessment.type = 'multiple_choice';
            radioInputs.forEach(radio => {
              const label = document.querySelector('label[for="' + radio.id + '"]') || radio.closest('label');
              assessment.answers.push({
                selector: radio.id ? '#' + radio.id : null,
                value: radio.value,
                label: label ? label.textContent.trim() : null,
                name: radio.name
              });
            });
          } else if (checkboxInputs.length > 0) {
            assessment.type = 'multiple_select';
            checkboxInputs.forEach(checkbox => {
              const label = document.querySelector('label[for="' + checkbox.id + '"]') || checkbox.closest('label');
              assessment.answers.push({
                selector: checkbox.id ? '#' + checkbox.id : null,
                value: checkbox.value,
                label: label ? label.textContent.trim() : null,
                name: checkbox.name
              });
            });
          }

          if (assessment.answers.length > 0) {
            result.assessments.push(assessment);
          }
        });

        return result;
      })()
    `, session_id);

    return result;
  } catch (error) {
    const e = new Error(error?.message || String(error));
    e.code = 'DOM_FIND_ERROR';
    throw e;
  }
}

/**
 * Fill multiple form fields in a single batch operation
 */
async function scorm_dom_fill_form_batch(params = {}) {
  const session_id = params.session_id;
  const fields = params.fields || [];

  if (!session_id || typeof session_id !== 'string') {
    const e = new Error('session_id is required');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  if (!Array.isArray(fields) || fields.length === 0) {
    const e = new Error('fields array is required and must not be empty');
    e.code = 'MCP_INVALID_PARAMS';
    throw e;
  }

  // Check if runtime is open via IPC
  const status = await RuntimeManager.getRuntimeStatus(session_id);
  if (!status || !status.open) {
    const e = new Error('Runtime not open');
    e.code = 'RUNTIME_NOT_OPEN';
    throw e;
  }

  const results = [];
  const errors = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    try {
      // Use existing scorm_dom_fill for each field
      await scorm_dom_fill({
        session_id,
        selector: field.selector,
        value: field.value,
        options: field.options || {}
      });

      results.push({
        index: i,
        selector: field.selector,
        success: true
      });
    } catch (error) {
      errors.push({
        index: i,
        selector: field.selector,
        error: error.message || String(error),
        error_code: error.code
      });

      results.push({
        index: i,
        selector: field.selector,
        success: false,
        error: error.message || String(error)
      });
    }
  }

  return {
    total_fields: fields.length,
    successful: results.filter(r => r.success).length,
    failed: errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined
  };
}

module.exports = {
  scorm_dom_click,
  scorm_dom_fill,
  scorm_dom_query,
  scorm_dom_evaluate,
  scorm_dom_wait_for,
  scorm_keyboard_type,
  scorm_dom_find_interactive_elements,
  scorm_dom_fill_form_batch
};

