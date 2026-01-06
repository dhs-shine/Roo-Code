export type MessageRole = "system" | "user" | "assistant" | "tool" | "thinking"

/**
 * Ask types that require user input.
 */
export type AskType =
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

/**
 * Say types for display-only messages.
 */
export type SayType =
	| "text"
	| "reasoning"
	| "thinking"
	| "command_output"
	| "completion_result"
	| "error"
	| "tool"
	| "api_req_started"
	| "user_feedback"
	| "checkpoint_saved"

/**
 * A message displayed in the TUI message list.
 */
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
}

/**
 * A pending ask that requires user response.
 */
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
}

export type View = "UserInput" | "AgentResponse" | "ToolUse" | "Default"
