// Tiny className joiner: `cx('a', cond && 'b', 'c')` → 'a b c'.
// Falsy values (octane-style `['cls', flag && 'active']` arrays) are skipped.
export function cx(...parts: Array<string | false | null | undefined>): string {
	return parts.filter((part) => !!part).join(' ');
}