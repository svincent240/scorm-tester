/**
 * Helper to parse MCP tool responses from JSON-RPC format.
 * 
 * MCP tools return responses in the format:
 * {
 *   jsonrpc: "2.0",
 *   id: <number>,
 *   result: {
 *     content: [{ type: "text", text: "<JSON string>" }],
 *     isError: false
 *   }
 * }
 * 
 * This helper extracts and parses the JSON data from the content array.
 */

/**
 * Parse MCP tool response and extract the data object.
 * @param {Object} response - The JSON-RPC response object
 * @returns {Object|null} The parsed data object, or null if parsing fails
 */
function parseMcpResponse(response) {
  if (!response || !response.result) {
    return null;
  }

  const result = response.result;

  // Check if it's an MCP-formatted response with content array
  if (result.content && Array.isArray(result.content) && result.content.length > 0) {
    const firstContent = result.content[0];
    if (firstContent.type === 'text' && firstContent.text) {
      try {
        return JSON.parse(firstContent.text);
      } catch (e) {
        // If parsing fails, return the raw text
        return { _raw: firstContent.text };
      }
    }
  }

  // Fallback: if it's already in the old format with .data, return that
  if (result.data !== undefined) {
    return result.data;
  }

  // Otherwise return the result as-is
  return result;
}

/**
 * Check if an MCP response indicates an error.
 * @param {Object} response - The JSON-RPC response object
 * @returns {boolean} True if the response is an error
 */
function isMcpError(response) {
  if (!response) return true;
  
  // JSON-RPC error
  if (response.error) return true;
  
  // MCP tool error
  if (response.result && response.result.isError === true) return true;
  
  return false;
}

module.exports = {
  parseMcpResponse,
  isMcpError
};

