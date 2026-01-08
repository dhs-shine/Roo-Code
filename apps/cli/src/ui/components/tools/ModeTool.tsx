import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import { Icon } from "../Icon.js"

import type { ToolRendererProps } from "./types.js"
import { getToolIconName } from "./utils.js"

export function ModeTool({ toolData }: ToolRendererProps) {
	const iconName = getToolIconName(toolData.tool)
	const mode = toolData.mode || ""
	const isSwitch = toolData.tool.includes("switch") || toolData.tool.includes("Switch")

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Header */}
			<Box>
				<Icon name={iconName} color={theme.toolHeader} />
				{isSwitch && mode && (
					<Box>
						<Text color={theme.dimText}>Switching to</Text>
						<Text color={theme.userHeader} bold>
							{mode}
						</Text>
					</Box>
				)}
			</Box>
		</Box>
	)
}
