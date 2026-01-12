/**
 * Model Service for ACP
 *
 * Fetches and caches available models from the Roo Code API.
 */

import type { AcpModel, AcpModelState } from "./types.js"
import { DEFAULT_MODELS } from "./types.js"
import { acpLog } from "./logger.js"

// =============================================================================
// Types
// =============================================================================

export interface ModelServiceOptions {
	/** Base URL for the API (defaults to https://api.roocode.com) */
	apiUrl?: string
	/** API key for authentication */
	apiKey?: string
	/** Request timeout in milliseconds (defaults to 5000) */
	timeout?: number
}

/**
 * Response structure from /proxy/v1/models endpoint.
 * Based on OpenAI-compatible model listing format.
 */
interface ModelsApiResponse {
	object?: string
	data?: Array<{
		id: string
		object?: string
		created?: number
		owned_by?: string
		// Additional fields may be present
	}>
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_API_URL = "https://api.roocode.com"
const DEFAULT_TIMEOUT = 5000

// =============================================================================
// ModelService Class
// =============================================================================

/**
 * Service for fetching and managing available models.
 */
export class ModelService {
	private readonly apiUrl: string
	private readonly apiKey?: string
	private readonly timeout: number
	private cachedModels: AcpModel[] | null = null

	constructor(options: ModelServiceOptions = {}) {
		this.apiUrl = options.apiUrl || DEFAULT_API_URL
		this.apiKey = options.apiKey
		this.timeout = options.timeout || DEFAULT_TIMEOUT
	}

	/**
	 * Fetch available models from the API.
	 * Returns cached models if available, otherwise fetches from API.
	 * Falls back to default models on error.
	 */
	async fetchAvailableModels(): Promise<AcpModel[]> {
		// Return cached models if available
		if (this.cachedModels) {
			return this.cachedModels
		}

		try {
			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), this.timeout)

			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			}

			if (this.apiKey) {
				headers["Authorization"] = `Bearer ${this.apiKey}`
			}

			const response = await fetch(`${this.apiUrl}/proxy/v1/models`, {
				method: "GET",
				headers,
				signal: controller.signal,
			})

			clearTimeout(timeoutId)

			if (!response.ok) {
				acpLog.warn("ModelService", `API returned ${response.status}, using default models`)
				this.cachedModels = DEFAULT_MODELS
				return this.cachedModels
			}

			const data = (await response.json()) as ModelsApiResponse

			if (!data.data || !Array.isArray(data.data)) {
				acpLog.warn("ModelService", "Invalid API response format, using default models")
				this.cachedModels = DEFAULT_MODELS
				return this.cachedModels
			}

			// Transform API response to AcpModel format
			this.cachedModels = this.transformApiResponse(data.data)
			acpLog.debug("ModelService", `Fetched ${this.cachedModels.length} models from API`)

			return this.cachedModels
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				acpLog.warn("ModelService", "Request timed out, using default models")
			} else {
				acpLog.warn(
					"ModelService",
					`Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
			this.cachedModels = DEFAULT_MODELS
			return this.cachedModels
		}
	}

	/**
	 * Get the current model state including available models and current selection.
	 */
	async getModelState(currentModelId: string): Promise<AcpModelState> {
		const availableModels = await this.fetchAvailableModels()

		// Validate that currentModelId exists in available models
		const modelExists = availableModels.some((m) => m.modelId === currentModelId)
		const effectiveModelId = modelExists ? currentModelId : DEFAULT_MODELS[0]!.modelId

		return {
			availableModels,
			currentModelId: effectiveModelId,
		}
	}

	/**
	 * Clear the cached models, forcing a refresh on next fetch.
	 */
	clearCache(): void {
		this.cachedModels = null
	}

	/**
	 * Transform API response to AcpModel format.
	 */
	private transformApiResponse(
		data: Array<{
			id: string
			object?: string
			created?: number
			owned_by?: string
		}>,
	): AcpModel[] {
		// If API returns models, transform them
		// For now, we'll create a simple mapping
		// In practice, the API should return model metadata including pricing
		const models: AcpModel[] = []

		const defaultModel = DEFAULT_MODELS[0]!

		// Always include the default model first (shows actual model name)
		models.push(defaultModel)

		// Add models from API response
		for (const model of data) {
			// Skip if it's already in our list or if it's a system model
			if (model.id === defaultModel.modelId || model.id.startsWith("_")) {
				continue
			}

			models.push({
				modelId: model.id,
				name: this.formatModelName(model.id),
				description: model.owned_by ? `Provided by ${model.owned_by}` : undefined,
			})
		}

		// If no models from API, return defaults
		if (models.length === 1) {
			return DEFAULT_MODELS
		}

		return models
	}

	/**
	 * Format a model ID into a human-readable name.
	 */
	private formatModelName(modelId: string): string {
		// Convert model IDs like "anthropic/claude-3-sonnet" to "Claude 3 Sonnet"
		const parts = modelId.split("/")
		const name = parts[parts.length - 1] || modelId

		return name
			.split("-")
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ")
	}
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new ModelService instance.
 */
export function createModelService(options?: ModelServiceOptions): ModelService {
	return new ModelService(options)
}
