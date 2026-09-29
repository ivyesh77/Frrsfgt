import type { GameEngineState } from '../../game/engine/gameReducer';
import { Hud } from './Hud';
import { GameArena } from './GameArena';
import './GameScreen.css';

interface GameScreenProps {
  engine: GameEngineState;
  soundOn: boolean;
  reducedMotion: boolean;
  onSelect: (position: number) => void;
  onOpenSettings: () => void;
  onToggleSound: () => void;
}

export function GameScreen({ engine, soundOn, reducedMotion, onSelect, onOpenSettings, onToggleSound }: GameScreenProps) {
  return (
    <div className="game-screen no-select">
      <Hud
        score={engine.score.score}
        streak={engine.score.streak}
        roundNumber={engine.roundNumber}
        onOpenSettings={onOpenSettings}
        soundOn={soundOn}
        onToggleSound={onToggleSound}
      />
      <div className="game-screen__arena-wrap">
        <GameArena engine={engine} reducedMotion={reducedMotion} onSelect={onSelect} />
      </div>
      {engine.phase === 'PAUSED' && (
        <div className="game-screen__paused-badge" role="status">
          Paused
        </div>
      )}
    </div>
  );
}
