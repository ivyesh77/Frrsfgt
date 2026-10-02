import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { UsersPage } from './pages/Users';
import { RoomsPage } from './pages/Rooms';
import { MatchmakingPage } from './pages/Matchmaking';
import { GameConfigPage } from './pages/GameConfig';
import { GameContentPage } from './pages/GameContent';
import { WalletOverviewPage } from './pages/WalletOverview';
import { TransactionsPage } from './pages/Transactions';
import { ReconciliationPage } from './pages/Reconciliation';
import { ProvidersPage } from './pages/Providers';
import { PaymentOverviewPage } from './pages/PaymentOverview';
import { PaymentAdaptersPage } from './pages/PaymentAdapters';
import { PaymentConfigPage } from './pages/PaymentConfig';
import { PaymentOperatorsPage } from './pages/PaymentOperators';
import { PaymentTransactionsPage } from './pages/PaymentTransactions';
import { PaymentReconciliationPage } from './pages/PaymentReconciliation';
import { UpiPage } from './pages/Upi';
import { CryptoPage } from './pages/Crypto';
import { WebhooksPage } from './pages/Webhooks';
import { RiskPage } from './pages/Risk';
import { AntiCheatPage } from './pages/AntiCheat';
import { AnalyticsPage } from './pages/Analytics';
import { SystemHealthPage } from './pages/SystemHealth';
import { LogsPage } from './pages/Logs';
import { FlagsPage } from './pages/Flags';
import { MaintenancePage } from './pages/Maintenance';
import { AdminUsersPage } from './pages/AdminUsers';
import { AuditLogPage } from './pages/AuditLog';
import { MyActivityPage } from './pages/MyActivity';
import { SupportPage } from './pages/Support';
import { GlobalSearchBar } from './components/GlobalSearchBar';

