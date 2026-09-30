import type { GeneratedRound } from '../types.js';
import { activeAssetIds } from '../admin/gameContent.js';
import { ASSET_MIRROR } from './assetMirror.js';
import { newRoundToken, pickDistinct, shuffle } from './shared.js';

/**
 * Generates one round. The correct answer is identified by a freshly-random opaque
 * `correctToken` that the server keeps to itself (see rooms.ts) — every option (including
 * the correct one) gets its own random token, unrelated to its asset id, so the token
 * alone never betrays which option is correct.
 *
 * Each option still carries its real `assetId` because the client has to render an actual
 * picture for it — there is no way around that for a game about recognizing images without
 * inventing an image-proxying layer (see the honest discussion in RoundOptionPublic's
 * doc-comment in types.ts and SECURITY_REPORT.md). What this *does* remove is the old
 * single-payload design where `prompt.assetId` and `options[].assetId` arrived together
 * in one object, making the correct answer a one-line string-match away with zero
 * knowledge of timing or state. Now the target and the options are delivered as two
 * separate, server-timed events (see rooms.ts), and the server is the only party that
 * ever holds the token↔correctness mapping.
 */
export function generateMemoryMatch(): GeneratedRound {
  // Only ever draws from admin-enabled assets (see ../admin/gameContent.ts) — an asset an
  // operator has disabled can never appear as either the target or a distractor. Falls back
  // to the full mirror if, somehow, fewer than 5 assets are active (setAssetActive() itself
  // already refuses to let that happen through the admin API, but a round must never crash
  // the match for a player over a content-management edge case).
  const active = activeAssetIds();
  const pool = ASSET_MIRROR.filter((a) => active.has(a.id));
  const source = pool.length >= 5 ? pool : ASSET_MIRROR;
  const [target, ...distractors] = pickDistinct(source, 4);
  if (!target) throw new Error('Not enough assets to generate a memory match round');

  const candidates = shuffle([target, ...distractors]);
  const options = candidates.map((c) => ({ token: newRoundToken(), assetId: c.id }));
  const correctIndex = candidates.findIndex((c) => c.id === target.id);
  const correctOption = options[correctIndex];
  if (!correctOption) throw new Error('Invariant violated: target missing from its own candidate set');

  return {
    targetAssetId: target.id,
    options,
    correctToken: correctOption.token,
  };
}
