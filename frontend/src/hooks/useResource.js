import { useCallback, useEffect, useRef, useState } from 'react';

export function useResource(load, revision) {
  const [state, setState] = useState({ data: null, error: null, busy: true });
  const current = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    let refreshPending = false;

    current.current = async () => {
      if (loading) {
        refreshPending = true;
        return;
      }

      loading = true;
      setState((previous) => ({ ...previous, busy: true, error: null }));
      do {
        refreshPending = false;
        try {
          const data = await load(controller.signal);
          if (!controller.signal.aborted) setState({ data, busy: refreshPending, error: null });
        } catch (error) {
          if (!controller.signal.aborted) {
            setState((previous) => ({ ...previous, busy: refreshPending, error }));
          }
        }
      } while (refreshPending && !controller.signal.aborted);
      loading = false;
    };
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(() => void current.current?.(), []);
  useEffect(() => refresh(), [load, revision, refresh]);
  return { ...state, refresh };
}
