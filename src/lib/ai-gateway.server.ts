import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function createLovableAiGatewayProvider(apiKey?: string) {
  const baseURL = process.env.OLLAMA_BASE_URL || "https://ai.gateway.lovable.dev/v1";
  return createOpenAICompatible({
    name: "ollama",
    baseURL,
    headers: apiKey ? { "Lovable-API-Key": apiKey } : {},
  });
}

