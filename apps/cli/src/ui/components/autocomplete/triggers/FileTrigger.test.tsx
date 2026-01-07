import { render } from "ink-testing-library"
import { describe, it, expect } from "vitest"

import { createFileTrigger, toFileResult } from "./FileTrigger.js"

describe("FileTrigger", () => {
	describe("createFileTrigger", () => {
		it("should detect @ trigger", () => {
			const trigger = createFileTrigger({
				onSearch: () => {},
				getResults: () => [],
			})

			const result = trigger.detectTrigger("@fil")
			expect(result).toEqual({ query: "fil", triggerIndex: 0 })
		})

		it("should detect @ trigger in middle of line", () => {
			const trigger = createFileTrigger({
				onSearch: () => {},
				getResults: () => [],
			})

			const result = trigger.detectTrigger("some text @fil")
			expect(result).toEqual({ query: "fil", triggerIndex: 10 })
		})

		it("should not detect @ followed by space", () => {
			const trigger = createFileTrigger({
				onSearch: () => {},
				getResults: () => [],
			})

			const result = trigger.detectTrigger("@ ")
			expect(result).toBeNull()
		})

		it("should close picker when query contains space", () => {
			const trigger = createFileTrigger({
				onSearch: () => {},
				getResults: () => [],
			})

			const result = trigger.detectTrigger("@file name")
			expect(result).toBeNull()
		})

		it("should generate correct replacement text for files", () => {
			const trigger = createFileTrigger({
				onSearch: () => {},
				getResults: () => [],
			})

			const item = toFileResult({ path: "src/index.ts", type: "file" })
			const lineText = "Check @ind"
			const replacement = trigger.getReplacementText(item, lineText, 6)

			expect(replacement).toBe("Check @/src/index.ts ")
		})

		it("should generate correct replacement text for folders", () => {
			const trigger = createFileTrigger({
				onSearch: () => {},
				getResults: () => [],
			})

			const item = toFileResult({ path: "src/components", type: "folder" })
			const lineText = "@comp"
			const replacement = trigger.getReplacementText(item, lineText, 0)

			expect(replacement).toBe("@/src/components ")
		})

		it("should preserve full path in replacement text", () => {
			const trigger = createFileTrigger({
				onSearch: () => {},
				getResults: () => [],
			})

			const item = toFileResult({
				path: "apps/cli/src/ui/components/autocomplete/PickerSelect.tsx",
				type: "file",
			})
			const lineText = "Fix @Pick"
			const replacement = trigger.getReplacementText(item, lineText, 4)

			// Verify the full path is included without truncation
			expect(replacement).toBe("Fix @/apps/cli/src/ui/components/autocomplete/PickerSelect.tsx ")
			// Verify last character 'x' is present
			expect(replacement).toContain("PickerSelect.tsx ")
			expect(replacement.trim().endsWith(".tsx")).toBe(true)
		})

		it("should render file items correctly", () => {
			const trigger = createFileTrigger({
				onSearch: () => {},
				getResults: () => [],
			})

			const item = toFileResult({ path: "src/index.ts", type: "file" })
			const { lastFrame } = render(trigger.renderItem(item, false) as React.ReactElement)

			// Verify the path is present in the rendered output
			expect(lastFrame()).toContain("src/index.ts")
		})

		it("should render folder items correctly", () => {
			const trigger = createFileTrigger({
				onSearch: () => {},
				getResults: () => [],
			})

			const item = toFileResult({ path: "src/components", type: "folder" })
			const { lastFrame } = render(trigger.renderItem(item, false) as React.ReactElement)

			// Verify the path is present in the rendered output
			expect(lastFrame()).toContain("src/components")
		})

		it("should render full path without truncation in UI", () => {
			const trigger = createFileTrigger({
				onSearch: () => {},
				getResults: () => [],
			})

			const item = toFileResult({
				path: "apps/cli/src/ui/components/autocomplete/PickerSelect.tsx",
				type: "file",
			})
			const { lastFrame } = render(trigger.renderItem(item, false) as React.ReactElement)

			const output = lastFrame()
			// Verify the full path is rendered without truncation
			expect(output).toContain("PickerSelect.tsx")
			// Verify the last character 'x' is present
			expect(output).toContain("x")
			// Verify no truncation occurred
			expect(output).not.toMatch(/PickerSelect\.ts[^x]/)
		})
	})

	describe("toFileResult", () => {
		it("should convert file search result to FileResult", () => {
			const result = toFileResult({ path: "src/index.ts", type: "file" })

			expect(result).toEqual({
				key: "src/index.ts",
				path: "src/index.ts",
				type: "file",
			})
		})

		it("should preserve label", () => {
			const result = toFileResult({
				path: "src/index.ts",
				type: "file",
				label: "Main entry",
			})

			expect(result).toEqual({
				key: "src/index.ts",
				path: "src/index.ts",
				type: "file",
				label: "Main entry",
			})
		})
	})
})
