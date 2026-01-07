import { Box, Text } from "ink"
import type { TextProps } from "ink"

/**
 * Icon names supported by the Icon component.
 * Each icon has a Nerd Font glyph and an ASCII fallback.
 */
export type IconName = "folder" | "file" | "check" | "cross" | "arrow-right" | "bullet" | "spinner"

/**
 * Icon definitions with Nerd Font glyph and ASCII fallback.
 * Nerd Font glyphs are surrogate pairs (2 JS chars, 1 visual char).
 */
const ICONS: Record<IconName, { nerd: string; fallback: string }> = {
	folder: { nerd: "\udb80\ude4b", fallback: "▼" },
	file: { nerd: "\udb80\ude14", fallback: "●" },
	check: { nerd: "\uf00c", fallback: "✓" },
	cross: { nerd: "\uf00d", fallback: "✗" },
	"arrow-right": { nerd: "\uf061", fallback: "→" },
	bullet: { nerd: "\uf111", fallback: "•" },
	spinner: { nerd: "\uf110", fallback: "*" },
}

/**
 * Check if a string contains surrogate pairs (characters outside BMP).
 * Surrogate pairs have .length of 2 but render as 1 visual character.
 */
function containsSurrogatePair(str: string): boolean {
	// Surrogate pairs are in the range U+D800 to U+DFFF
	return /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(str)
}

/**
 * Detect if Nerd Font icons are likely supported.
 *
 * Users can override this with the ROOCODE_NERD_FONT environment variable:
 * - ROOCODE_NERD_FONT=0 to force ASCII fallbacks (if icons don't render correctly)
 * - ROOCODE_NERD_FONT=1 to force Nerd Font icons
 *
 * Defaults to true because:
 * 1. Nerd Fonts are common in developer terminal setups
 * 2. Modern terminals handle missing glyphs gracefully
 * 3. Users can easily disable if icons don't render correctly
 */
function detectNerdFontSupport(): boolean {
	// Allow explicit override via environment variable
	const envOverride = process.env.ROOCODE_NERD_FONT
	if (envOverride === "0" || envOverride === "false") return false
	if (envOverride === "1" || envOverride === "true") return true

	// Default to Nerd Font icons - they're common in developer setups
	// and users can set ROOCODE_NERD_FONT=0 if needed
	return true
}

// Cache the detection result
let nerdFontSupported: boolean | null = null

/**
 * Get whether Nerd Font icons are supported (cached).
 */
export function isNerdFontSupported(): boolean {
	if (nerdFontSupported === null) {
		nerdFontSupported = detectNerdFontSupport()
	}
	return nerdFontSupported
}

/**
 * Reset the Nerd Font detection cache (useful for testing).
 */
export function resetNerdFontCache(): void {
	nerdFontSupported = null
}

export interface IconProps extends Omit<TextProps, "children"> {
	/** The icon to display */
	name: IconName
	/** Override the automatic Nerd Font detection */
	useNerdFont?: boolean
	/** Custom width for the icon container (default: 2) */
	width?: number
}

/**
 * Icon component that renders Nerd Font icons with ASCII fallbacks.
 *
 * Renders icons in a fixed-width Box to handle surrogate pair width
 * calculation issues in Ink. Surrogate pairs (like Nerd Font glyphs)
 * have .length of 2 in JavaScript but render as 1 visual character.
 *
 * @example
 * ```tsx
 * <Icon name="folder" color="blue" />
 * <Icon name="file" />
 * <Icon name="check" color="green" useNerdFont={false} />
 * ```
 */
export function Icon({ name, useNerdFont, width = 2, color, ...textProps }: IconProps) {
	const iconDef = ICONS[name]
	if (!iconDef) {
		return null
	}

	const shouldUseNerdFont = useNerdFont ?? isNerdFontSupported()
	const icon = shouldUseNerdFont ? iconDef.nerd : iconDef.fallback

	// DEBUG: Log icon selection
	console.error(
		`DEBUG Icon: name=${name}, shouldUseNerdFont=${shouldUseNerdFont}, envOverride=${process.env.ROOCODE_NERD_FONT}, icon.length=${icon.length}`,
	)

	// Use fixed-width Box to isolate surrogate pair width calculation
	// from surrounding text. This prevents the off-by-one truncation bug.
	const needsWidthFix = containsSurrogatePair(icon)

	if (needsWidthFix) {
		return (
			<Box width={width}>
				<Text color={color} {...textProps}>
					{icon}
				</Text>
			</Box>
		)
	}

	// For BMP characters (no surrogate pairs), render directly
	return (
		<Text color={color} {...textProps}>
			{icon}
		</Text>
	)
}

/**
 * Get the raw icon character (useful for string concatenation).
 */
export function getIconChar(name: IconName, useNerdFont?: boolean): string {
	const iconDef = ICONS[name]
	if (!iconDef) return ""

	const shouldUseNerdFont = useNerdFont ?? isNerdFontSupported()
	return shouldUseNerdFont ? iconDef.nerd : iconDef.fallback
}
