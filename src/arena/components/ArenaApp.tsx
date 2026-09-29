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

      {state.stage === 'login' && <Home busy={state.authenticating} onLogin={arena.login} />}

      {state.stage === 'lobby' && state.user && (
        <Lobby
          user={state.user}
          rooms={state.rooms}
          busy={state.busy}
          onPlay={arena.playAtFee}
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
          question={state.question}
          questionReceivedAt={state.questionReceivedAt}
          answerFeedback={state.answerFeedback}
          onReady={arena.setReady}
          onLeave={arena.leaveRoom}
          onAnswer={arena.submitAnswer}
        />
      )}

      {state.stage === 'result' && state.matchResult && state.user && (
        <MatchResult result={state.matchResult} user={state.user} onBackToLobby={arena.backToLobby} />
      )}
    </div>
  );
}
