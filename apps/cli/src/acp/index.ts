// Main agent exports
export { type RooCodeAgentOptions, RooCodeAgent } from "./agent.js"
export { type AcpSessionOptions, AcpSession } from "./session.js"

// Types for mode and model pickers
export type { AcpModel, AcpModelState, ExtendedNewSessionResponse } from "./types.js"
export { DEFAULT_MODELS } from "./types.js"

// Model service
export { ModelService, createModelService, type ModelServiceOptions } from "./model-service.js"

// Interfaces for dependency injection
export type {
	IAcpLogger,
	IAcpSession,
	IContentFormatter,
	IExtensionClient,
	IExtensionHost,
	IDeltaTracker,
	IPromptStateMachine,
	ICommandStreamManager,
	IToolContentStreamManager,
	AcpSessionDependencies,
	SendUpdateFn,
	PromptStateType,
	PromptCompletionResult,
	StreamManagerOptions,
} from "./interfaces.js"
export { NullLogger } from "./interfaces.js"

// Logger
export { acpLog } from "./logger.js"

// Utilities
export { DeltaTracker } from "./delta-tracker.js"

// Shared utility functions
export {
	// Result type
	type Result,
	ok,
	err,
	// Formatting functions
	formatSearchResults,
	formatReadContent,
	wrapInCodeBlock,
	// Content extraction
	extractContentFromParams,
	// File operations
	readFileContent,
	readFileContentAsync,
	resolveFilePath,
	resolveFilePathUnsafe,
	// Validation
	isUserEcho,
	hasValidFilePath,
	// Config
	type FormatConfig,
	DEFAULT_FORMAT_CONFIG,
} from "./utils/index.js"

// Tool Registry
export {
	// Categories
	TOOL_CATEGORIES,
	type ToolCategory,
	type KnownToolName,
	// Detection functions
	isEditTool,
	isReadTool,
	isSearchTool,
	isListFilesTool,
	isExecuteTool,
	isDeleteTool,
	isMoveTool,
	isThinkTool,
	isFetchTool,
	isSwitchModeTool,
	isFileWriteTool,
	// Kind mapping
	mapToolToKind,
	// Validation schemas
	FilePathParamsSchema,
	FileWriteParamsSchema,
	FileMoveParamsSchema,
	SearchParamsSchema,
	ListFilesParamsSchema,
	CommandParamsSchema,
	ThinkParamsSchema,
	SwitchModeParamsSchema,
	GenericToolParamsSchema,
	ToolMessageSchema,
	// Parameter types
	type FilePathParams,
	type FileWriteParams,
	type FileMoveParams,
	type SearchParams,
	type ListFilesParams,
	type CommandParams,
	type ThinkParams,
	type SwitchModeParams,
	type GenericToolParams,
	type ToolParams,
	type ToolMessage,
	// Validation functions
	type ValidationResult,
	validateToolParams,
	parseToolParams,
	parseToolMessage,
} from "./tool-registry.js"

// State management
export { PromptStateMachine, createPromptStateMachine, type PromptStateMachineOptions } from "./prompt-state.js"

// Content formatting
export {
	// Direct function exports (preferred for simple use)
	formatToolResult,
	extractFileContent,
	extractFileContentAsync,
	// Re-exported utilities
	formatSearchResults as formatSearch,
	formatReadContent as formatRead,
	wrapInCodeBlock as wrapCode,
	isUserEcho as checkUserEcho,
	// Class-based DI
	ContentFormatter,
	createContentFormatter,
	type ContentFormatterConfig,
} from "./content-formatter.js"

// Tool handlers
export {
	type ToolHandler,
	type ToolHandlerContext,
	type ToolHandleResult,
	ToolHandlerRegistry,
	// Individual handlers for extension
	CommandToolHandler,
	FileEditToolHandler,
	FileReadToolHandler,
	SearchToolHandler,
	ListFilesToolHandler,
	DefaultToolHandler,
} from "./tool-handler.js"

// Stream managers
export { CommandStreamManager, type PendingCommand, type CommandStreamManagerOptions } from "./command-stream.js"
export { ToolContentStreamManager, type ToolContentStreamManagerOptions } from "./tool-content-stream.js"

// Session event handler
export {
	SessionEventHandler,
	createSessionEventHandler,
	type SessionEventHandlerDeps,
	type TaskCompletedCallback,
} from "./session-event-handler.js"

// Translation utilities
export {
	// Message translation
	translateToAcpUpdate,
	isPermissionAsk,
	isCompletionAsk,
	createPermissionOptions,
	// Tool parsing
	parseToolFromMessage,
	generateToolTitle,
	extractToolContent,
	buildToolCallFromMessage,
	type ToolCallInfo,
	// Prompt extraction
	extractPromptText,
	extractPromptImages,
	extractPromptResources,
	// Location extraction
	extractLocations,
	extractFilePathsFromSearchResults,
	type LocationParams,
	// Diff parsing
	parseUnifiedDiff,
	isUnifiedDiff,
	type ParsedDiff,
	// Backward compatibility
	mapToolKind,
} from "./translator.js"
