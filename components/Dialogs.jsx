"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

// Bevestigingen en meldingen in de huisstijl, in plaats van de native
// confirm/alert/prompt van de browser. De host hangt in de root-layout; de
// functies hieronder werken daardoor overal, ook buiten React-componenten.
//
//   if (!(await confirmDialog({ message: "Verwijderen?", danger: true }))) return;
//   const url = await promptDialog({ title: "Link", defaultValue: "https://" });
//   notify("Opgeslagen", { type: "success" });

let host = null;
const pending = [];

function send(event) {
  if (host) host(event);
  else pending.push(event);
}

// Resolvet naar true (Bevestigen) of false (Annuleren, Escape, klik ernaast).
export function confirmDialog(options) {
  const opts = typeof options === "string" ? { message: options } : options;
  return new Promise((resolve) => send({ kind: "dialog", dialog: { ...opts, input: false, resolve } }));
}

// Resolvet naar de ingevulde tekst, of null bij annuleren.
export function promptDialog(options) {
  return new Promise((resolve) => send({ kind: "dialog", dialog: { ...options, input: true, resolve } }));
}

// type: "info" | "success" | "error"
export function notify(message, { type = "info" } = {}) {
  send({ kind: "toast", toast: { message, type } });
}

export function notifyError(message) {
  notify(message, { type: "error" });
}

const TOAST_STYLES = {
  info: { icon: Info, className: "border-gray-200 text-brand-black", iconClass: "text-gray-400" },
  success: { icon: CheckCircle2, className: "border-green-100 text-green-800", iconClass: "text-green-600" },
  error: { icon: AlertTriangle, className: "border-red-100 text-red-700", iconClass: "text-red-500" },
};

let nextId = 1;

export default function DialogHost() {
  const [dialogs, setDialogs] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    host = (event) => {
      const id = nextId++;
      if (event.kind === "dialog") setDialogs((list) => [...list, { ...event.dialog, id }]);
      else setToasts((list) => [...list, { ...event.toast, id }]);
    };
    pending.splice(0).forEach(host);
    setMounted(true);
    return () => { host = null; };
  }, []);

  // Een open vraag hoort bij de pagina waar hij gesteld werd: bij navigeren
  // (bv. Terug) annuleren, zodat bevestigen nooit een actie van een vorige pagina uitvoert.
  useEffect(() => {
    setDialogs((list) => {
      list.forEach((d) => d.resolve(d.input ? null : false));
      return [];
    });
  }, [pathname]);

  function close(dialog, value) {
    dialog.resolve(value);
    setDialogs((list) => list.filter((d) => d.id !== dialog.id));
  }

  const dismiss = (id) => setToasts((list) => list.filter((t) => t.id !== id));

  if (!mounted) return null;
  const current = dialogs[0];

  return createPortal(
    <>
      {current && <Dialog key={current.id} dialog={current} onClose={(value) => close(current, value)} />}
      <div aria-live="polite" className="fixed bottom-4 right-4 left-4 sm:left-auto z-[60] flex flex-col items-end gap-2 pointer-events-none">
        {toasts.map((toast) => <Toast key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />)}
      </div>
    </>,
    document.body
  );
}

function Dialog({ dialog, onClose }) {
  const {
    title,
    message,
    input,
    defaultValue = "",
    readOnly = false,
    danger = false,
    confirmLabel = input ? "Opslaan" : "Bevestigen",
    cancelLabel = "Annuleren",
  } = dialog;
  const [value, setValue] = useState(defaultValue);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const inputRef = useRef(null);
  const formRef = useRef(null);
  const openedAt = useRef(Date.now());
  const cancelValue = input ? null : false;

  useEffect(() => {
    if (input) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      // Bij een destructieve actie staat de focus op Annuleren, zodat Enter niets kapotmaakt.
      (danger ? cancelRef : confirmRef).current?.focus();
    }
    // Capture op window: de dialoog krijgt Escape en Tab vóór de pagina eronder.
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose(cancelValue);
      } else if (e.key === "Tab") {
        // Focus binnen de dialoog houden.
        const focusable = [...formRef.current.querySelectorAll("button, input")];
        const index = focusable.indexOf(document.activeElement);
        const next = e.shiftKey ? index - 1 : index + 1;
        e.preventDefault();
        focusable[(next + focusable.length) % focusable.length]?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function submit(e) {
    e.preventDefault();
    onClose(input ? value : true);
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4"
      onMouseDown={(e) => {
        // Niet direct na openen: de tweede klik van een dubbelklik op de knop zou anders meteen annuleren.
        if (e.target === e.currentTarget && Date.now() - openedAt.current > 400) onClose(cancelValue);
      }}
    >
      <form
        ref={formRef}
        onSubmit={submit}
        role="alertdialog"
        aria-modal="true"
        aria-label={title || message}
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl"
      >
        <div className="px-6 pt-5 pb-4 space-y-2">
          {title && <h2 className="font-semibold text-lg">{title}</h2>}
          {message && <p className="text-sm text-gray-600 whitespace-pre-line">{message}</p>}
          {input && (
            <input
              ref={inputRef}
              value={value}
              readOnly={readOnly}
              onChange={(e) => setValue(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-brand-amber"
            />
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 pb-5">
          {cancelLabel && (
            <button
              ref={cancelRef}
              type="button"
              onClick={() => onClose(cancelValue)}
              className="px-4 py-2 border border-gray-200 rounded-pill text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="submit"
            className={`px-4 py-2 rounded-pill text-sm font-semibold transition-colors ${
              danger ? "bg-red-600 hover:bg-red-700 text-white" : "bg-brand-amber hover:bg-brand-amber-hover text-brand-black"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function Toast({ toast, onDismiss }) {
  const style = TOAST_STYLES[toast.type] || TOAST_STYLES.info;
  const Icon = style.icon;

  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.type === "error" ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex items-start gap-2 w-full sm:w-auto sm:max-w-sm bg-white border rounded-xl shadow-lg px-4 py-3 text-sm ${style.className}`}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${style.iconClass}`} />
      <span className="flex-1 whitespace-pre-line">{toast.message}</span>
      <button type="button" onClick={onDismiss} className="p-0.5 -mr-1 rounded text-gray-400 hover:text-gray-600" aria-label="Sluiten">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
