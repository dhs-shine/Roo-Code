import { useEffect, useRef, useCallback } from "react"
import { useApp } from "ink"
import { randomUUID } from "crypto"
import type { ExtensionMessage, WebviewMessage } from "@roo-code/types"

import { toolInspectorLog, clearToolInspectorLog } from "../../utils/toolInspectorLogger.js"
import { useCLIStore } from "../store.js"

interface ExtensionHostInterface {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	on(event: string, handler: (...args: any[]) => void): void
	activate(): Promise<void>
	runTask(prompt: string): Promise<void>
	sendToExtension(message: WebviewMessage): void
	dispose(): Promise<void>
}

export interface ExtensionHostOptions {
	mode: string
	reasoningEffort?: string
	apiProvider: string
	apiKey: string
	model: string
	workspacePath: string
	extensionPath: string
	verbose: boolean
	debug: boolean
	nonInteractive: boolean
	ephemeral?: boolean
}

export interface UseExtensionHostOptions extends ExtensionHostOptions {
	initialPrompt?: string
	exitOnComplete?: boolean
	onExtensionMessage: (msg: ExtensionMessage) => void
	createExtensionHost: (options: ExtensionHostFactoryOptions) => ExtensionHostInterface
}

interface ExtensionHostFactoryOptions {
	mode: string
	reasoningEffort?: string
	apiProvider: string
	apiKey: string
	model: string
	workspacePath: string
	extensionPath: string
	verbose: boolean
	quiet: boolean
	nonInteractive: boolean
	disableOutput: boolean
	ephemeral?: boolean
}

export interface UseExtensionHostReturn {
	isReady: boolean
	sendToExtension: ((msg: WebviewMessage) => void) | null
	runTask: ((prompt: string) => Promise<void>) | null
	cleanup: () => Promise<void>
}

/**
 * Hook to manage the extension host lifecycle.
 *
 * Responsibilities:
 * - Initialize the extension host
 * - Set up event listeners for messages, task completion, and errors
 * - Handle cleanup/disposal
 * - Expose methods for sending messages and running tasks
 */
export function useExtensionHost({
	initialPrompt,
	mode,
	reasoningEffort,
	apiProvider,
	apiKey,
	model,
	workspacePath,
	extensionPath,
	verbose,
	debug,
	nonInteractive,
	ephemeral,
	exitOnComplete,
	onExtensionMessage,
	createExtensionHost,
}: UseExtensionHostOptions): UseExtensionHostReturn {
	const { exit } = useApp()
	const { addMessage, setComplete, setLoading, setHasStartedTask, setError } = useCLIStore()

	const hostRef = useRef<ExtensionHostInterface | null>(null)
	const isReadyRef = useRef(false)

	// Cleanup function
	const cleanup = useCallback(async () => {
		if (hostRef.current) {
			await hostRef.current.dispose()
			hostRef.current = null
			isReadyRef.current = false
		}
	}, [])

	// Initialize extension host
	useEffect(() => {
		const init = async () => {
			// Clear tool inspector log for fresh session
			clearToolInspectorLog()

			toolInspectorLog("session:start", {
				timestamp: new Date().toISOString(),
				mode,
				nonInteractive,
			})

			try {
				const host = createExtensionHost({
					mode,
					reasoningEffort: reasoningEffort === "unspecified" ? undefined : reasoningEffort,
					apiProvider,
					apiKey,
					model,
					workspacePath,
					extensionPath,
					verbose: debug,
					quiet: !verbose && !debug,
					nonInteractive,
					disableOutput: true,
					ephemeral,
				})

				hostRef.current = host
				isReadyRef.current = true

				host.on("extensionWebviewMessage", onExtensionMessage)

				host.on("taskComplete", async () => {
					setComplete(true)
					setLoading(false)
					if (exitOnComplete) {
						await cleanup()
						exit()
						setTimeout(() => process.exit(0), 100)
					}
				})

				host.on("taskError", (err: string) => {
					setError(err)
					setLoading(false)
				})

				await host.activate()

				// Request initial state from extension (triggers postStateToWebview which includes taskHistory)
				host.sendToExtension({ type: "webviewDidLaunch" })
				host.sendToExtension({ type: "requestCommands" })
				host.sendToExtension({ type: "requestModes" })

				setLoading(false)

				if (initialPrompt) {
					setHasStartedTask(true)
					setLoading(true)
					addMessage({
						id: randomUUID(),
						role: "user",
						content: initialPrompt,
					})
					await host.runTask(initialPrompt)
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
				setLoading(false)
			}
		}

		init()

		return () => {
			cleanup()
		}
	}, []) // Run once on mount

	// Expose sendToExtension method
	const sendToExtension = hostRef.current
		? (msg: WebviewMessage) => {
				hostRef.current?.sendToExtension(msg)
			}
		: null

	// Expose runTask method
	const runTask = hostRef.current
		? (prompt: string) => {
				if (!hostRef.current) {
					return Promise.reject(new Error("Extension host not ready"))
				}
				return hostRef.current.runTask(prompt)
			}
		: null

	return {
		isReady: isReadyRef.current,
		sendToExtension,
		runTask,
		cleanup,
	}
}
