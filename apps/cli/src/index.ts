/**
 * @roo-code/cli - Command Line Interface for Roo Code
 */

import { Command } from "commander"
import fs from "fs"
import { createRequire } from "module"
import path from "path"
import { fileURLToPath } from "url"
import { createElement } from "react"

import {
	type ProviderName,
	type ReasoningEffortExtended,
	isProviderName,
	reasoningEffortsExtended,
} from "@roo-code/types"
import { setLogger } from "@roo-code/vscode-shim"

import { ExtensionHost } from "./extension-host.js"
import { getEnvVarName, getApiKeyFromEnv, getDefaultExtensionPath } from "./utils.js"

const DEFAULTS = {
	mode: "code",
	reasoningEffort: "medium" as const,
	model: "anthropic/claude-sonnet-4.5",
}

const REASONING_EFFORTS = [...reasoningEffortsExtended, "unspecified", "disabled"]

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Read version from package.json
const require = createRequire(import.meta.url)
const packageJson = require("../package.json")

const program = new Command()

program
	.name("roo")
	.description("Roo Code CLI - Run the Roo Code agent from the command line")
	.version(packageJson.version)

program
	.argument("[prompt]", "The prompt/task to execute (optional in TUI mode)")
	.option("-w, --workspace <path>", "Workspace path to operate in", process.cwd())
	.option("-e, --extension <path>", "Path to the extension bundle directory")
	.option("-v, --verbose", "Enable verbose output (show VSCode and extension logs)", false)
	.option("-d, --debug", "Enable debug output (includes detailed debug information)", false)
	.option("-x, --exit-on-complete", "Exit the process when the task completes (useful for testing)", false)
	.option("-y, --yes", "Auto-approve all prompts (non-interactive mode)", false)
	.option("-k, --api-key <key>", "API key for the LLM provider (defaults to ANTHROPIC_API_KEY env var)")
	.option("-p, --provider <provider>", "API provider (anthropic, openai, openrouter, etc.)", "openrouter")
	.option("-m, --model <model>", "Model to use", DEFAULTS.model)
	.option("-M, --mode <mode>", "Mode to start in (code, architect, ask, debug, etc.)", DEFAULTS.mode)
	.option(
		"-r, --reasoning-effort <effort>",
		"Reasoning effort level (unspecified, disabled, none, minimal, low, medium, high, xhigh)",
		DEFAULTS.reasoningEffort,
	)
	.option("--no-tui", "Disable TUI, use plain text output")
	.action(
		async (
			prompt: string | undefined,
			options: {
				workspace: string
				extension?: string
				verbose: boolean
				debug: boolean
				exitOnComplete: boolean
				yes: boolean
				apiKey?: string
				provider: ProviderName
				model?: string
				mode?: string
				reasoningEffort?: ReasoningEffortExtended | "unspecified" | "disabled"
				tui: boolean
			},
		) => {
			// Default is quiet mode - suppress VSCode shim logs unless verbose
			// or debug is specified.
			if (!options.verbose && !options.debug) {
				setLogger({
					info: () => {},
					warn: () => {},
					error: () => {},
					debug: () => {},
				})
			}

			const extensionPath = options.extension || getDefaultExtensionPath(__dirname)
			const apiKey = options.apiKey || getApiKeyFromEnv(options.provider)
			const workspacePath = path.resolve(options.workspace)

			if (!apiKey) {
				console.error(
					`[CLI] Error: No API key provided. Use --api-key or set the appropriate environment variable.`,
				)
				console.error(`[CLI] For ${options.provider}, set ${getEnvVarName(options.provider)}`)
				process.exit(1)
			}

			if (!fs.existsSync(workspacePath)) {
				console.error(`[CLI] Error: Workspace path does not exist: ${workspacePath}`)
				process.exit(1)
			}

			if (!isProviderName(options.provider)) {
				console.error(`[CLI] Error: Invalid provider: ${options.provider}`)
				process.exit(1)
			}

			if (options.reasoningEffort && !REASONING_EFFORTS.includes(options.reasoningEffort)) {
				console.error(
					`[CLI] Error: Invalid reasoning effort: ${options.reasoningEffort}, must be one of: ${REASONING_EFFORTS.join(", ")}`,
				)
				process.exit(1)
			}

			// TUI is enabled by default, disabled with --no-tui
			// TUI requires raw mode support (proper TTY for stdin and stdout)
			const canUseTui = process.stdin.isTTY && process.stdout.isTTY
			const useTui = options.tui && canUseTui

			if (options.tui && !canUseTui) {
				console.log("[CLI] TUI disabled (no TTY support), falling back to plain text mode")
			}

			// In plain text mode, prompt is required
			if (!useTui && !prompt) {
				console.error("[CLI] Error: prompt is required in plain text mode")
				console.error("[CLI] Usage: roo <prompt> [options]")
				console.error("[CLI] Use TUI mode (without --no-tui) for interactive input")
				process.exit(1)
			}

			if (useTui) {
				// TUI Mode - render Ink application
				try {
					// Clear screen before Ink starts
					process.stdout.write("\x1B[2J\x1B[0;0H")

					const { render } = await import("ink")
					const { App } = await import("./ui/App.js")

					// Create extension host factory for dependency injection
					const createExtensionHost = (opts: {
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
					}) => {
						return new ExtensionHost({
							mode: opts.mode,
							reasoningEffort:
								opts.reasoningEffort === "unspecified"
									? undefined
									: (opts.reasoningEffort as ReasoningEffortExtended | "disabled" | undefined),
							apiProvider: opts.apiProvider as ProviderName,
							apiKey: opts.apiKey,
							model: opts.model,
							workspacePath: opts.workspacePath,
							extensionPath: opts.extensionPath,
							verbose: opts.verbose,
							quiet: opts.quiet,
							nonInteractive: opts.nonInteractive,
							disableOutput: opts.disableOutput,
						})
					}

					render(
						createElement(App, {
							initialPrompt: prompt || "", // Empty string if no prompt - user will type in TUI
							workspacePath: workspacePath,
							extensionPath: path.resolve(extensionPath),
							apiProvider: options.provider,
							apiKey: apiKey,
							model: options.model || DEFAULTS.model,
							mode: options.mode || DEFAULTS.mode,
							nonInteractive: options.yes,
							verbose: options.verbose,
							debug: options.debug,
							exitOnComplete: options.exitOnComplete,
							reasoningEffort: options.reasoningEffort,
							createExtensionHost: createExtensionHost,
						}),
						{
							exitOnCtrlC: false, // Handle Ctrl+C in App component for double-press exit
						},
					)
				} catch (error) {
					console.error("[CLI] Failed to start TUI:", error instanceof Error ? error.message : String(error))
					if (options.debug && error instanceof Error) {
						console.error(error.stack)
					}
					process.exit(1)
				}
			} else {
				// Plain text mode (existing behavior)
				console.log(`[CLI] Mode: ${options.mode || "default"}`)
				console.log(`[CLI] Reasoning Effort: ${options.reasoningEffort || "default"}`)
				console.log(`[CLI] Provider: ${options.provider}`)
				console.log(`[CLI] Model: ${options.model || "default"}`)
				console.log(`[CLI] Workspace: ${workspacePath}`)

				const host = new ExtensionHost({
					mode: options.mode || DEFAULTS.mode,
					reasoningEffort: options.reasoningEffort === "unspecified" ? undefined : options.reasoningEffort,
					apiProvider: options.provider,
					apiKey,
					model: options.model || DEFAULTS.model,
					workspacePath,
					extensionPath: path.resolve(extensionPath),
					verbose: options.debug,
					quiet: !options.verbose && !options.debug,
					nonInteractive: options.yes,
				})

				// Handle SIGINT (Ctrl+C)
				process.on("SIGINT", async () => {
					console.log("\n[CLI] Received SIGINT, shutting down...")
					await host.dispose()
					process.exit(130)
				})

				// Handle SIGTERM
				process.on("SIGTERM", async () => {
					console.log("\n[CLI] Received SIGTERM, shutting down...")
					await host.dispose()
					process.exit(143)
				})

				try {
					await host.activate()
					await host.runTask(prompt!) // prompt is guaranteed non-null in plain text mode
					await host.dispose()

					if (options.exitOnComplete) {
						process.exit(0)
					}
				} catch (error) {
					console.error("[CLI] Error:", error instanceof Error ? error.message : String(error))

					if (options.debug && error instanceof Error) {
						console.error(error.stack)
					}

					await host.dispose()
					process.exit(1)
				}
			}
		},
	)

program.parse()
