/** A DarTsx component function */
export type Component<P extends Record<string, unknown> = Record<string, unknown>, R extends Node = Node> = (props: P) => R;
