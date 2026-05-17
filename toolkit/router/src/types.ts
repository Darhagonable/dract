// ── Path type utilities ──

export type JoinPath<Prefix extends string, Seg extends string> =
  Seg extends '/' ? (Prefix extends '' ? '/' : Prefix) :
  Prefix extends '' | '/' ? Seg :
  `${Prefix}${Seg}`;

export type FlattenRoutes<T, Prefix extends string = ''> = {
  [K in keyof T & string]: K extends '*' ? never
  : T[K] extends (...args: any[]) => any
  ? JoinPath<Prefix, K>
  : T[K] extends object
  ? FlattenRoutes<T[K], JoinPath<Prefix, K>>
  : never;
}[keyof T & string] extends infer R extends string ? R : never;

type StripRegex<S extends string> =
  S extends `${infer Name}(${string})` ? Name : S;

export type ReplaceParams<P extends string> =
  P extends `${infer Before}:${infer _Param}/${infer Rest}`
  ? `${Before}${string}/${ReplaceParams<Rest>}`
  : P extends `${infer Before}:${infer _Param}`
  ? `${Before}${string}`
  : P;

export type ExtractParams<P extends string> =
  P extends `${string}:${infer Param}/${infer Rest}`
  ? { [K in StripRegex<Param>]: string } & ExtractParams<`/${Rest}`>
  : P extends `${string}:${infer Param}`
  ? { [K in StripRegex<Param>]: string }
  : {};

// ── Dot paths ──

type _SuffixDots<S extends string> =
  S extends `${string}/${infer Rest}` ? `../${_SuffixDots<Rest>}` : '..';

export type DotPaths<All extends string, Current extends string> =
  string extends Current ? never :
  '.' | (All extends infer R extends string
    ? Current extends `${R extends '/' ? '' : R}/${infer Suffix}` ? _SuffixDots<Suffix> : never
    : never);

// ── Typed Navigation ──

export interface TypedNavigation<Routes extends string, Current extends string = string> extends Navigation {
  navigate(url: ReplaceParams<Routes> | DotPaths<Routes, Current>, options?: NavigationNavigateOptions): NavigationResult;
}
