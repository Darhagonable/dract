import type { Component } from 'dartsx';
import { matchRoute, compileRoutes } from './utils';
import type { FlattenRoutes, ReplaceParams, ExtractParams, TypedNavigation } from './types';

// ── Route types ────────────────────────────────────────────────────

export type RouteHandler<K extends string> = (params: ExtractParams<K>) => Component;

export type Routes<T extends object> = {
	[K in keyof T & string]: T[K] extends object ? Routes<T[K]> : RouteHandler<K>;
};

export interface RouterState<Routes extends string, Current extends string = string> {
	route: string extends Current ? Routes : Current;
	pathname: string;
	params: string extends Current ? Record<string, string> : ExtractParams<Current>;
	search: string;
	hash: string;
	navigation: TypedNavigation<Routes, Current>;
}

export interface CreateRouterResult<T extends Routes<T>> {
	Router: Component;
	Link: Component<{ to: ReplaceParams<FlattenRoutes<T>>; children?: any; class?: string }>;
	RouterContext: {
		<R extends FlattenRoutes<T>>(expectedRoute: R): RouterState<FlattenRoutes<T>, R>;
		(): RouterState<FlattenRoutes<T>>;
	};
}

// ── createRouter ───────────────────────────────────────────────────

export function createRouter<const T extends Routes<T>>(routes: T): CreateRouterResult<T> {
	type AllRoutes = FlattenRoutes<T>;
	const compiled = compileRoutes(routes);

	state url = new URL(window.location.href);

	derived match = matchRoute(compiled, url.pathname);

	navigation.addEventListener('navigate', (e) => {
		if (!e.canIntercept || e.hashChange || e.downloadRequest) return;
		e.intercept({
			handler: () => url = new URL(e.destination.url)
		});
	});

	derived routerState: RouterState<AllRoutes> = {
		route: match?.route.pattern.pathname,
		pathname: url.pathname,
		params: match?.params ?? {},
		search: url.search,
		hash: url.hash,
		navigation,
	};

	// ── Router component ───────────────────────────────────────────

	component Router() {
		render match?.route.handler(match.params) ?? null;
	}

	// ── Link component ─────────────────────────────────────────────

	component Link(to: ReplaceParams<AllRoutes>, children?: any, "class" as className?: string) {
		render (
			<a href={to} class={className}>
				{children}
			</a>
		)
	}

	// ── RouterContext accessor ──────────────────────────────────────

	function RouterContext<R extends AllRoutes>(expectedRoute?: R): RouterState<AllRoutes, R> {
		if (expectedRoute !== undefined && routerState.route !== expectedRoute) {
			throw new Error(
				`RouterContext("${expectedRoute}") called but current route is "${routerState.route}".`
			);
		}
		return routerState;
	}

	return { Router, Link, RouterContext };
}
