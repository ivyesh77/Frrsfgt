/**
 * Game content / image asset management. The underlying asset set is a small, fixed,
 * bundled mirror (../gameKinds/assetMirror.ts) of the client's image registry — there is no
 * arbitrary file-upload pipeline in this product yet (see ADMIN_REPORT.md for the honest
 * scope note on this). What IS real here: admin-controlled active/inactive + tags on top of
 * that fixed set, and the round generator (../gameKinds/memoryMatch.ts) actually filters to
 * only currently-active assets — disabling an asset here immediately stops it from ever
 * being selected as a target or a distractor, which is a genuinely enforced effect, not a
 * cosmetic admin-only flag.
 */
import { ASSET_MIRROR, type AssetRef } from '../gameKinds/assetMirror.js';
import { getAssetOverrides, setAssetOverride } from './store.js';
import type { AdminAccount } from './types.js';

export interface GameAsset {
  id: string;
  category: string;
  active: boolean;
  tags: string[];
  updatedAt: number | null;
  updatedBy: string | null;
}

export function listGameAssets(): GameAsset[] {
  const overrides = getAssetOverrides();
  return ASSET_MIRROR.map((asset: AssetRef) => {
    const override = overrides[asset.id];
    return {
      id: asset.id,
      category: asset.category,
      active: override?.active ?? true,
      tags: override?.tags ?? [],
      updatedAt: override?.updatedAt ?? null,
      updatedBy: override?.updatedBy ?? null,
    };
  });
}

export class UnknownAssetError extends Error {}
export class WouldEmptyActiveSetError extends Error {
  constructor() {
    super('Refusing to disable the last remaining active asset — the game needs at least 5 distinct assets to generate a valid round (1 target + 4 options)');
  }
}

const MIN_ACTIVE_ASSETS = 5; // generateMemoryMatch() needs 1 target + 4 distinct distractors

export function setAssetActive(assetId: string, active: boolean, admin: AdminAccount): GameAsset[] {
  if (!ASSET_MIRROR.some((a) => a.id === assetId)) throw new UnknownAssetError(`Unknown asset id: ${assetId}`);
  const current = listGameAssets();
  const wouldBeActiveCount = current.filter((a) => (a.id === assetId ? active : a.active)).length;
  if (!active && wouldBeActiveCount < MIN_ACTIVE_ASSETS) throw new WouldEmptyActiveSetError();
  const existing = current.find((a) => a.id === assetId)!;
  setAssetOverride(assetId, { active, tags: existing.tags, updatedAt: Date.now(), updatedBy: admin.id });
  return listGameAssets();
}

export function setAssetTags(assetId: string, tags: string[], admin: AdminAccount): GameAsset[] {
  if (!ASSET_MIRROR.some((a) => a.id === assetId)) throw new UnknownAssetError(`Unknown asset id: ${assetId}`);
  const existing = listGameAssets().find((a) => a.id === assetId)!;
  setAssetOverride(assetId, { active: existing.active, tags: tags.slice(0, 10).map((t) => t.slice(0, 30)), updatedAt: Date.now(), updatedBy: admin.id });
  return listGameAssets();
}

/** Read by the round generator — see gameKinds/memoryMatch.ts. */
export function activeAssetIds(): Set<string> {
  return new Set(listGameAssets().filter((a) => a.active).map((a) => a.id));
}
