import type { ClineAsk, ClineSay } from "@roo-code/types"

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

export interface FileSearchResult {
	path: string
	type: "file" | "folder"
	label?: string
}
