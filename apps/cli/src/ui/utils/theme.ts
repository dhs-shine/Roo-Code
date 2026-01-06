/**
 * Theme configuration for Roo Code CLI TUI
 * Using Catppuccin Mocha color scheme
 */

// Catppuccin Mocha palette
const catppuccin = {
	// Accent colors
	rosewater: "#f5e0dc",
	flamingo: "#f2cdcd",
	pink: "#f5c2e7",
	mauve: "#cba6f7",
	red: "#f38ba8",
	maroon: "#eba0ac",
	peach: "#fab387",
	yellow: "#f9e2af",
	green: "#a6e3a1",
	teal: "#94e2d5",
	sky: "#89dceb",
	sapphire: "#74c7ec",
	blue: "#89b4fa",
	lavender: "#b4befe",

	// Text colors
	text: "#cdd6f4",
	subtext1: "#bac2de",
	subtext0: "#a6adc8",

	// Overlay colors
	overlay2: "#9399b2",
	overlay1: "#7f849c",
	overlay0: "#6c7086",

	// Surface colors
	surface2: "#585b70",
	surface1: "#45475a",
	surface0: "#313244",

	// Base colors
	base: "#1e1e2e",
	mantle: "#181825",
	crust: "#11111b",
}

// Title and branding colors
export const titleColor = catppuccin.peach // Peach for title
export const welcomeText = catppuccin.text // Standard text
export const asciiColor = catppuccin.blue // Blue for ASCII art

// Tips section colors
export const tipsHeader = catppuccin.peach // Peach for tips headers
export const tipsText = catppuccin.subtext0 // Subtle text for tips

// Header text colors (for messages)
export const userHeader = catppuccin.lavender // Lavender for user header
export const rooHeader = catppuccin.yellow // Yellow for roo
export const toolHeader = catppuccin.teal // Teal for tool headers
export const thinkingHeader = catppuccin.overlay1 // Subtle gray for thinking header

// Message text colors
export const userText = catppuccin.text // Standard text for user
export const rooText = catppuccin.text // Standard text for roo
export const toolText = catppuccin.subtext0 // Subtle text for tool output
export const thinkingText = catppuccin.overlay2 // Subtle gray for thinking text

// UI element colors
export const borderColor = catppuccin.surface1 // Surface color for borders
export const borderColorActive = catppuccin.blue // Active/focused border color
export const dimText = catppuccin.overlay1 // Dim text
export const promptColor = catppuccin.overlay2 // Prompt indicator
export const promptColorActive = catppuccin.blue // Active prompt color
export const placeholderColor = catppuccin.overlay0 // Placeholder text

// Status colors
export const successColor = catppuccin.green // Green for success
export const errorColor = catppuccin.red // Red for errors
export const warningColor = catppuccin.yellow // Yellow for warnings

// Focus indicator colors
export const focusColor = catppuccin.blue // Focus indicator (blue accent)
export const scrollActiveColor = catppuccin.mauve // Scroll area active indicator (purple)

// Base text color
export const text = catppuccin.text // Standard text color
