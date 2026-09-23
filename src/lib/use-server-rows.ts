"use client";

import { useCallback, useState, type SetStateAction } from "react";

/** Accept fresh server rows while retaining local edits until the next server response.
 * Reset only the data, leaving search, filters, pagination and draft state untouched. */
export function useServerRows<T>(serverRows: T[]) {
  const [state, setState] = useState({ source: serverRows, rows: serverRows });
  if (state.source !== serverRows) {
    setState({ source: serverRows, rows: serverRows });
  }
  const setRows = useCallback((next: SetStateAction<T[]>) => {
    setState(current => ({ ...current, rows: typeof next === "function" ? next(current.rows) : next }));
  }, []);
  return [state.source === serverRows ? state.rows : serverRows, setRows] as const;
}
