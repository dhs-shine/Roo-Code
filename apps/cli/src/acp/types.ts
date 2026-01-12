/**
 * ACP Types for Mode and Model Pickers
 *
 * Extends the standard ACP types with model support for the Roo Code agent.
 */

import type * as acp from "@agentclientprotocol/sdk"

// =============================================================================
// Model Types
// =============================================================================

/**
 * Represents an available model in the ACP interface.
 */
export interface AcpModel {
	/** Unique identifier for the model */
	modelId: string
	/** Human-readable name */
	name: string
	/** Optional description with details like pricing */
	description?: string
}

/**
 * State of available models and current selection.
 */
export interface AcpModelState {
	/** List of available models */
	availableModels: AcpModel[]
	/** Currently selected model ID */
	currentModelId: string
}

// =============================================================================
// Extended Response Types
// =============================================================================

/**
 * Extended NewSessionResponse that includes model state.
 * The standard ACP NewSessionResponse only includes sessionId and optional modes.
 * We extend it with models for our implementation.
 */
export interface ExtendedNewSessionResponse extends acp.NewSessionResponse {
	/** Model state for the session */
	models?: AcpModelState
}

// =============================================================================
// Default Constants
// =============================================================================

/**
 * Default models available when API is not accessible.
 * These map to Roo Code Cloud model tiers.
 */
export const DEFAULT_MODELS: AcpModel[] = [
	{
		modelId: "anthropic/claude-sonnet-4.5",
		name: "Claude Sonnet 4.5",
		description: "Best balance of speed and capability",
	},
	{
		modelId: "anthropic/claude-opus-4.5",
		name: "Claude Opus 4.5",
		description: "Most capable for complex work",
	},
	{
		modelId: "anthropic/claude-haiku-4.5",
		name: "Claude Haiku 4.5",
		description: "Fastest for quick answers",
	},
]
