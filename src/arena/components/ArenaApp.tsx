import { useEffect, useRef, useState } from 'react';
import { useArena } from '../useArena';
import { useOnline } from '../useOnline';
import { useGlobalReducedMotionClass } from '../useGlobalReducedMotionClass';
import { useArenaPrefs } from '../useArenaPrefs';
import { startMusic, stopMusic } from '../sound';
import { fetchUnreadNotificationCount } from '../api';
import { AppShell, type ShellTab } from './AppShell';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { RoomScreen } from './RoomScreen';
import { MatchResult } from './MatchResult';
import { ProfileScreen } from './ProfileScreen';
import { DashboardHome } from './DashboardHome';
import { WalletScreen } from './WalletScreen';
import { MatchHistoryScreen } from './MatchHistoryScreen';
import { MatchHistoryDetail } from './MatchHistoryDetail';
import { StatsScreen } from './StatsScreen';
import { AchievementsScreen } from './AchievementsScreen';
import { NotificationsScreen } from './NotificationsScreen';
import { SettingsScreen } from './SettingsScreen';
import { SupportScreen } from './SupportScreen';
import './arena.css';

/** Every screen reachable once the player is signed in and not in a live match/result —
 *  all rendered inside the persistent nav shell. `historyDetail` keeps the specific room id
 *  it should show in a sibling piece of state (`historyRoomId`) rather than smuggling it
 *  into the screen name itself. */
type Screen = 'home' | 'play' | 'wallet' | 'history' | 'historyDetail' | 'profile' | 'stats' | 'achievements' | 'notifications' | 'settings' | 'support';

function shellTabFor(screen: Screen): ShellTab {
  if (screen === 'historyDetail') return 'history';
  if (screen === 'stats' || screen === 'achievements' || screen === 'settings' || screen === 'support') return 'profile';
  if (screen === 'notifications') return 'home';
  if (screen === 'home' || screen === 'play' || screen === 'wallet' || screen === 'history' || screen === 'profile') return screen;
  return 'home';
}

