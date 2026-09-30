import { usePolling } from '../hooks';
import { ErrorBox, Loading, StatCard } from '../components/ui';

interface Reconciliation {
  matchedCount: number;
  missingProviderEventCount: number;
  orphanProviderEventCount: number;
  duplicateEventCount: number;
  note: string;
}

export function ReconciliationPage() {
  const { data, error, loading } = usePolling<Reconciliation>('/admin/reconciliation', 15000);
  return (
    <div>
      <h1 className="admin-page-title">Payment Reconciliation</h1>
      <p className="admin-page-sub">Internal ledger vs payment provider events.</p>
      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="admin-grid">
            <StatCard label="Matched" value={data.matchedCount} />
            <StatCard label="Missing Provider Event" value={data.missingProviderEventCount} />
            <StatCard label="Orphan Provider Events" value={data.orphanProviderEventCount} />
            <StatCard label="Duplicate Events" value={data.duplicateEventCount} />
          </div>
          <div className="admin-note">{data.note}</div>
        </>
      )}
    </div>
  );
}
