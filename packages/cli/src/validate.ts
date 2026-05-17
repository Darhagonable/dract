/**
 * Package.json validation
 *
 * Checks that the consumer's package.json is properly configured
 * for distributing DarTsx packages.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export function validate(cwd: string, hasDartsxFiles: boolean): string[] {
	const warnings: string[] = [];

	const pkgPath = path.join(cwd, 'package.json');
	if (!fs.existsSync(pkgPath)) {
		warnings.push('No package.json found. Create one before publishing.');
		return warnings;
	}

	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

	if (!pkg.exports) {
		warnings.push(
			'No "exports" field found in package.json. Add one to define your package\'s public API.\n' +
			'  See: https://nodejs.org/api/packages.html#package-entry-points',
		);
	}

	if (hasDartsxFiles && !pkg.peerDependencies?.dartsx && !pkg.dependencies?.dartsx) {
		warnings.push(
			'Your package contains DarTsx files but doesn\'t declare "dartsx" as a dependency or peerDependency.\n' +
			'  Add it to peerDependencies: { "dartsx": ">=0.0.1" }',
		);
	}

	if (!pkg.type || pkg.type !== 'module') {
		warnings.push(
			'Consider setting "type": "module" in package.json for ESM output.',
		);
	}

	return warnings;
}
