export type DarTsxNode = Node | string | number | boolean | null | undefined;

/** A DarTsx component function */
export type Component<P extends Record<string, unknown> = Record<string, unknown>, R extends DarTsxNode = DarTsxNode> = (props: P) => R;
