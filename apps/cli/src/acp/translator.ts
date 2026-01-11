/**
 * ACP Message Translator
 *
 * Translates between internal ClineMessage format and ACP protocol format.
 * This is the bridge between Roo Code's message system and the ACP protocol.
 */

import * as path from "node:path"
import type * as acp from "@agentclientprotocol/sdk"
import type { ClineMessage, ClineAsk } from "@roo-code/types"

// =============================================================================
// Types
// =============================================================================

export interface ToolCallInfo {
	id: string
	name: string
	title: string
	params: Record<string, unknown>
	locations: acp.ToolCallLocation[]
	content?: acp.ToolCallContent[]
}

// =============================================================================
// Message to ACP Update Translation
// =============================================================================

/**
 * Translate an internal ClineMessage to an ACP session update.
 * Returns null if the message type should not be sent to ACP.
 */
export function translateToAcpUpdate(message: ClineMessage): acp.SessionNotification["update"] | null {
	if (message.type === "say") {
		switch (message.say) {
			case "text":
				// Agent text output
				return {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: message.text || "" },
				}

			case "reasoning":
				// Agent reasoning/thinking
				return {
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: message.text || "" },
				}

			case "shell_integration_warning":
			case "mcp_server_request_started":
			case "mcp_server_response":
				// Tool-related messages
				return translateToolSayMessage(message)

			case "user_feedback":
				// User feedback doesn't need to be sent to ACP client
				return null

			case "error":
				// Error messages
				return {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: `Error: ${message.text || ""}` },
				}

			case "completion_result":
				// Completion is handled at prompt level
				return null

			case "api_req_started":
			case "api_req_finished":
			case "api_req_retried":
			case "api_req_retry_delayed":
			case "api_req_deleted":
				// API request lifecycle events - not sent to ACP
				return null

			case "command_output":
				// Command execution - handled through tool_call
				return null

			default:
				// Unknown message type
				return null
		}
	}

	// Ask messages are handled separately through permission flow
	return null
}

/**
 * Translate a tool say message to ACP format.
 */
function translateToolSayMessage(message: ClineMessage): acp.SessionNotification["update"] | null {
	const toolInfo = parseToolFromMessage(message)
	if (!toolInfo) {
		return null
	}

	if (message.partial) {
		// Tool in progress
		return {
			sessionUpdate: "tool_call",
			toolCallId: toolInfo.id,
			title: toolInfo.title,
			kind: mapToolKind(toolInfo.name),
			status: "in_progress" as const,
			locations: toolInfo.locations,
			rawInput: toolInfo.params,
		}
	} else {
		// Tool completed
		return {
			sessionUpdate: "tool_call_update",
			toolCallId: toolInfo.id,
			status: "completed" as const,
			content: [],
			rawOutput: toolInfo.params,
		}
	}
}

// =============================================================================
// Tool Information Parsing
// =============================================================================

/**
 * Parse tool information from a ClineMessage.
 * @param message - The ClineMessage to parse
 * @param workspacePath - Optional workspace path to resolve relative paths
 */
export function parseToolFromMessage(message: ClineMessage, workspacePath?: string): ToolCallInfo | null {
	if (!message.text) {
		return null
	}

	// Tool messages typically have JSON content describing the tool
	try {
		// Try to parse as JSON first
		if (message.text.startsWith("{")) {
			const parsed = JSON.parse(message.text) as Record<string, unknown>
			const toolName = (parsed.tool as string) || "unknown"
			const filePath = (parsed.path as string) || undefined

			return {
				id: `tool-${message.ts}`,
				name: toolName,
				title: generateToolTitle(toolName, filePath),
				params: parsed,
				locations: extractLocations(parsed, workspacePath),
				content: extractToolContent(parsed, workspacePath),
			}
		}
	} catch {
		// Not JSON, try to extract tool info from text
	}

	// Extract tool name from text content
	const toolMatch = message.text.match(/(?:Using|Executing|Running)\s+(\w+)/i)
	const toolName = toolMatch?.[1] || "unknown"

	return {
		id: `tool-${message.ts}`,
		name: toolName,
		title: message.text.slice(0, 100),
		params: {},
		locations: [],
	}
}

/**
 * Generate a human-readable title for a tool operation.
 */
