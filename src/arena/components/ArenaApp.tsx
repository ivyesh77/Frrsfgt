import { useEffect } from 'react';
import { useArena } from '../useArena';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { RoomScreen } from './RoomScreen';
import { MatchResult } from './MatchResult';
import { ProfileScreen } from './ProfileScreen';
import './arena.css';

/** Top-level orchestrator for the multiplayer wagering arcade — one screen per stage. */
export function ArenaApp() {
  const arena = useArena();
  const { state } = arena;

  useEffect(() => {
    if (state.stage !== 'lobby') return;
    void arena.refreshRooms();
    const interval = window.setInterval(() => void arena.refreshRooms(), 3000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage]);

  // Briefly checking whether an existing server session is already valid (via the httpOnly
  // cookie) before deciding whether to show the login screen — avoids a login-screen flash
  // for an already-authenticated visitor on page refresh.
  if (state.bootstrapping) {
    return <div className="arena-shell arena-shell--loading" aria-busy="true" />;
  }

  return (
    <div className="arena-shell">
      {state.error && (
        <div className="arena-toast" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={arena.clearError} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {!state.error && state.notice && (
        <div className="arena-toast arena-toast--notice" role="status">
          <span>{state.notice}</span>
          <button type="button" onClick={arena.dismissNotice} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {state.stage === 'login' && <Home busy={state.authenticating} onLogin={arena.login} onSignup={arena.signup} />}

      {state.stage === 'lobby' && state.user && (
        <Lobby
          user={state.user}
          rooms={state.rooms}
          busy={state.busy}
          onPlay={arena.joinQueue}
          onTopUp={arena.topUp}
          onWithdraw={arena.withdraw}
          onProfile={arena.goToProfile}
        />
      )}

      {state.stage === 'profile' && state.user && (
        <ProfileScreen
          user={state.user}
          onBack={arena.backToLobby}
          onLogout={arena.logout}
          onTopUp={arena.topUp}
          onWithdraw={arena.withdraw}
        />
      )}

      {state.stage === 'room' && state.user && state.room && (
        <RoomScreen
          user={state.user}
          room={state.room}
          round={state.round}
          matchFoundToken={state.matchFoundToken}
          onReady={arena.setReady}
          onLeave={arena.leaveRoom}
          onAnswer={arena.submitAnswer}
        />
      )}

      {state.stage === 'result' && state.matchResult && state.user && (
        <MatchResult
          result={state.matchResult}
          user={state.user}
          busy={state.busy}
          onBackToLobby={arena.backToLobby}
          onRematch={arena.requestRematch}
        />
      )}
    </div>
  );
}
