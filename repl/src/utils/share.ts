import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

export function encodeFiles(files: Record<string, string>): string {
	const data = JSON.stringify(files);
	return compressToEncodedURIComponent(data);
}

export function decodeFiles(hash: string): Record<string, string> | null {
	try {
		const raw = decompressFromEncodedURIComponent(hash);
		if (!raw) return null;
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export function getShareUrl(files: Record<string, string>): string {
	const hash = encodeFiles(files);
	const url = new URL(window.location.href);
	url.hash = hash;
	return url.toString();
}

export function loadFromHash(): Record<string, string> | null {
	const hash = window.location.hash.slice(1);
	if (!hash) return null;
	return decodeFiles(hash);
}
