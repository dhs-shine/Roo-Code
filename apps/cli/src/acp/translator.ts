/**
 * ACP Message Translator
 *
 * This file re-exports from the translator/ module for backward compatibility.
 * The translator has been split into focused modules for better maintainability:
 *
 * - translator/diff-parser.ts: Unified diff parsing
 * - translator/location-extractor.ts: File location extraction
 * - translator/prompt-extractor.ts: Prompt content extraction
 * - translator/tool-parser.ts: Tool information parsing
 * - translator/message-translator.ts: Main message translation
 *
 * Import from this file or directly from translator/index.ts
 */

// Re-export everything from the translator module
export {
	// Diff parsing
	parseUnifiedDiff,
	isUnifiedDiff,
	type ParsedDiff,
	// Location extraction
	extractLocations,
	extractFilePathsFromSearchResults,
	type LocationParams,
	// Prompt extraction
	extractPromptText,
	extractPromptImages,
	extractPromptResources,
	// Tool parsing
	parseToolFromMessage,
	generateToolTitle,
	extractToolContent,
	buildToolCallFromMessage,
	type ToolCallInfo,
	// Message translation
	translateToAcpUpdate,
	isPermissionAsk,
	isCompletionAsk,
	createPermissionOptions,
	// Backward compatibility
	mapToolKind,
} from "./translator/index.js"
