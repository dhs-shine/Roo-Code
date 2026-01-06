/**
 * TextInput Component - User input field for the TUI
 * Uses @inkjs/ui TextInput for ink v6 compatibility
 */

import { Box, Text, useInput } from "ink"
import { TextInput as InkTextInput } from "@inkjs/ui"
import { useState, useCallback } from "react"

export interface TextInputProps {
	/** Current input value */
	value: string
	/** Called when input changes */
	onChange: (value: string) => void
	/** Called when user submits input */
	onSubmit: (value: string) => void
	/** Placeholder text when empty */
	placeholder?: string
	/** Whether input is disabled */
	disabled?: boolean
}

/**
 * Text input component with submit handling
 */
export function TextInput({
	value,
	onChange,
	onSubmit,
	placeholder = "Type your message...",
	disabled = false,
}: TextInputProps) {
	const handleSubmit = useCallback(
		(inputValue: string) => {
			const trimmed = inputValue.trim()
			if (trimmed && !disabled) {
				onSubmit(trimmed)
				onChange("") // Clear input after submit
			}
		},
		[onSubmit, onChange, disabled],
	)

	if (disabled) {
		return (
			<Box borderStyle="bold" borderColor="gray" paddingX={1}>
				<Text color="gray" dimColor>
					{placeholder}
				</Text>
			</Box>
		)
	}

	return (
		<Box borderStyle="bold" borderColor="blue" paddingX={1}>
			<InkTextInput defaultValue={value} placeholder={placeholder} onSubmit={handleSubmit} />
		</Box>
	)
}

export interface ApprovalPromptProps {
	/** The question or action to approve */
	message: string
	/** Suggested answers (for followup questions) */
	suggestions?: Array<{ answer: string; mode?: string | null }>
	/** Called when user approves */
	onApprove: () => void
	/** Called when user rejects */
	onReject: () => void
	/** Called when user provides text response */
	onTextResponse?: (text: string) => void
}

/**
 * Approval prompt for yes/no decisions
 */
export function ApprovalPrompt({ message, suggestions, onApprove, onReject, onTextResponse }: ApprovalPromptProps) {
	const [inputValue, _setInputValue] = useState("")

	// Handle keyboard input for Y/N
	useInput((input) => {
		const lower = input.toLowerCase()
		if (lower === "y") {
			onApprove()
		} else if (lower === "n") {
			onReject()
		} else if (suggestions && !isNaN(parseInt(input, 10))) {
			const index = parseInt(input, 10) - 1
			const suggestion = suggestions[index]
			if (index >= 0 && index < suggestions.length && suggestion) {
				onTextResponse?.(suggestion.answer)
			}
		}
	})

	return (
		<Box flexDirection="column" borderStyle="bold" borderColor="yellow" paddingX={1}>
			<Text color="yellow" bold>
				{message}
			</Text>

			{suggestions && suggestions.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text color="gray">Suggestions:</Text>
					{suggestions.map((suggestion, index) => (
						<Box key={index}>
							<Text color="cyan">
								{index + 1}. {suggestion.answer}
								{suggestion.mode && (
									<Text color="gray" dimColor>
										{" "}
										(mode: {suggestion.mode})
									</Text>
								)}
							</Text>
						</Box>
					))}
				</Box>
			)}

			<Box marginTop={1}>
				{onTextResponse ? (
					<Box flexDirection="column">
						<Text color="gray">
							Type a number (1-{suggestions?.length || 0}), type your answer, or press{" "}
							<Text color="green" bold>
								Y
							</Text>
							/
							<Text color="red" bold>
								N
							</Text>
						</Text>
						<Box marginTop={1} borderStyle="bold" borderColor="blue" paddingX={1}>
							<InkTextInput
								defaultValue={inputValue}
								placeholder="Your response..."
								onSubmit={(val) => {
									if (val.trim()) {
										onTextResponse(val.trim())
									}
								}}
							/>
						</Box>
					</Box>
				) : (
					<Text color="gray">
						Press{" "}
						<Text color="green" bold>
							Y
						</Text>{" "}
						to approve,{" "}
						<Text color="red" bold>
							N
						</Text>{" "}
						to reject
					</Text>
				)}
			</Box>
		</Box>
	)
}
