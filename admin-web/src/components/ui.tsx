import { useState, type ReactNode } from 'react';

export function Badge({ tone, children }: { tone: 'green' | 'yellow' | 'red' | 'gray' | 'purple' | 'blue'; children: ReactNode }) {
  return <span className={`admin-badge admin-badge--${tone}`}>{children}</span>;
}

export function StatCard({ label, value, small }: { label: string; value: ReactNode; small?: boolean }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-card__label">{label}</div>
      <div className={`admin-stat-card__value ${small ? 'admin-stat-card__value--sm' : ''}`}>{value}</div>
    </div>
  );
}

export function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="admin-panel">
      {title && (
        <div className="admin-panel__title">
          <span>{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className="admin-loading">
      <div className="admin-skeleton" style={{ width: '60%', marginBottom: 8 }} />
      <div className="admin-skeleton" style={{ width: '80%', marginBottom: 8 }} />
      <div className="admin-skeleton" style={{ width: '40%' }} />
    </div>
  );
}

export function Empty({ children = 'Nothing to show here yet.' }: { children?: ReactNode }) {
  return <div className="admin-empty">{children}</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="admin-error">{message}</div>;
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="admin-drawer__header">
          <h2 style={{ margin: 0, fontSize: 17 }}>{title}</h2>
          <button className="admin-drawer__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Every sensitive action in this app routes through this — requires an explicit,
 *  non-empty reason before the confirm button is even enabled, matching the server's own
 *  independent requirement that every moderation/config/payment mutation include a reason.
 *  This is UX convenience only; the real enforcement is server-side (see admin/server.ts) —
 *  a request with an empty reason is rejected there regardless of what this dialog allows. */
export function ConfirmActionModal({
  title,
  description,
  confirmLabel = 'Confirm',
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="admin-modal-overlay" onClick={onCancel}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {description && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{description}</p>}
        <label style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>Reason (required, recorded in the audit log)</label>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this action being taken?" />
        <div className="admin-modal-actions">
          <button className="admin-btn admin-btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={`admin-btn ${danger ? 'admin-btn--danger' : ''}`} disabled={!reason.trim() || busy} onClick={() => onConfirm(reason.trim())}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}


