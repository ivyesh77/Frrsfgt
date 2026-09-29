/**
 * Mirrors the id/category list of `src/data/imageRegistry.ts` on the frontend.
 * The server only ever needs ids (for fairness/correctness checks) — the
 * actual image binaries are rendered client-side from that registry, keyed
 * by these same ids. Keep this list in sync whenever assets are added.
 */
export interface AssetRef {
  id: string;
  category: string;
}

export const ASSET_MIRROR: AssetRef[] = [
  { id: 'cat', category: 'animals' },
  { id: 'dog', category: 'animals' },
  { id: 'fox', category: 'animals' },
  { id: 'pizza', category: 'food' },
  { id: 'burger', category: 'food' },
  { id: 'apple', category: 'fruits' },
];
