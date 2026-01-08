import type { ClineAsk, ClineSay, TodoItem } from "@roo-code/types"

import type { GlobalCommandAction } from "../globalCommands.js"

// Re-export TodoItem for convenience
export type { TodoItem }

export type MessageRole = "system" | "user" | "assistant" | "tool" | "thinking"

export type AskType = Extract<
	ClineAsk,
	| "followup"
	| "command"
	| "command_output"
	| "tool"
	| "browser_action_launch"
	| "use_mcp_server"
	| "api_req_failed"
	| "resume_task"
	| "resume_completed_task"
	| "completion_result"
>

export type SayType =
	| Extract<
			ClineSay,
			| "text"
			| "reasoning"
			| "command_output"
			| "completion_result"
			| "error"
			| "api_req_started"
			| "user_feedback"
			| "checkpoint_saved"
	  >
	| "thinking"
	| "tool"

/**
 * Structured tool data for rich rendering
 * Extracted from tool JSON payloads for tool-specific layouts
 */
export interface ToolData {
	/** Tool identifier (e.g., "readFile", "appliedDiff", "searchFiles") */
	tool: string

	// File operation fields
	/** File path */
	path?: string
	/** Whether the file is outside the workspace */
	isOutsideWorkspace?: boolean
	/** Whether the file is write-protected */
	isProtected?: boolean
	/** Unified diff content */
	diff?: string
	/** Diff statistics */
	diffStats?: { added: number; removed: number }
	/** General content (file content, search results, etc.) */
	content?: string

	// Search operation fields
	/** Search regex pattern */
	regex?: string
	/** File pattern filter */
	filePattern?: string
	/** Search query (for codebase search) */
	query?: string

	// Mode operation fields
	/** Target mode slug */
	mode?: string
	/** Reason for mode switch or other actions */
	reason?: string

	// Command operation fields
	/** Command string */
	command?: string
	/** Command output */
	output?: string

	// Browser operation fields
	/** Browser action type */
	action?: string
	/** Browser URL */
	url?: string
	/** Click/hover coordinates */
	coordinate?: string

	// Batch operation fields
	/** Batch file reads */
	batchFiles?: Array<{
		path: string
		lineSnippet?: string
		isOutsideWorkspace?: boolean
		key?: string
		content?: string
	}>
	/** Batch diff operations */
	batchDiffs?: Array<{
		path: string
		changeCount?: number
		key?: string
		content?: string
		diffStats?: { added: number; removed: number }
		diffs?: Array<{
			content: string
			startLine?: number
		}>
	}>

	// Question/completion fields
	/** Question text for ask_followup_question */
	question?: string
	/** Result text for attempt_completion */
	result?: string

	// Additional display hints
	/** Line number for context */
	lineNumber?: number
	/** Additional file count for batch operations */
	additionalFileCount?: number
}

export interface TUIMessage {
	id: string
	role: MessageRole
	content: string
	toolName?: string
	toolDisplayName?: string
	toolDisplayOutput?: string
	hasPendingToolCalls?: boolean
	partial?: boolean
	originalType?: SayType | AskType
	/** TODO items for update_todo_list tool messages */
	todos?: TodoItem[]
	/** Previous TODO items for diff display */
	previousTodos?: TodoItem[]
	/** Structured tool data for rich rendering */
	toolData?: ToolData
}

export interface PendingAsk {
	id: string
	type: AskType
	content: string
	suggestions?: Array<{ answer: string; mode?: string | null }>
}

export interface AppProps {
	initialPrompt: string
	workspacePath: string
	extensionPath: string
	apiProvider: string
	apiKey: string
	model: string
	mode: string
	nonInteractive: boolean
	verbose: boolean
	debug: boolean
	exitOnComplete: boolean
	reasoningEffort?: string
	/** Run in ephemeral mode - no state persists after this session */
	ephemeral?: boolean
	version: string
}

export type View = "UserInput" | "AgentResponse" | "ToolUse" | "Default"

export interface FileSearchResult {
	path: string
	type: "file" | "folder"
	label?: string
}

export interface SlashCommandResult {
	name: string
	description?: string
	argumentHint?: string
	source: "global" | "project" | "built-in"
	/** Action to trigger for CLI global commands (e.g., clearTask for /new) */
	action?: GlobalCommandAction
}

export interface ModeResult {
	slug: string
	name: string
	description?: string
	icon?: string
}

/**
 * Task history item for the CLI.
 * Subset of HistoryItem from @roo-code/types with fields needed for display and resumption.
 */
export interface TaskHistoryItem {
	/** Unique task ID */
	id: string
	/** Task prompt/description */
	task: string
	/** Timestamp when task was created */
	ts: number
	/** Total cost of the task */
	totalCost?: number
	/** Workspace path where task was run */
	workspace?: string
	/** Mode the task was run in */
	mode?: string
	/** Task status */
	status?: "active" | "completed" | "delegated"
	/** Tokens consumed */
	tokensIn?: number
	tokensOut?: number
}
