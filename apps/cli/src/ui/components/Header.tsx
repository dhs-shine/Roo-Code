import { memo } from "react"
import { Text, Box } from "ink"

import type { TokenUsage } from "@roo-code/types"

import { useTerminalSize } from "../hooks/TerminalSizeContext.js"
import * as theme from "../theme.js"
import MetricsDisplay from "./MetricsDisplay.js"

interface HeaderProps {
	cwd: string
	model: string
	mode: string
	reasoningEffort?: string
	version: string
	tokenUsage?: TokenUsage | null
	contextWindow?: number
}

const ASCII_ROO = `  _,'   ___
 <__\\__/   \\
    \\_  /  _\\
      \\,\\ / \\\\
        //   \\\\
      ,/'     \`\\_,`

function Header({ model, cwd, mode, reasoningEffort, version, tokenUsage, contextWindow }: HeaderProps) {
	const { columns } = useTerminalSize()

	const homeDir = process.env.HOME || process.env.USERPROFILE || ""
	const displayCwd = cwd.startsWith(homeDir) ? cwd.replace(homeDir, "~") : cwd
	const title = `Roo Code CLI v${version}`
	const titlePart = `── ${title} `
	const remainingDashes = Math.max(0, columns - titlePart.length)

	// Only show metrics when we have token usage data
	const showMetrics = tokenUsage && contextWindow && contextWindow > 0

	return (
		<Box flexDirection="column" width={columns}>
			<Text color={theme.borderColor}>
				── <Text color={theme.titleColor}>{title}</Text> {"─".repeat(remainingDashes)}
			</Text>
			<Box width={columns}>
				<Box flexDirection="row">
					<Box marginY={1}>
						<Text color="magenta">{ASCII_ROO}</Text>
					</Box>
					<Box flexDirection="column" marginLeft={1} marginTop={1}>
						<Text color={theme.dimText}>Workspace: {displayCwd}</Text>
						<Text color={theme.dimText}>Mode: {mode}</Text>
						<Text color={theme.dimText}>Model: {model}</Text>
						<Text color={theme.dimText}>Reasoning: {reasoningEffort}</Text>
					</Box>
				</Box>
			</Box>
			{showMetrics && (
				<Box alignSelf="flex-end" marginTop={-1}>
					<MetricsDisplay tokenUsage={tokenUsage} contextWindow={contextWindow} />
				</Box>
			)}
			<Text color={theme.borderColor}>{"─".repeat(columns)}</Text>
		</Box>
	)
}

export default memo(Header)
