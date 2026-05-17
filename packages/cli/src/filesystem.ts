import * as fs from 'node:fs';
import * as path from 'node:path';

export function walk(dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walk(full));
		} else {
			results.push(full);
		}
	}
	return results;
}

export function posixify(str: string): string {
	return str.replace(/\\/g, '/');
}

export function mkdirp(dir: string): void {
	fs.mkdirSync(dir, { recursive: true });
}

export function rimraf(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
}

export function copy(from: string, to: string): void {
	mkdirp(path.dirname(to));
	fs.copyFileSync(from, to);
}

export function write(file: string, contents: string): void {
	mkdirp(path.dirname(file));
	fs.writeFileSync(file, contents);
}
