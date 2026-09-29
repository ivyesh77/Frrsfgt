/** Broad content categories used to group Memory Match icon assets. */
export type AssetCategory = 'animals' | 'food' | 'fruits';

/** Metadata describing a single playable image asset used by the Memory Match game kind. */
export interface AssetMetadata {
  id: string;
  category: AssetCategory;
  name: string;
  tags: string[];
  /** Accent gradient used for the tile background behind the image. */
  accent: [string, string];
  /** Resolved, bundler-processed image URL. */
  src: string;
}
