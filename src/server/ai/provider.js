import "server-only"; // boundary: never import this module from a Client Component

// Groq provider adapter — the only file in the codebase allowed to talk to
// the provider. Feature components and the route handler stay provider-neutral.

import { AIAppError } from "./config.js";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

// Server-side failure log (one line per provider failure) — the only way to
// distinguish truncation vs outage vs rate-limit from the dev/production log,
// since the client only ever sees the friendly message.
function logProviderFailure(code, message, detail = {}) {
  console.error(
    `[learnary-ai:provider] ${code}: ${message}`,
    Object.keys(detail).length ? JSON.stringify(detail) : ""
  );
}

/**
 * Provider-neutral generation call. No retries: a retry is the route's
 * idempotent replay or the user's explicit action, never a hidden loop.
 *
 * @param {object} params
 * @param {string} params.model       configured server-side (GROQ_MODEL)
 * @param {Array<{role: "system"|"user"|"assistant", content: string}>} params.messages
 * @param {number} params.maxOutputTokens
 * @param {number} [params.temperature]
 * @param {string} params.apiKey      Groq secret (server-side only)
 * @param {number} params.timeoutMs
 * @returns {Promise<{content: string, model: string, usage?: {
 *   promptTokens?: number, completionTokens?: number
 * }, providerRequestId?: string}>}
 */
export async function generate({
  model,
  messages,
  maxOutputTokens,
  temperature = 0.7,
  apiKey,
  timeoutMs,
}) {
  if (!apiKey || !model) {
    // Misconfiguration is distinct from an outage: fail fast instead of
    // sending `model: null` and surfacing the provider's 400 as "unavailable".
    logProviderFailure("AI_MISCONFIGURED", "missing provider credentials", {
      hasKey: Boolean(apiKey),
      hasModel: Boolean(model),
    });
    throw new AIAppError(
      "AI_MISCONFIGURED",
      "This feature is not configured on the server yet."
    );
  }

  const effectiveTimeout =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

  // The timer deliberately spans the body read too. A provider that accepts
  // the connection but stalls the JSON body must not hang the route.
  try {
    const response = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_completion_tokens: maxOutputTokens,
        temperature,
      }),
      signal: controller.signal,
    });

    // Respect provider 429 + retry-after metadata.
    if (response.status === 429) {
      const retryAfter = Number.parseInt(
        response.headers.get("retry-after") ?? "",
        10
      );
      logProviderFailure("AI_RATE_LIMITED", "provider 429", {
        model,
        retry_after: response.headers.get("retry-after"),
      });
      throw new AIAppError(
        "AI_RATE_LIMITED",
        "The service is temporarily busy. Please try again shortly.",
        Number.isFinite(retryAfter) && retryAfter > 0
          ? { retry_after_seconds: retryAfter }
          : {}
      );
    }

    if (response.status === 403) {
      // Groq answers 403 "Access denied. Please check your network settings."
      // when the CALLER'S NETWORK/REGION is blocked — before it even looks at
      // the key. That is not a credentials problem, and the user can act on it,
      // so it gets its own code instead of a vague "misconfigured" message.
      const body = await response.text().catch(() => "");
      if (/access denied|network settings/i.test(body)) {
        logProviderFailure(
          "AI_PROVIDER_BLOCKED",
          "provider 403: network/region block",
          { model }
        );
        throw new AIAppError(
          "AI_PROVIDER_BLOCKED",
          "The AI provider is blocking requests from this network or region. Try a different network (or turn off any VPN), or run the deployment from a supported region."
        );
      }
      // Some other 403: treat as misconfiguration and never echo the body.
      logProviderFailure("AI_MISCONFIGURED", "provider 403", { model });
      throw new AIAppError(
        "AI_MISCONFIGURED",
        "This service is misconfigured on the server. Please contact the app owner."
      );
    }

    if (response.status === 401) {
      // Provider-side auth problem: never echo provider error bodies.
      logProviderFailure("AI_MISCONFIGURED", "provider 401", {
        model,
      });
      throw new AIAppError(
        "AI_MISCONFIGURED",
        "This service is misconfigured on the server. Please contact the app owner."
      );
    }

    if (response.status === 400 || response.status === 404) {
      // Usually a bad/retired model id. Distinct from an outage so the owner
      // can tell misconfiguration from a temporary failure.
      logProviderFailure("AI_MISCONFIGURED", `provider ${response.status}`, {
        model,
      });
      throw new AIAppError(
        "AI_MISCONFIGURED",
        "The assistant model is not available with the current configuration."
      );
    }

    if (!response.ok) {
      logProviderFailure("AI_PROVIDER_UNAVAILABLE", `provider ${response.status}`, {
        model,
      });
      throw new AIAppError(
        "AI_PROVIDER_UNAVAILABLE",
        "This service is temporarily unavailable. Please try again later."
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch (parseError) {
      // An abort while reading the body is still a timeout, not bad JSON.
      if (parseError?.name === "AbortError") throw parseError;
      logProviderFailure("AI_INVALID_RESPONSE", "response was not JSON", { model });
      throw new AIAppError(
        "AI_INVALID_RESPONSE",
        "An unreadable response was returned. Please try again."
      );
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      // Empty content typically means the model spent the whole budget on
      // reasoning (finish_reason: "length") — surfaced as invalid for us.
      logProviderFailure("AI_INVALID_RESPONSE", "empty content", {
        model,
        finish_reason: payload?.choices?.[0]?.finish_reason,
        completion_tokens: payload?.usage?.completion_tokens,
      });
      throw new AIAppError(
        "AI_INVALID_RESPONSE",
        "An unexpected response was returned. Please try again."
      );
    }

    // Truncated structured output (reasoning models spend completion tokens on
    // reasoning, so long JSON can hit the budget) — logged, and the parsers
    // downstream will reject the malformed JSON with the same code.
    if (payload?.choices?.[0]?.finish_reason === "length") {
      logProviderFailure("AI_INVALID_RESPONSE", "output truncated (finish_reason=length)", {
        model,
        completion_tokens: payload?.usage?.completion_tokens,
      });
    }

    return {
      content,
      model: payload?.model ?? model,
      finishReason: payload?.choices?.[0]?.finish_reason ?? undefined,
      usage: payload?.usage
        ? {
            promptTokens: payload.usage.prompt_tokens,
            completionTokens: payload.usage.completion_tokens,
          }
        : undefined,
      providerRequestId: payload?.id,
    };
  } catch (error) {
    if (error instanceof AIAppError) throw error;

    if (error?.name === "AbortError") {
      logProviderFailure(
        "AI_PROVIDER_TIMEOUT",
        `aborted after ${effectiveTimeout}ms`,
        { model }
      );
      throw new AIAppError(
        "AI_PROVIDER_TIMEOUT",
        "The request took too long to complete. Please try again."
      );
    }

    logProviderFailure("AI_PROVIDER_UNAVAILABLE", "network failure", {
      model,
      error: error?.message,
    });
    throw new AIAppError(
      "AI_PROVIDER_UNAVAILABLE",
      "This service is temporarily unavailable. Please try again later."
    );
  } finally {
    clearTimeout(timeout);
  }
}
