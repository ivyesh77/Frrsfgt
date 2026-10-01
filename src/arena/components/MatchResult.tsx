import { motion } from 'framer-motion';
import { Button } from '../../components/common/Button';
import { GAME_KIND_LABELS, initialsOf, type ArenaUser, type MatchResultPublic } from '../types';

interface MatchResultProps {
  result: MatchResultPublic;
  user: ArenaUser;
  busy: boolean;
  onBackToLobby: () => void;
  onRematch: () => void;
}

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣'];

export function MatchResult({ result, user, busy, onBackToLobby, onRematch }: MatchResultProps) {
  const ranked = [...result.results].sort((a, b) => b.score - a.score);
  const myResult = result.results.find((r) => r.id === user.id);
  const myRank = ranked.findIndex((r) => r.id === user.id);
  const isDuel = result.format === 'duel';

  return (
    <div className="arena-centered no-select">
      <motion.div
        className="arena-card glass-panel arena-card--wide"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <p className="arena-subtitle">
          {GAME_KIND_LABELS[result.gameKind]} · Entry 🪙 {result.entryFee.toLocaleString()}
          {result.endedBy === 'forfeit' && ' · ended by forfeit'}
        </p>

        {isDuel ? <DuelHeadline result={result} myResult={myResult} /> : <SquadHeadline myRank={myRank} isVoid={result.isVoidMatch} />}

        {myResult && (myResult.maxStreak > 0 || myResult.avgReactionMs !== null) && (
          <div className="arena-performance-row">
            {myResult.maxStreak > 0 && <span>🔥 Best streak: {myResult.maxStreak}</span>}
            {myResult.avgReactionMs !== null && <span>⚡ Avg. reaction: {(myResult.avgReactionMs / 1000).toFixed(2)}s</span>}
            {myResult.fastestReactionMs !== null && <span>🚀 Fastest: {(myResult.fastestReactionMs / 1000).toFixed(2)}s</span>}
          </div>
        )}

        <ul className="arena-result-list">
          {ranked.map((r, i) => (
            <motion.li
              key={r.id}
              className={r.id === user.id ? 'arena-result-list__self' : ''}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
            >
              <span className="arena-result-list__rank">{isDuel ? `#${i + 1}` : MEDALS[i] ?? `#${i + 1}`}</span>
              <span className="arena-avatar arena-avatar--sm" aria-hidden="true">
                {initialsOf(r.name)}
              </span>
              <span className="arena-result-list__name">
                {r.id === user.id ? 'You' : r.name}
                {r.isWinner && ' 🏆'}
                {r.connectionState === 'forfeited' && ' (forfeited)'}
              </span>
              <span className="arena-result-list__score">{r.score} pts</span>
              <span className="arena-result-list__meta">
                ✓{r.correct} ✕{r.wrong}
                {r.maxStreak > 1 && ` · 🔥${r.maxStreak}`}
              </span>
              <span className="arena-result-list__payout">{r.payout > 0 ? `+🪙 ${r.payout.toLocaleString()}` : '—'}</span>
            </motion.li>
          ))}
        </ul>

        <div className="arena-pool-breakdown">
          <span>Pool: 🪙 {result.pool.toLocaleString()}</span>
          {result.isVoidMatch || result.isDraw ? (
            <span>{result.isDraw ? 'Draw' : 'Void match'} — every entry fee refunded, 0 platform fee</span>
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

        <div className="arena-result-actions">
          <Button variant="primary" size="lg" disabled={busy} onClick={onRematch}>
            Rematch
          </Button>
          <Button variant="secondary" size="lg" onClick={onBackToLobby}>
            Return to Lobby
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function DuelHeadline({ result, myResult }: { result: MatchResultPublic; myResult: MatchResultPublic['results'][number] | undefined }) {
  if (result.isDraw) {
    return (
      <motion.div className="arena-result-headline arena-result-headline--draw" initial={{ scale: 0.85 }} animate={{ scale: 1 }}>
        🤝 DRAW
        <span className="arena-result-headline__sub">{myResult?.score ?? 0} pts each · entry fee fully refunded</span>
      </motion.div>
    );
  }
  const won = !!myResult?.isWinner;
  return (
    <motion.div
      className={`arena-result-headline ${won ? 'arena-result-headline--win' : 'arena-result-headline--lose'}`}
      initial={{ scale: 0.85 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 14 }}
    >
      {won ? '🏆 YOU WIN' : 'YOU LOSE'}
      <span className="arena-result-headline__sub">
        {myResult?.score ?? 0} pts{won && myResult ? ` · +🪙 ${myResult.payout.toLocaleString()}` : ''}
      </span>
    </motion.div>
  );
}

function SquadHeadline({ myRank, isVoid }: { myRank: number; isVoid: boolean }) {
  if (isVoid) {
    return (
      <motion.div className="arena-result-headline arena-result-headline--draw" initial={{ scale: 0.85 }} animate={{ scale: 1 }}>
        🤝 Void Match
        <span className="arena-result-headline__sub">Nobody answered a single question — entry fees fully refunded</span>
      </motion.div>
    );
  }
  const place = myRank + 1;
  return (
    <motion.div className="arena-result-headline arena-result-headline--standings" initial={{ scale: 0.85 }} animate={{ scale: 1 }}>
      FINAL STANDINGS
      <span className="arena-result-headline__sub">You placed {MEDALS[myRank] ?? `#${place}`}</span>
    </motion.div>
  );
}