function generateToolTitle(toolName: string, filePath?: string): string {
	const fileName = filePath ? path.basename(filePath) : undefined

	// Map tool names to human-readable titles
	const toolTitles: Record<string, string> = {
		// File creation
		newFileCreated: fileName ? `Creating ${fileName}` : "Creating file",
		write_to_file: fileName ? `Writing ${fileName}` : "Writing file",
		create_file: fileName ? `Creating ${fileName}` : "Creating file",

		// File editing
		editedExistingFile: fileName ? `Edit ${fileName}` : "Edit file",
		apply_diff: fileName ? `Edit ${fileName}` : "Edit file",
		appliedDiff: fileName ? `Edit ${fileName}` : "Edit file",
		modify_file: fileName ? `Edit ${fileName}` : "Edit file",

		// File reading
		read_file: fileName ? `Read ${fileName}` : "Read file",
		readFile: fileName ? `Read ${fileName}` : "Read file",

		// File listing
		list_files: filePath ? `Listing files in ${filePath}` : "Listing files",
		listFiles: filePath ? `Listing files in ${filePath}` : "Listing files",

		// File search
		search_files: "Searching files",
		searchFiles: "Searching files",

		// Command execution
		execute_command: "Running command",
		executeCommand: "Running command",

		// Browser actions
		browser_action: "Browser action",
		browserAction: "Browser action",
	}

	return toolTitles[toolName] || (fileName ? `${toolName}: ${fileName}` : toolName)
}

/**
 * Extract file locations from tool parameters.
 * @param params - Tool parameters
 * @param workspacePath - Optional workspace path to resolve relative paths
 */
function extractLocations(params: Record<string, unknown>, workspacePath?: string): acp.ToolCallLocation[] {
	const locations: acp.ToolCallLocation[] = []
	const toolName = (params.tool as string | undefined)?.toLowerCase() || ""

	// For search tools, the 'path' parameter is a search scope directory, not a file being accessed.
	// Don't include it in locations. Instead, try to extract file paths from search results.
	if (isSearchTool(toolName)) {
		// Try to extract file paths from search results content
		const content = params.content as string | undefined
		if (content) {
			const fileLocations = extractFilePathsFromSearchResults(content, workspacePath)
			return fileLocations
		}
		return []
	}

	// For list_files tools, the 'path' is a directory being listed, which is valid to include
	// but we should mark it as a directory operation rather than a file access
	if (isListFilesTool(toolName)) {
		const dirPath = params.path as string | undefined
		if (dirPath) {
			const absolutePath = makeAbsolutePath(dirPath, workspacePath)
			locations.push({ path: absolutePath })
		}
		return locations
	}

	// Check for common path parameters (for file operations)
	const pathParams = ["path", "file", "filePath", "file_path"]
	for (const param of pathParams) {
		if (typeof params[param] === "string") {
			const filePath = params[param] as string
			const absolutePath = makeAbsolutePath(filePath, workspacePath)
			locations.push({ path: absolutePath })
		}
	}

	// Check for directory parameters separately (for directory operations)
	const dirParams = ["directory", "dir"]
	for (const param of dirParams) {
		if (typeof params[param] === "string") {
			const dirPath = params[param] as string
			const absolutePath = makeAbsolutePath(dirPath, workspacePath)
			locations.push({ path: absolutePath })
		}
	}

	// Check for paths array
	if (Array.isArray(params.paths)) {
		for (const p of params.paths) {
			if (typeof p === "string") {
				const absolutePath = makeAbsolutePath(p, workspacePath)
				locations.push({ path: absolutePath })
			}
		}
	}

	return locations
}

/**
 * Check if a tool name is a search operation.
 */
function isSearchTool(toolName: string): boolean {
	const searchTools = ["search_files", "searchfiles", "codebase_search", "codebasesearch", "grep", "ripgrep"]
	return searchTools.includes(toolName) || toolName.includes("search")
}

/**
 * Check if a tool name is a list files operation.
 */
function isListFilesTool(toolName: string): boolean {
	const listTools = ["list_files", "listfiles", "listfilestoplevel", "listfilesrecursive"]
	return listTools.includes(toolName) || toolName.includes("listfiles")
}

/**
 * Extract file paths from search results content.
 * Search results typically have format: "# path/to/file.ts" for each matched file
 */
function extractFilePathsFromSearchResults(content: string, workspacePath?: string): acp.ToolCallLocation[] {
	const locations: acp.ToolCallLocation[] = []
	const seenPaths = new Set<string>()

	// Match file headers in search results (e.g., "# src/utils.ts" or "## path/to/file.js")
	const fileHeaderPattern = /^#+\s+(.+?\.[a-zA-Z0-9]+)\s*$/gm
	let match

	while ((match = fileHeaderPattern.exec(content)) !== null) {
		const filePath = match[1]!.trim()
		// Skip if we've already seen this path or if it looks like a markdown header (not a file path)
		if (seenPaths.has(filePath) || (!filePath.includes("/") && !filePath.includes("."))) {
			continue
		}
		seenPaths.add(filePath)
		const absolutePath = makeAbsolutePath(filePath, workspacePath)
		locations.push({ path: absolutePath })
	}

	return locations
}

