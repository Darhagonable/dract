import { onCleanup } from 'dartsx';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
type Falsy = false | null | undefined;

/** Strip a trailing AbortSignal param from a function's parameter list */
type UserParams<P extends unknown[]> =
  P extends [...infer Init, AbortSignal]
    ? Init
    : P;

export interface QueryResult<TData = unknown, TError = unknown> {
  data: TData | undefined;
  loading: boolean;
  success: boolean;
  error: TError | undefined;
  refetch: () => void;
}

export interface QueryOptions<TData = unknown, TError = unknown> {
  onSuccess?: (data: TData) => void;
  onError?: (error: TError) => void;
  onSettled?: (data: TData | undefined, error: TError | undefined) => void;
  refetchInterval?: number;
}

export interface Query<TQueryFn extends AnyFn = AnyFn, TError = unknown> {
  (...args: UserParams<Parameters<TQueryFn>>): QueryInstance<Awaited<ReturnType<TQueryFn>>, TError>;
  invalidate: (...args: UserParams<Parameters<TQueryFn>>) => void;
  clear: () => void;
}

export interface QueryInstance<TData = unknown, TError = unknown> {
  key: string;
  args: unknown[];
  _cache: Map<string, CacheEntry<TData, TError>>;
  _queryFn: (...args: unknown[]) => Promise<TData>;
}

interface Observer<TData, TError> {
  options?: QueryOptions<TData, TError>;
  intervalId: ReturnType<typeof setInterval> | null;
}

function hasActiveInterval<TData, TError>(entry: CacheEntry<TData, TError>): boolean {
  for (const observer of entry.observers) {
    if (observer.intervalId !== null) return true;
  }
  return false;
}

interface CacheEntry<TData, TError> {
  result: QueryResult<TData, TError>;
  observers: Set<Observer<TData, TError>>;
  fetchCount: number;
  abortController: AbortController | null;
}

function createEntry<TData, TError>(
  queryFn: (...args: unknown[]) => Promise<TData>,
  args: unknown[],
): CacheEntry<TData, TError> {
  const entry: CacheEntry<TData, TError> = {
    result: null!,
    observers: new Set(),
    fetchCount: 0,
    abortController: null,
  };

  function refetch() {
    execute(entry, queryFn, args);
  }

  state result: QueryResult<TData, TError> = {
    data: undefined,
    loading: false,
    success: false,
    error: undefined,
    refetch,
  };

  entry.result = result;
  return entry;
}

function notifyObservers<TData, TError>(
  entry: CacheEntry<TData, TError>,
  type: 'success' | 'error',
) {
  for (const observer of entry.observers) {
    if (type === 'success') {
      observer.options?.onSuccess?.(entry.result.data!);
      observer.options?.onSettled?.(entry.result.data!, undefined);
    } else {
      observer.options?.onError?.(entry.result.error!);
      observer.options?.onSettled?.(undefined, entry.result.error!);
    }
  }
}

function execute<TData, TError>(
  entry: CacheEntry<TData, TError>,
  queryFn: (...args: unknown[]) => Promise<TData>,
  args: unknown[],
  cancelRefetch = true,
): void {
  if (entry.abortController) {
    if (!cancelRefetch) {
      return;
    }
    entry.abortController.abort();
  }

  const controller = new AbortController();
  entry.abortController = controller;
  entry.fetchCount++;
  const fetchId = entry.fetchCount;

  entry.result.loading = true;

  queryFn(...args, controller.signal).then(
    (data: TData) => {
      if (entry.fetchCount === fetchId) {
        entry.result.data = data;
        entry.result.error = undefined;
        entry.result.loading = false;
        entry.result.success = true;
        entry.abortController = null;
        notifyObservers(entry, 'success');
      }
    },
    (err: TError) => {
      if (entry.fetchCount === fetchId) {
        entry.result.error = err;
        entry.result.loading = false;
        entry.result.success = false;
        entry.abortController = null;
        notifyObservers(entry, 'error');
      }
    },
  );
}

export function defineQuery<TFn extends AnyFn, TError = unknown>(
  queryFunction: TFn,
): Query<TFn, TError> {
  type TResult = Awaited<ReturnType<TFn>>;
  const cache = new Map<string, CacheEntry<TResult, TError>>();

  function invoke(...args: UserParams<Parameters<TFn>>): QueryInstance<TResult, TError> {
    return { key: JSON.stringify(args), args, _cache: cache, _queryFn: queryFunction };
  }

  function invalidate(...args: UserParams<Parameters<TFn>>) {
    const key = JSON.stringify(args);
    const entry = cache.get(key);
    if (!entry) return;
    if (entry.observers.size > 0) {
      execute(entry, queryFunction, args);
    } else {
      cache.delete(key);
    }
  }

  function clear() {
    cache.clear();
  }

  const query: Query<TFn, TError> = Object.assign(
    invoke,
    {
      invalidate,
      clear
    }
  );

  return query;
}

export function useQuery<TData, TError = unknown>(
  instance: QueryInstance<TData, TError> | Falsy,
  options?: QueryOptions<TData, TError>,
): QueryResult<TData, TError> {
  if (!instance) {
    return {
      data: undefined,
      loading: false,
      success: false,
      error: undefined,
      refetch() { },
    };
  }

  const { _cache: cache, _queryFn: queryFn, key, args } = instance;

  let entry = cache.get(key);

  if (!entry) {
    entry = createEntry<TData, TError>(queryFn, args);
    cache.set(key, entry);
  }

  const currentEntry = entry;
  const observer: Observer<TData, TError> = { options, intervalId: null };

  currentEntry.observers.add(observer);
  onCleanup(() => {
    currentEntry.observers.delete(observer);
    if (currentEntry.observers.size === 0 && currentEntry.abortController) {
      currentEntry.abortController.abort();
      currentEntry.abortController = null;
    }
  });

  if (options?.refetchInterval && !hasActiveInterval(currentEntry)) {
    const id = setInterval(
      () => execute(currentEntry, queryFn, args, false),
      options.refetchInterval,
    );
    observer.intervalId = id;
    onCleanup(() => {
      clearInterval(id);
      observer.intervalId = null;
    });
  }

  execute(entry, queryFn, args, entry.fetchCount === 0);

  return entry.result;
}