/** Top-level orchestrator for the multiplayer wagering arcade. */
export function ArenaApp() {
  const arena = useArena();
  const { state } = arena;
  const online = useOnline();
  useGlobalReducedMotionClass();
  const [prefs] = useArenaPrefs();

  // Ambient background music (see sound.ts startMusic/stopMusic) plays only while browsing
  // the app with the toggle on, and is always stopped during a live match so it can never
  // mask the real correct/wrong/countdown audio cues.
  useEffect(() => {
    if (prefs.musicEnabled && state.stage !== 'room') {
      startMusic();
    } else {
      stopMusic();
    }
    return () => stopMusic();
  }, [prefs.musicEnabled, state.stage]);

  const [screen, setScreen] = useState<Screen>('home');
  const [historyRoomId, setHistoryRoomId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const prevUserId = useRef<string | null>(null);
  useEffect(() => {
    const currentId = state.user?.id ?? null;
    if (currentId && currentId !== prevUserId.current) {
      // A fresh login/session — always land on the dashboard, never wherever a previous
      // account happened to leave the nav.
      setScreen('home');
    }
    prevUserId.current = currentId;
  }, [state.user?.id]);

  useEffect(() => {
    if (state.stage !== 'lobby') return;
    void arena.refreshRooms();
    void arena.refreshGameModes();
    const interval = window.setInterval(() => void arena.refreshRooms(), 3000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage]);

  // Real notification count, polled at a modest interval — there is no live push
  // transport for notifications (see notifications.ts), so this is an honest "ask the
  // server what's actually true right now" rather than a fabricated live feed.
  useEffect(() => {
    if (!state.user) return;
    let cancelled = false;
    function poll() {
      void fetchUnreadNotificationCount()
        .then((count) => {
          if (!cancelled) setUnreadCount(count);
        })
        .catch(() => {
          // Transient — next poll retries.
        });
    }
    poll();
    const interval = window.setInterval(poll, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [state.user, state.activityToken]);

  function openMatchDetail(roomId: string) {
    setHistoryRoomId(roomId);
    setScreen('historyDetail');
  }

  if (state.bootstrapping) {
    return <div className="arena-shell arena-shell--loading" aria-busy="true" />;
  }

  // The initial "are we already logged in?" check couldn't get a definitive answer after
  // retrying (network error, or the server returning 403/429/500/502/503) — this is
  // deliberately NOT the login screen (we never confirmed the session is actually gone)
  // and NOT the authenticated app (we never confirmed it's actually valid either). Showing
  // either would be a guess; this tells the player plainly what's wrong instead.
  if (state.bootstrapError) {
    return (
      <div className="arena-shell arena-shell--loading" aria-busy="false">
        <div className="arena-connection-error" role="alert">
          <p>Couldn't reach the server to check your session. This is a connection problem, not a logout.</p>
          <button type="button" onClick={arena.retryBootstrap}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const toast = state.error ? (
    <div className="arena-toast" role="alert">
      <span>{state.error}</span>
      <button type="button" onClick={arena.clearError} aria-label="Dismiss">
        ✕
      </button>
    </div>
  ) : state.notice ? (
    <div className="arena-toast arena-toast--notice" role="status">
      <span>{state.notice}</span>
      <button type="button" onClick={arena.dismissNotice} aria-label="Dismiss">
        ✕
      </button>
    </div>
  ) : null;

  if (state.stage === 'login') {
    return (
      <div className="arena-shell">
        {toast}
        <Home busy={state.authenticating} onLogin={arena.login} onSignup={arena.signup} />
      </div>
    );
  }

  if (!state.user) {
    // Defensive — every stage below requires a user; the reducer never actually produces
    // this combination, but TypeScript (and a genuinely corrupted runtime state) should
    // still get an honest fallback instead of a crash.
    return <div className="arena-shell arena-shell--loading" aria-busy="true" />;
  }

  if (state.stage === 'room' && state.room) {
    return (
      <div className="arena-shell">
        {toast}
        <RoomScreen
          user={state.user}
          room={state.room}
          round={state.round}
          matchFoundToken={state.matchFoundToken}
          onReady={arena.setReady}
          onLeave={arena.leaveRoom}
          onAnswer={arena.submitAnswer}
        />
      </div>
    );
  }

  if (state.stage === 'result' && state.matchResult) {
    return (
      <div className="arena-shell">
        {toast}
        <MatchResult result={state.matchResult} user={state.user} busy={state.busy} onBackToLobby={arena.backToLobby} onRematch={arena.requestRematch} />
      </div>
    );
  }

  return (
    <div className="arena-shell arena-shell--app">
      {toast}
      <AppShell
        user={state.user}
        activeTab={shellTabFor(screen)}
        onTabChange={(tab) => setScreen(tab)}
        unreadNotifications={unreadCount}
        onOpenNotifications={() => setScreen('notifications')}
        onOpenSettings={() => setScreen('settings')}
        offline={!online}
      >
        {screen === 'home' && (
          <DashboardHome
            user={state.user}
            onPlay={() => setScreen('play')}
            onOpenWallet={() => setScreen('wallet')}
            onOpenHistory={() => setScreen('history')}
            onOpenMatch={openMatchDetail}
            refreshToken={state.activityToken}
          />
        )}

        {screen === 'play' && (
          <Lobby user={state.user} rooms={state.rooms} gameModes={state.gameModes} busy={state.busy} onPlay={arena.joinQueue} onOpenWallet={() => setScreen('wallet')} />
        )}

        {screen === 'wallet' && <WalletScreen user={state.user} busy={state.busy} onTopUp={arena.topUp} onWithdraw={arena.withdraw} />}

        {screen === 'history' && <MatchHistoryScreen onOpenMatch={openMatchDetail} />}

        {screen === 'historyDetail' && historyRoomId && <MatchHistoryDetail roomId={historyRoomId} onBack={() => setScreen('history')} />}

        {screen === 'profile' && (
          <ProfileScreen
            user={state.user}
            onOpenWallet={() => setScreen('wallet')}
            onOpenStats={() => setScreen('stats')}
            onOpenAchievements={() => setScreen('achievements')}
            onOpenHistory={() => setScreen('history')}
            onOpenSettings={() => setScreen('settings')}
            onOpenSupport={() => setScreen('support')}
            onLogout={arena.logout}
          />
        )}

        {screen === 'stats' && <StatsScreen onBack={() => setScreen('profile')} />}
        {screen === 'achievements' && <AchievementsScreen onBack={() => setScreen('profile')} />}
        {screen === 'notifications' && <NotificationsScreen onBack={() => setScreen('home')} onUnreadCountChange={setUnreadCount} />}
        {screen === 'settings' && <SettingsScreen onBack={() => setScreen('profile')} onLogout={arena.logout} />}
        {screen === 'support' && <SupportScreen onBack={() => setScreen('profile')} />}
      </AppShell>
    </div>
  );
}