/**
 * Extract tool content for ACP (diffs, text, etc.)
 */
function extractToolContent(
	params: Record<string, unknown>,
	workspacePath?: string,
): acp.ToolCallContent[] | undefined {
	const content: acp.ToolCallContent[] = []

	// Check if this is a file operation with diff content
	const filePath = params.path as string | undefined
	const diffContent = params.content as string | undefined
	const toolName = params.tool as string | undefined

	if (filePath && diffContent && isFileEditTool(toolName || "")) {
		const absolutePath = makeAbsolutePath(filePath, workspacePath)
		const parsedDiff = parseUnifiedDiff(diffContent)

		if (parsedDiff) {
			// Use ACP diff format
			content.push({
				type: "diff",
				path: absolutePath,
				oldText: parsedDiff.oldText,
				newText: parsedDiff.newText,
			} as acp.ToolCallContent)
		}
	}

	return content.length > 0 ? content : undefined
}

/**
 * Parse a unified diff string to extract old and new text.
 */
function parseUnifiedDiff(diffString: string): { oldText: string | null; newText: string } | null {
	if (!diffString) {
		return null
	}

	// Check if this is a unified diff format
	if (!diffString.includes("@@") && !diffString.includes("---") && !diffString.includes("+++")) {
		// Not a diff, treat as raw content
		return { oldText: null, newText: diffString }
	}

	const lines = diffString.split("\n")
	const oldLines: string[] = []
	const newLines: string[] = []
	let inHunk = false
	let isNewFile = false

	for (const line of lines) {
		// Check for new file indicator
		if (line.startsWith("--- /dev/null")) {
			isNewFile = true
			continue
		}

		// Skip diff headers
		if (line.startsWith("===") || line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
			if (line.startsWith("@@")) {
				inHunk = true
			}
			continue
		}

		if (!inHunk) {
			continue
		}

		if (line.startsWith("-")) {
			// Removed line (old content)
			oldLines.push(line.slice(1))
		} else if (line.startsWith("+")) {
			// Added line (new content)
			newLines.push(line.slice(1))
		} else if (line.startsWith(" ") || line === "") {
			// Context line (in both old and new)
			const contextLine = line.startsWith(" ") ? line.slice(1) : line
			oldLines.push(contextLine)
			newLines.push(contextLine)
		}
	}

	return {
		oldText: isNewFile ? null : oldLines.join("\n") || null,
		newText: newLines.join("\n"),
	}
}

/**
 * Check if a tool name represents a file edit operation.
 */
function isFileEditTool(toolName: string): boolean {
	const editTools = [
		"newFileCreated",
		"editedExistingFile",
		"write_to_file",
		"apply_diff",
		"create_file",
		"modify_file",
	]
	return editTools.includes(toolName)
}

/**
 * Make a file path absolute by resolving it against the workspace path.
 */
function makeAbsolutePath(filePath: string, workspacePath?: string): string {
	if (path.isAbsolute(filePath)) {
		return filePath
	}

	if (workspacePath) {
		return path.resolve(workspacePath, filePath)
	}

	// Return as-is if no workspace path available
	return filePath
}

// =============================================================================
// Tool Kind Mapping
// =============================================================================

/**
 * Map internal tool names to ACP tool kinds.
 *
 * ACP defines these tool kinds for special UI treatment:
 * - read: Reading files or data
 * - edit: Modifying files or content
 * - delete: Removing files or data
 * - move: Moving or renaming files
 * - search: Searching for information
 * - execute: Running commands or code
 * - think: Internal reasoning or planning
 * - fetch: Retrieving external data
 * - switch_mode: Switching the current session mode
 * - other: Other tool types (default)
 */
