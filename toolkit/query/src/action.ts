// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

export interface ActionResult<TActionFn extends AnyFn = AnyFn, TError = unknown> {
  (...args: Parameters<TActionFn>): ReturnType<TActionFn>;
  data: Awaited<ReturnType<TActionFn>> | undefined;
  loading: boolean;
  success: boolean;
  error: TError | undefined;
  reset: () => void;
}

export interface ActionOptions<TResult, TError = unknown> {
  onSuccess?: (data: TResult) => void;
  onError?: (error: TError) => void;
  onSettled?: (data: TResult | undefined, error: TError | undefined) => void;
}

export interface Action<TActionFn extends AnyFn = AnyFn, TError = unknown> {
  _actionFn: TActionFn;
  _cache: ActionResult<TActionFn, TError> | null;
}

export function defineAction<TFn extends AnyFn, TError = unknown>(
  actionFunction: TFn,
): Action<TFn, TError> {
  return {
    _actionFn: actionFunction,
    _cache: null,
  };
}

export function useAction<TActionFn extends AnyFn, TError = unknown>(
  action: Action<TActionFn, TError>,
  options?: ActionOptions<Awaited<ReturnType<TActionFn>>, TError>,
): ActionResult<TActionFn, TError> {
  if (action._cache) return action._cache;

  type TResult = Awaited<ReturnType<TActionFn>>;
  let fetchCount = 0;

  interface ActionState {
    data: TResult | undefined;
    loading: boolean;
    success: boolean;
    error: TError | undefined;
  }

  state actionState: ActionState = {
    data: undefined,
    loading: false,
    success: false,
    error: undefined,
  };

  function execute(...args: Parameters<TActionFn>): ReturnType<TActionFn> {
    const gen = ++fetchCount;
    actionState.loading = true;
    actionState.error = undefined;
    actionState.success = false;

    return action._actionFn(...args).then(
      (data: TResult) => {
        if (gen === fetchCount) {
          actionState.data = data;
          actionState.loading = false;
          actionState.success = true;
          options?.onSuccess?.(data);
          options?.onSettled?.(data, undefined);
        }
      },
      (err: TError) => {
        if (gen === fetchCount) {
          actionState.loading = false;
          actionState.success = false;
          actionState.error = err;
          options?.onError?.(err);
          options?.onSettled?.(undefined, err);
        }
      },
    );
  }

  function reset() {
    actionState.loading = false;
    actionState.success = false;
    actionState.error = undefined;
    actionState.data = undefined;
  }

  derived result: ActionResult<TActionFn, TError> = Object.assign(
    execute,
    {
      data: actionState.data,
      loading: actionState.loading,
      success: actionState.success,
      error: actionState.error,
      reset
    },
  );

  action._cache = result;
  return result;
}