interface NavItem {
  to: string;
  label: string;
  permission?: string;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  { label: '', items: [{ to: '/', label: '📊 Dashboard', permission: 'dashboard.view' }] },
  {
    label: 'Users',
    items: [{ to: '/users', label: 'All Users', permission: 'users.view' }],
  },
  {
    label: 'Game',
    items: [
      { to: '/rooms', label: 'Live Matches & Rooms', permission: 'rooms.view' },
      { to: '/matchmaking', label: 'Matchmaking', permission: 'matchmaking.view' },
      { to: '/game-config', label: 'Game Controls', permission: 'game.config.view' },
      { to: '/game-content', label: 'Game Content', permission: 'game.content.view' },
    ],
  },
  {
    label: 'Wallet',
    items: [
      { to: '/wallet', label: 'Overview', permission: 'wallet.view' },
      { to: '/transactions', label: 'Transactions', permission: 'transactions.view' },
      { to: '/reconciliation', label: 'Reconciliation', permission: 'reconciliation.view' },
    ],
  },
  {
    label: 'Payments',
    items: [
      { to: '/payment-operations', label: 'Payment Operations', permission: 'PAYMENT_VIEW' },
      { to: '/payment-adapters', label: 'Payment Accounts', permission: 'PAYMENT_VIEW' },
      { to: '/payment-config', label: 'Routing & Limits', permission: 'PAYMENT_VIEW' },
      { to: '/payment-operators', label: 'Payment Operators', permission: 'PAYMENT_OPERATOR_ADMIN' },
      { to: '/payment-transactions', label: 'Payment Transactions', permission: 'PAYMENT_VIEW' },
      { to: '/payment-reconciliation', label: 'Payment Reconciliation', permission: 'PAYMENT_VIEW' },
      { to: '/providers', label: 'Legacy Provider Config', permission: 'payments.view' },
      { to: '/upi', label: 'UPI', permission: 'payments.view' },
      { to: '/crypto', label: 'Crypto', permission: 'payments.view' },
      { to: '/webhooks', label: 'Webhooks', permission: 'webhooks.view' },
    ],
  },
  {
    label: 'Risk',
    items: [
      { to: '/risk', label: 'Fraud Signals', permission: 'risk.view' },
      { to: '/anticheat', label: 'Anti-Cheat', permission: 'anticheat.view' },
    ],
  },
  { label: 'Analytics', items: [{ to: '/analytics', label: 'Analytics Center', permission: 'analytics.view' }] },
  {
    label: 'System',
    items: [
      { to: '/system', label: 'Health', permission: 'system.view' },
      { to: '/logs', label: 'Logs', permission: 'logs.view' },
      { to: '/flags', label: 'Feature Flags', permission: 'flags.view' },
      { to: '/maintenance', label: 'Maintenance', permission: 'maintenance.view' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/admin-users', label: 'Admin Users', permission: 'admin.manage' },
      { to: '/audit', label: 'Audit Logs', permission: 'audit.view' },
      { to: '/my-activity', label: 'My Activity' },
    ],
  },
  { label: '', items: [{ to: '/support', label: '🎧 Support', permission: 'support.view' }] },
];

function Sidebar() {
  const { has } = useAuth();
  return (
    <nav className="admin-sidebar">
      <div className="admin-sidebar__brand">
        Wager Arena <span>Admin</span>
      </div>
      {NAV.map((group, i) => {
        const visibleItems = group.items.filter((item) => !item.permission || has(item.permission));
        if (visibleItems.length === 0) return null;
        return (
          <div key={i}>
            {group.label && <div className="admin-sidebar__group">{group.label}</div>}
            {visibleItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`} end={item.to === '/'}>
                {item.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function Topbar() {
  const { admin, logout } = useAuth();
  return (
    <header className="admin-topbar">
      <GlobalSearchBar />
      <div className="admin-topbar__user">
        <span>
          {admin?.name} · <strong>{admin?.role}</strong>
        </span>
        <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => void logout()}>
          Log out
        </button>
      </div>
    </header>
  );
}

/** Route-level guard: a permission a nav item was hidden for is ALSO blocked here — the
 *  sidebar hiding an item is UX only; this is what actually stops navigating there
 *  directly by URL. The real, unbypassable boundary is still server-side (every API call
 *  the page beneath this makes is independently permission-checked again) — this is just
 *  the second, defense-in-depth layer appropriate for a UI, never the only one. */
function RequirePermission({ permission, children }: { permission?: string; children: React.ReactElement }) {
  const { has } = useAuth();
  if (permission && !has(permission)) {
    return (
      <div className="admin-content">
        <div className="admin-error">You don't have permission to view this page ({permission}).</div>
      </div>
    );
  }
  return children;
}

export function App() {
  const { admin, loading, bootstrapError, retryBootstrap } = useAuth();

  if (loading) return <div className="admin-loading" style={{ padding: 40 }}>Loading…</div>;
  if (bootstrapError) {
    return (
      <div className="admin-loading" style={{ padding: 40, textAlign: 'center' }} role="alert">
        <p>Couldn't reach the server to check your session. This is a connection problem, not a logout.</p>
        <button type="button" onClick={retryBootstrap}>
          Retry
        </button>
      </div>
    );
  }
  if (!admin) return <LoginPage />;

  return (
    <div className="admin-shell">
      <Sidebar />
      <div className="admin-main">
        <Topbar />
        <div className="admin-content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/users/*" element={<RequirePermission permission="users.view"><UsersPage /></RequirePermission>} />
            <Route path="/rooms/*" element={<RequirePermission permission="rooms.view"><RoomsPage /></RequirePermission>} />
            <Route path="/matchmaking" element={<RequirePermission permission="matchmaking.view"><MatchmakingPage /></RequirePermission>} />
            <Route path="/game-config" element={<RequirePermission permission="game.config.view"><GameConfigPage /></RequirePermission>} />
            <Route path="/game-content" element={<RequirePermission permission="game.content.view"><GameContentPage /></RequirePermission>} />
            <Route path="/wallet" element={<RequirePermission permission="wallet.view"><WalletOverviewPage /></RequirePermission>} />
            <Route path="/transactions" element={<RequirePermission permission="transactions.view"><TransactionsPage /></RequirePermission>} />
            <Route path="/reconciliation" element={<RequirePermission permission="reconciliation.view"><ReconciliationPage /></RequirePermission>} />
            <Route path="/payment-operations" element={<RequirePermission permission="PAYMENT_VIEW"><PaymentOverviewPage /></RequirePermission>} />
            <Route path="/payment-adapters" element={<RequirePermission permission="PAYMENT_VIEW"><PaymentAdaptersPage /></RequirePermission>} />
            <Route path="/payment-config" element={<RequirePermission permission="PAYMENT_VIEW"><PaymentConfigPage /></RequirePermission>} />
            <Route path="/payment-operators" element={<RequirePermission permission="PAYMENT_OPERATOR_ADMIN"><PaymentOperatorsPage /></RequirePermission>} />
            <Route path="/payment-transactions" element={<RequirePermission permission="PAYMENT_VIEW"><PaymentTransactionsPage /></RequirePermission>} />
            <Route path="/payment-reconciliation" element={<RequirePermission permission="PAYMENT_VIEW"><PaymentReconciliationPage /></RequirePermission>} />
            <Route path="/providers" element={<RequirePermission permission="payments.view"><ProvidersPage /></RequirePermission>} />
            <Route path="/upi" element={<RequirePermission permission="payments.view"><UpiPage /></RequirePermission>} />
            <Route path="/crypto" element={<RequirePermission permission="payments.view"><CryptoPage /></RequirePermission>} />
            <Route path="/webhooks" element={<RequirePermission permission="webhooks.view"><WebhooksPage /></RequirePermission>} />
            <Route path="/risk" element={<RequirePermission permission="risk.view"><RiskPage /></RequirePermission>} />
            <Route path="/anticheat" element={<RequirePermission permission="anticheat.view"><AntiCheatPage /></RequirePermission>} />
            <Route path="/analytics" element={<RequirePermission permission="analytics.view"><AnalyticsPage /></RequirePermission>} />
            <Route path="/system" element={<RequirePermission permission="system.view"><SystemHealthPage /></RequirePermission>} />
            <Route path="/logs" element={<RequirePermission permission="logs.view"><LogsPage /></RequirePermission>} />
            <Route path="/flags" element={<RequirePermission permission="flags.view"><FlagsPage /></RequirePermission>} />
            <Route path="/maintenance" element={<RequirePermission permission="maintenance.view"><MaintenancePage /></RequirePermission>} />
            <Route path="/admin-users" element={<RequirePermission permission="admin.manage"><AdminUsersPage /></RequirePermission>} />
            <Route path="/audit" element={<RequirePermission permission="audit.view"><AuditLogPage /></RequirePermission>} />
            <Route path="/my-activity" element={<MyActivityPage />} />
            <Route path="/support" element={<RequirePermission permission="support.view"><SupportPage /></RequirePermission>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