export function mapToolKind(toolName: string): acp.ToolKind {
	const lowerName = toolName.toLowerCase()

	// Switch mode operations (check first as it's specific)
	if (lowerName.includes("switch_mode") || lowerName.includes("switchmode") || lowerName.includes("set_mode")) {
		return "switch_mode"
	}

	// Think/reasoning operations
	if (
		lowerName.includes("think") ||
		lowerName.includes("reason") ||
		lowerName.includes("plan") ||
		lowerName.includes("analyze")
	) {
		return "think"
	}

	// Search operations (check before read since "search" was previously mapped to read)
	if (lowerName.includes("search") || lowerName.includes("find") || lowerName.includes("grep")) {
		return "search"
	}

	// Delete operations (check BEFORE move since "remove" contains "move" substring)
	if (lowerName.includes("delete") || lowerName.includes("remove")) {
		return "delete"
	}

	// Move/rename operations
	if (lowerName.includes("move") || lowerName.includes("rename")) {
		return "move"
	}

	// Edit operations
	if (
		lowerName.includes("write") ||
		lowerName.includes("edit") ||
		lowerName.includes("modify") ||
		lowerName.includes("create") ||
		lowerName.includes("diff") ||
		lowerName.includes("apply")
	) {
		return "edit"
	}

	// Fetch operations (check BEFORE read since "http_get" contains "get" substring)
	if (
		lowerName.includes("browser") ||
		lowerName.includes("web") ||
		lowerName.includes("fetch") ||
		lowerName.includes("http") ||
		lowerName.includes("url")
	) {
		return "fetch"
	}

	// Read operations
	if (
		lowerName.includes("read") ||
		lowerName.includes("list") ||
		lowerName.includes("inspect") ||
		lowerName.includes("get")
	) {
		return "read"
	}

	// Command/execute operations
	if (lowerName.includes("command") || lowerName.includes("execute") || lowerName.includes("run")) {
		return "execute"
	}

	// Default to other
	return "other"
}

// =============================================================================
// Ask Type Helpers
// =============================================================================

/**
 * Ask types that require permission from the user.
 */
const PERMISSION_ASKS: ClineAsk[] = ["tool", "command", "browser_action_launch", "use_mcp_server"]

/**
 * Check if an ask type requires permission.
 */
export function isPermissionAsk(ask: ClineAsk): boolean {
	return PERMISSION_ASKS.includes(ask)
}

/**
 * Ask types that indicate task completion.
 */
const COMPLETION_ASKS: ClineAsk[] = ["completion_result", "api_req_failed", "mistake_limit_reached"]

/**
 * Check if an ask type indicates task completion.
 */
export function isCompletionAsk(ask: ClineAsk): boolean {
	return COMPLETION_ASKS.includes(ask)
}

// =============================================================================
// Prompt Content Translation
// =============================================================================

/**
 * Extract text content from ACP prompt content blocks.
 */
export function extractPromptText(prompt: acp.ContentBlock[]): string {
	const textParts: string[] = []

	for (const block of prompt) {
		switch (block.type) {
			case "text":
				textParts.push(block.text)
				break
			case "resource_link":
				// Reference to a file or resource
				textParts.push(`@${block.uri}`)
				break
			case "resource":
				// Embedded resource content
				if (block.resource && "text" in block.resource) {
					textParts.push(`Content from ${block.resource.uri}:\n${block.resource.text}`)
				}
				break
			case "image":
			case "audio":
				// Binary content - note it but don't include
				textParts.push(`[${block.type} content]`)
				break
		}
	}

	return textParts.join("\n")
}

/**
 * Extract images from ACP prompt content blocks.
 */
export function extractPromptImages(prompt: acp.ContentBlock[]): string[] {
	const images: string[] = []

	for (const block of prompt) {
		if (block.type === "image" && block.data) {
			images.push(block.data)
		}
	}

	return images
}

// =============================================================================
// Permission Options
// =============================================================================

/**
 * Create standard permission options for a tool call.
 */
export function createPermissionOptions(ask: ClineAsk): acp.PermissionOption[] {
	const baseOptions: acp.PermissionOption[] = [
		{ optionId: "allow", name: "Allow", kind: "allow_once" },
		{ optionId: "reject", name: "Reject", kind: "reject_once" },
	]

	// Add "allow always" option for certain ask types
	if (ask === "tool" || ask === "command") {
		return [{ optionId: "allow_always", name: "Always Allow", kind: "allow_always" }, ...baseOptions]
	}

	return baseOptions
}

// =============================================================================
// Tool Call Building
// =============================================================================

/**
 * Build an ACP ToolCall from a ClineMessage.
 * @param message - The ClineMessage to parse
 * @param workspacePath - Optional workspace path to resolve relative paths
 */
export function buildToolCallFromMessage(message: ClineMessage, workspacePath?: string): acp.ToolCall {
	const toolInfo = parseToolFromMessage(message, workspacePath)

	const toolCall: acp.ToolCall = {
		toolCallId: toolInfo?.id || `tool-${message.ts}`,
		title: toolInfo?.title || message.text?.slice(0, 100) || "Tool execution",
		kind: toolInfo ? mapToolKind(toolInfo.name) : "other",
		status: "pending",
		locations: toolInfo?.locations || [],
		rawInput: toolInfo?.params || {},
	}

	// Include content if available (e.g., diffs for file operations)
	if (toolInfo?.content && toolInfo.content.length > 0) {
		toolCall.content = toolInfo.content
	}

	return toolCall
}
