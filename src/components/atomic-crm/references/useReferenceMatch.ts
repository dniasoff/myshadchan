import { useCallback, useEffect, useRef, useState } from "react";
import type { Identifier } from "ra-core";
import { useDataProvider } from "ra-core";
import type { MatchReferenceInput, ReferenceMatchCandidate } from "../types";
import type { CrmDataProvider } from "../providers/types";

/**
 * Match-on-entry (FR20/FR42).
 *
 * Watches what the user is typing into the reference form and asks the shared
 * identity service whether this person is already in the book. Three rules this
 * hook exists to keep:
 *
 *  1. It NEVER normalizes. The raw strings go to the server, which owns the one
 *     bilingual normalizer (AD-5/AD-12).
 *  2. It NEVER links anything. It returns candidates; the user confirms or
 *     dismisses. There is no confidence threshold above which this acts alone.
 *  3. It is FREE. No entitlement check belongs anywhere near this path (FR42).
 *
 * Once the user has dismissed a candidate, it stays dismissed for the rest of
 * the form session — re-asking about a person they already said no to is how a
 * duplicate check turns into nagging.
 */

const DEBOUNCE_MS = 400;

/** Enough signal to be worth asking: a name plus something that corroborates it. */
const isWorthMatching = (input: MatchReferenceInput): boolean => {
  const hasName = Boolean(input.name_en?.trim() || input.name_he?.trim());
  const hasCorroboration = Boolean(input.phone?.trim() || input.school?.trim());
  return hasName && hasCorroboration;
};

export type ReferenceMatchState = {
  candidates: ReferenceMatchCandidate[];
  isMatching: boolean;
  error: Error | null;
  /** Removes one candidate from view — "no, different person". */
  dismiss: (referenceId: Identifier) => void;
  /** Clears everything, e.g. after the user confirms a link. */
  reset: () => void;
};

export const useReferenceMatch = (
  input: MatchReferenceInput,
): ReferenceMatchState => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [candidates, setCandidates] = useState<ReferenceMatchCandidate[]>([]);
  const [isMatching, setIsMatching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());

  const { name_en, name_he, phone, school, exclude_id } = input;

  useEffect(() => {
    const query: MatchReferenceInput = {
      name_en,
      name_he,
      phone,
      school,
      exclude_id,
    };

    if (!isWorthMatching(query)) {
      setCandidates([]);
      setIsMatching(false);
      return;
    }

    let cancelled = false;
    setIsMatching(true);

    const timer = setTimeout(async () => {
      try {
        const found = await dataProvider.matchReferenceOnEntry(query);
        if (cancelled) return;
        setCandidates(
          found.filter(
            (candidate) =>
              !dismissedRef.current.has(String(candidate.reference_id)),
          ),
        );
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        // A failed duplicate check must never block creating the reference —
        // the worst case is a duplicate the user can merge later.
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        setCandidates([]);
      } finally {
        if (!cancelled) setIsMatching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dataProvider, name_en, name_he, phone, school, exclude_id]);

  const dismiss = useCallback((referenceId: Identifier) => {
    dismissedRef.current = new Set(dismissedRef.current).add(
      String(referenceId),
    );
    setCandidates((current) =>
      current.filter((candidate) => candidate.reference_id !== referenceId),
    );
  }, []);

  const reset = useCallback(() => {
    setCandidates([]);
    setError(null);
  }, []);

  return { candidates, isMatching, error, dismiss, reset };
};
