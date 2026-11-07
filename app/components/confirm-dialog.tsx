"use client";

import { useEffect, useRef, type ReactNode } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Style the confirm button as destructive (irreversible actions). */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Modal confirmation for irreversible actions (native `<dialog>`: focus trap + Escape). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/50"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 text-sm text-foreground/70">{children}</div>
      <div className="mt-6 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="h-11 cursor-pointer rounded-xl border border-border text-sm font-medium transition hover:bg-cream disabled:opacity-60"
        >
          Keep as is
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`h-11 cursor-pointer rounded-xl text-sm font-medium disabled:opacity-60 ${
            destructive
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {busy ? "Confirm in wallet..." : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
