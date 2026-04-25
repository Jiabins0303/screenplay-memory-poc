import { ReactNode, useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}

export default function Modal({ open, onClose, title, children, width = 420 }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.32)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 70,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{
          width,
          maxWidth: "90vw",
          padding: 20,
          background: "var(--ink-100)",
        }}
      >
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 16, color: "var(--ink-900)", fontWeight: 700 }}>
            {title}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
