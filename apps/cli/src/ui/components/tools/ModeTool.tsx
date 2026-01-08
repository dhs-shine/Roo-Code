/**
 * Renderer for mode and task operations
 * Handles: switchMode, newTask, finishTask
 */

import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import { Icon } from "../Icon.js"
import type { ToolRendererProps } from "./types.js"
import { truncateText, sanitizeContent, getToolDisplayName, getToolIconName } from "./utils.js"

const MAX_REASON_LINES = 5

export function ModeTool({ toolData }: ToolRendererProps) {
	const iconName = getToolIconName(toolData.tool)
	const displayName = getToolDisplayName(toolData.tool)
	const mode = toolData.mode || ""
	const reason = toolData.reason ? sanitizeContent(toolData.reason) : ""
	const content = toolData.content ? sanitizeContent(toolData.content) : ""

	const isSwitch = toolData.tool.includes("switch") || toolData.tool.includes("Switch")
	const isNewTask = toolData.tool.includes("new") || toolData.tool.includes("New")
	const isFinish = toolData.tool.includes("finish") || toolData.tool.includes("Finish")

	const { text: previewReason, truncated } = truncateText(reason || content, MAX_REASON_LINES)

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Header */}
			<Box>
				<Icon name={iconName} color={theme.toolHeader} />
				<Text bold color={theme.toolHeader}>
					{" "}
					{displayName}
				</Text>
			</Box>

			{/* Mode transition for switch */}
			{isSwitch && mode && (
				<Box marginLeft={2}>
					<Text color={theme.dimText}>switching to: </Text>
					<Text color={theme.userHeader} bold>
						{mode}
					</Text>
				</Box>
			)}

			{/* Mode for new task */}
			{isNewTask && mode && (
				<Box marginLeft={2}>
					<Text color={theme.dimText}>mode: </Text>
					<Text color={theme.userHeader} bold>
						{mode}
					</Text>
				</Box>
			)}

			{/* Finish task indicator */}
			{isFinish && (
				<Box marginLeft={2}>
					<Text color={theme.successColor} bold>
						Subtask completed
					</Text>
				</Box>
			)}

			{/* Reason/message */}
			{previewReason && (
				<Box flexDirection="column" marginLeft={2} marginTop={1}>
					<Text color={theme.dimText}>{isNewTask ? "message:" : "reason:"}</Text>
					<Box marginLeft={1}>
						<Text color={theme.toolText} italic>
							{previewReason}
						</Text>
					</Box>
					{truncated && (
						<Text color={theme.dimText} dimColor>
							...
						</Text>
					)}
				</Box>
			)}
		</Box>
	)
}
