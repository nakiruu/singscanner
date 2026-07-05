"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AddPositionInput } from "@/lib/portfolio/types";

const SYMBOL_RE = /^[A-Z]{1,6}$/;

export interface AddPositionDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: AddPositionInput) => Promise<void>;
  // Optional prefills — used when the dialog is opened from a decision badge
  // in the actionable dashboard so the user doesn't retype what's already
  // on the screen.
  initialSymbol?: string;
  initialQty?: number | null;
  initialCostBasis?: number | null;
  initialNotes?: string | null;
}

export function AddPositionDialog({
  open,
  onClose,
  onSubmit,
  initialSymbol,
  initialQty,
  initialCostBasis,
  initialNotes,
}: AddPositionDialogProps) {
  // useState initializers seed from props at MOUNT time. Callers should
  // conditionally render the dialog (e.g. `{open && <AddPositionDialog … />}`)
  // so opening for a new symbol remounts the component and the initializers
  // rerun with the fresh prefills.
  const [symbol, setSymbol] = useState(() => (initialSymbol ?? "").toUpperCase());
  const [qty, setQty] = useState(() =>
    initialQty != null && initialQty > 0 ? String(initialQty) : "",
  );
  const [costBasis, setCostBasis] = useState(() =>
    initialCostBasis != null && initialCostBasis > 0
      ? initialCostBasis.toFixed(2)
      : "",
  );
  const [notes, setNotes] = useState(() => initialNotes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Defensive: if a caller renders us unconditionally, still respect `open`.
  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const sym = symbol.trim().toUpperCase();
    const q = Number(qty);
    const cb = Number(costBasis);

    if (!SYMBOL_RE.test(sym)) {
      setError("Symbol must be 1-6 uppercase letters.");
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      setError("Shares must be greater than zero.");
      return;
    }
    if (!Number.isFinite(cb) || cb <= 0) {
      setError("Cost basis must be greater than zero.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        symbol: sym,
        qty: q,
        costBasis: cb,
        notes: notes.trim() ? notes.trim() : null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add position");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-position-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded border border-border bg-surface-default p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="add-position-title"
            className="font-sans text-lg font-semibold text-on-surface"
          >
            Add position
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-on-surface-variant hover:bg-surface-low hover:text-on-surface"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="ap-symbol"
              className="label-caps block text-xs"
            >
              Symbol
            </label>
            <input
              id="ap-symbol"
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="AAPL"
              maxLength={6}
              autoComplete="off"
              autoFocus
              className="w-full rounded border border-border bg-surface-low px-3 py-2 font-mono text-sm uppercase tracking-wider text-on-surface focus:border-primary focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="ap-qty" className="label-caps block text-xs">
                Shares
              </label>
              <input
                id="ap-qty"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="100"
                className="w-full rounded border border-border bg-surface-low px-3 py-2 font-mono tabular-nums text-sm text-on-surface focus:border-primary focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ap-cb" className="label-caps block text-xs">
                Cost basis
              </label>
              <input
                id="ap-cb"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={costBasis}
                onChange={(e) => setCostBasis(e.target.value)}
                placeholder="184.20"
                className="w-full rounded border border-border bg-surface-low px-3 py-2 font-mono tabular-nums text-sm text-on-surface focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ap-notes" className="label-caps block text-xs">
              Notes (optional)
            </label>
            <textarea
              id="ap-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded border border-border bg-surface-low px-3 py-2 font-mono text-xs text-on-surface focus:border-primary focus:outline-none"
            />
          </div>

          {error && (
            <p className="font-mono text-xs text-error" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "Saving…" : "Add position"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
