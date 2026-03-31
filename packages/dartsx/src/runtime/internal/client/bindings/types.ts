export type BindTuple<T = any> = [() => T, (value: T) => void];
