import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Search, X } from "lucide-react";
import { useListContext } from "ra-core";

import { Input } from "@/components/ui/input";

import {
  isNumberLikeSearchQuery,
  isPhoneInputQuery,
  isPhoneSearchQuery,
} from "./shadchanUtils";

export const SHADCHAN_SEARCH_PLACEHOLDER =
  "Search by name, location, or phone number";

type ShadchanSearchInputProps = {
  onQueryChange: (query: string) => void;
  source?: string;
  alwaysOn?: boolean;
};

const removeQueryFilter = (filterValues: Record<string, unknown>) => {
  const { q: _query, ...filters } = filterValues;
  return filters;
};

export const ShadchanSearchInput = ({
  onQueryChange,
}: ShadchanSearchInputProps) => {
  const { filterValues, setFilters } = useListContext();
  const initialQuery = typeof filterValues.q === "string" ? filterValues.q : "";
  const initialQueryRef = useRef(initialQuery);
  const [value, setValue] = useState(() =>
    isPhoneInputQuery(initialQuery) ? "" : initialQuery,
  );
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const persistedQuery = initialQueryRef.current;
    if (isPhoneInputQuery(persistedQuery)) {
      setFilters(removeQueryFilter(filterValues));
      onQueryChange("");
      return;
    }
    onQueryChange(persistedQuery);
  }, [filterValues, onQueryChange, setFilters]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.currentTarget.value;
    const phoneInput = isPhoneInputQuery(nextQuery);

    setValue(nextQuery);
    onQueryChange(nextQuery);

    if (phoneInput) {
      if ("q" in filterValues) {
        setFilters(removeQueryFilter(filterValues));
      }
      return;
    }

    setFilters({ ...filterValues, q: nextQuery }, undefined, true);
  };

  const handleClear = () => {
    setValue("");
    onQueryChange("");
    setFilters(removeQueryFilter(filterValues));
  };

  const phoneMode = isPhoneSearchQuery(value);
  const shortNumberQuery =
    !phoneMode &&
    isNumberLikeSearchQuery(value) &&
    value.replace(/\D/g, "").length < 4;

  return (
    <div className="flex min-w-0 flex-grow flex-col gap-1.5">
      <div className="relative flex min-w-0 flex-grow">
        <label htmlFor="shadchan-search" className="sr-only">
          Search shadchanim
        </label>
        <Input
          id="shadchan-search"
          value={value}
          onChange={handleChange}
          placeholder={SHADCHAN_SEARCH_PLACEHOLDER}
          aria-label="Search shadchanim"
          aria-describedby="shadchan-search-helper shadchan-search-status"
          className="pr-16"
        />
        <Search
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        {value ? (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-8 top-1/2 size-6 -translate-y-1/2 rounded-full p-0 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Clear search"
          >
            <X className="mx-auto size-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p id="shadchan-search-helper" className="text-xs text-muted-foreground">
        Search by name, location, or a phone or WhatsApp number.
      </p>
      <div id="shadchan-search-status" aria-live="polite">
        {phoneMode ? (
          <>
            <span className="text-xs font-medium text-muted-foreground">
              Phone search active
            </span>
            <span className="sr-only">
              Matching phone and WhatsApp number endings.
            </span>
          </>
        ) : shortNumberQuery ? (
          <span className="text-xs text-muted-foreground">
            Enter at least 4 digits to search by phone number.
          </span>
        ) : null}
      </div>
    </div>
  );
};
