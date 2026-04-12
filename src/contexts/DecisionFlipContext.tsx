/**
 * DecisionFlipContext — visual-only overrides for ASTRA decisions.
 *
 * A Decision Card reads its "selected option" from the fiber by default.
 * When the reader clicks a different option, that click flips the card
 * to a hypothetical universe where that alternative won the decision.
 * This store holds those flips in memory; no write-back to felt happens.
 * A later iteration can route overrides through the projection editor
 * when that mechanism exists; for now this is a thought experiment
 * surface.
 *
 * Keys are `${hostSlug}#${decisionKey}` so the same decision-key can
 * appear on multiple fibers without collision (e.g. two fibers each
 * naming a decision `cov`).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface DecisionFlipValue {
  /** Returns the overridden option key for a given host+decision, if any. */
  getOverride: (hostSlug: string, decisionKey: string) => string | undefined;
  /** Sets the overridden option. Pass undefined to clear the override. */
  setOverride: (hostSlug: string, decisionKey: string, optionKey: string | undefined) => void;
}

const noop: DecisionFlipValue = {
  getOverride: () => undefined,
  setOverride: () => {},
};

const DecisionFlipContext = createContext<DecisionFlipValue>(noop);

function flipKey(hostSlug: string, decisionKey: string): string {
  return `${hostSlug}#${decisionKey}`;
}

export function DecisionFlipProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Map<string, string>>(() => new Map());

  const getOverride = useCallback(
    (hostSlug: string, decisionKey: string) => overrides.get(flipKey(hostSlug, decisionKey)),
    [overrides],
  );

  const setOverride = useCallback(
    (hostSlug: string, decisionKey: string, optionKey: string | undefined) => {
      setOverrides((prev) => {
        const next = new Map(prev);
        const k = flipKey(hostSlug, decisionKey);
        if (optionKey === undefined) next.delete(k);
        else next.set(k, optionKey);
        return next;
      });
    },
    [],
  );

  const value = useMemo(() => ({ getOverride, setOverride }), [getOverride, setOverride]);

  return (
    <DecisionFlipContext.Provider value={value}>{children}</DecisionFlipContext.Provider>
  );
}

/**
 * Read the effective selection and a setter for a single decision. The
 * effective selection is the user's override if one exists, otherwise
 * the fiber's authored selection. `isFlipped` tells callers whether the
 * shown selection is a hypothetical (useful for a "reset" affordance).
 */
export function useDecisionFlip(
  hostSlug: string | undefined,
  decisionKey: string,
  originalSelectedKey: string | undefined,
): {
  effectiveKey: string | undefined;
  isFlipped: boolean;
  setEffective: (optionKey: string) => void;
  reset: () => void;
} {
  const ctx = useContext(DecisionFlipContext);
  const host = hostSlug ?? '';
  const override = host ? ctx.getOverride(host, decisionKey) : undefined;
  const effectiveKey = override ?? originalSelectedKey;
  const isFlipped = override !== undefined && override !== originalSelectedKey;

  const setEffective = useCallback(
    (optionKey: string) => {
      if (!host) return;
      // Clicking the fiber's own authored selection clears the override
      // rather than pinning a no-op flip — this keeps the badge honest.
      if (optionKey === originalSelectedKey) ctx.setOverride(host, decisionKey, undefined);
      else ctx.setOverride(host, decisionKey, optionKey);
    },
    [ctx, host, decisionKey, originalSelectedKey],
  );

  const reset = useCallback(() => {
    if (!host) return;
    ctx.setOverride(host, decisionKey, undefined);
  }, [ctx, host, decisionKey]);

  return { effectiveKey, isFlipped, setEffective, reset };
}
