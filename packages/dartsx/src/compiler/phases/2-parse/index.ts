/**
 * Phase 2 — Parse
 *
 * Provides the OXC parse wrapper.
 */
import { parseSync as oxcParseSync } from 'oxc-parser';

/**
 * Parse source code with OXC.
 */
export function parse(filename: string, code: string, lang: 'tsx' | 'jsx' = 'tsx') {
	return oxcParseSync(filename, code, { sourceType: 'module', lang });
}
