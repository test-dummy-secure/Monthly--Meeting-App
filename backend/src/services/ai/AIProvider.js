'use strict';

/**
 * Abstract base class for AI providers.
 * Concrete implementations: OllamaProvider, (future: OpenAIProvider, ClaudeProvider, etc.)
 * All providers must implement generate() and expose name.
 */
class AIProvider {
  // Returns the raw text response from the AI model.
  // prompt: string
  // options: { temperature, maxTokens }
  async generate(prompt, options = {}) { // eslint-disable-line no-unused-vars
    throw new Error(`${this.constructor.name}: generate() not implemented`);
  }

  get name() {
    throw new Error(`${this.constructor.name}: name getter not implemented`);
  }
}

module.exports = AIProvider;
