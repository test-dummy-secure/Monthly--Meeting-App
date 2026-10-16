'use strict';

// Central switch for which AI backend the whole platform uses. Every call site
// that used to do `new OllamaProvider(...)` directly should go through here
// instead — that's what makes "swap the model" a one-line env change instead
// of a code change.
//
// AI_PROVIDER=ollama (default — unset does the same) | openai | claude
// Add a new cloud provider by: implement <X>Provider extending AIProvider
// (see OpenAIProvider.js for the shape), then add one branch below.

const OllamaProvider = require('./OllamaProvider');
const OpenAIProvider = require('./OpenAIProvider');
const ClaudeProvider = require('./ClaudeProvider');

function activeProviderName() {
  return (process.env.AI_PROVIDER || 'ollama').trim().toLowerCase();
}

function getPrimaryProvider(modelOverride) {
  const active = activeProviderName();
  if (active === 'openai') {
    return new OpenAIProvider({ model: modelOverride || process.env.OPENAI_MODEL });
  }
  if (active === 'claude') {
    return new ClaudeProvider({ model: modelOverride || process.env.ANTHROPIC_MODEL });
  }
  return new OllamaProvider({ model: modelOverride || process.env.OLLAMA_MODEL });
}

// Fallback always resolves to local Ollama when the primary is a cloud provider —
// keeps a meeting's processing from dying outright if the cloud API errors or
// rate-limits, at the cost of local-model quality for that one run. When the
// primary IS already Ollama, preserve the old same-provider fallback-model behavior.
function getFallbackProvider(primary) {
  if (activeProviderName() === 'openai' || activeProviderName() === 'claude') {
    return new OllamaProvider({ model: process.env.OLLAMA_MODEL || 'llama3.1' });
  }
  const fallbackModel = process.env.OLLAMA_FALLBACK_MODEL || '';
  if (!fallbackModel || fallbackModel === primary?.name) return null;
  return new OllamaProvider({ model: fallbackModel });
}

// Transient failures (timeouts, 5xx, rate-limits, raw network errors) are worth
// retrying on the fallback provider. Anything else (bad API key, malformed
// request) should surface immediately rather than burn a second call.
function isTransientAIError(err) {
  if (!err) return false;
  if (!err.statusCode) return true; // network-level failure
  if (err.code && /TIMEOUT|HTTP_ERROR/.test(err.code)) return true;
  return err.statusCode >= 500 || err.statusCode === 429;
}

module.exports = { activeProviderName, getPrimaryProvider, getFallbackProvider, isTransientAIError };
