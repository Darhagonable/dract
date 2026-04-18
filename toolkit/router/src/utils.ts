// ── Plain utilities (no DarTsx syntax) ──────────────────────────────

export interface CompiledRoute {
	pattern: URLPattern;
	handler: (params: Record<string, string | undefined>) => any;
}

export function matchRoute(routes: CompiledRoute[], pathname: string) {
	for (const route of routes) {
		const result = route.pattern.exec({ pathname });
		if (result) return { route, params: result.pathname.groups };
	}
	return null;
}

export function compileRoutes(node: Record<string, any>, prefix = ''): CompiledRoute[] {
	return Object.entries(node).flatMap(([key, value]) => {
		const path = key === '/' ? prefix || '/' : !prefix || prefix === '/' ? key : prefix + key;
		return typeof value === 'function'
			? [{ pattern: new URLPattern({ pathname: path }), handler: value }]
			: compileRoutes(value, path);
	});
}
