export type Getter<T = any> = () => T;
export type Setter<T = any> = (value: T) => void;
export type BindTuple<T = any> = [Getter<T>, Setter<T>];
