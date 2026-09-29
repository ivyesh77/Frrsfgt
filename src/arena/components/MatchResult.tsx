import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { GAME_KIND_LABELS, type ArenaUser, type MatchResultPublic } from '../types';

interface MatchResultProps {
  result: MatchResultPublic;
  user: ArenaUser;
  onBackToLobby: () => void;
}

export function MatchResult({ result, user, onBackToLobby }: MatchResultProps) {
  const ranked = [...result.results].sort((a, b) => b.score - a.score);
  const myResult = result.results.find((r) => r.id === user.id);

  return (
    <div className="arena-centered no-select">
      <motion.div
        className="arena-card glass-panel arena-card--wide"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="arena-title">Match Over</h1>
        <p className="arena-subtitle">{GAME_KIND_LABELS[result.gameKind]} · Entry 🪙 {result.entryFee.toLocaleString()}</p>

        {myResult && result.isVoidMatch && (
          <div className="arena-my-result">
            🤝 Nobody scored — this round is void. Your 🪙 {myResult.payout.toLocaleString()} entry fee was fully
            refunded, no platform fee taken.
          </div>
        )}
        {myResult && !result.isVoidMatch && (
          <div className={`arena-my-result ${myResult.isWinner ? 'arena-my-result--win' : 'arena-my-result--lose'}`}>
            {myResult.isWinner ? (
              <>🏆 You won 🪙 {myResult.payout.toLocaleString()}!</>
            ) : (
              <>Better luck next time — no payout this round.</>
            )}
          </div>
        )}

        <ul className="arena-result-list">
          {ranked.map((r, i) => (
            <li key={r.id} className={r.id === user.id ? 'arena-result-list__self' : ''}>
              <span className="arena-result-list__rank">#{i + 1}</span>
              <span className="arena-result-list__name">
                {r.name}
                {r.isWinner && ' 🏆'}
              </span>
              <span className="arena-result-list__score">{r.score} pts</span>
              <span className="arena-result-list__meta">
                ✓{r.correct} ✕{r.wrong}
              </span>
              <span className="arena-result-list__payout">{r.payout > 0 ? `+🪙 ${r.payout.toLocaleString()}` : '—'}</span>
            </li>
          ))}
        </ul>

        <div className="arena-pool-breakdown">
          <span>Pool: 🪙 {result.pool.toLocaleString()}</span>
          {result.isVoidMatch ? (
            <span>Void match — every entry fee refunded, 0 platform fee</span>
          ) : (
            <>
              <span>Winner payout: 🪙 {result.winnerPayoutTotal.toLocaleString()} (80%)</span>
              <span>Platform fee: 🪙 {result.platformCut.toLocaleString()} (20%)</span>
            </>
          )}
        </div>

        <div className="arena-wallet arena-wallet--inline glass-panel">
          <span className="arena-wallet__label">Your wallet now</span>
          <span className="arena-wallet__value">🪙 {user.walletBalance.toLocaleString()}</span>
        </div>

        <Button variant="primary" size="lg" onClick={onBackToLobby}>
          Back to Lobby
        </Button>
      </motion.div>
    </div>
  );
}
