import type { AssetCategory, AssetMetadata } from '../types';

import cat from '../assets/images/icons/cat.webp';
import dog from '../assets/images/icons/dog.webp';
import fox from '../assets/images/icons/fox.webp';
import pizza from '../assets/images/icons/pizza.webp';
import burger from '../assets/images/icons/burger.webp';
import apple from '../assets/images/icons/apple.webp';

/** Accent gradient pairs per category, used for card backdrops behind each icon. */
const CATEGORY_ACCENTS: Record<AssetCategory, [string, string]> = {
  animals: ['#ff9a6c', '#ff6b8b'],
  food: ['#ffb26b', '#ff7a59'],
  fruits: ['#8de89a', '#3fbf7f'],
};

interface SeedAsset {
  id: string;
  category: AssetCategory;
  name: string;
  tags: string[];
  src: string;
}

/**
 * A small, deliberately curated set of high-detail AI-generated icons (one
 * unified cute-sticker art style, generated from large, explicit prompts —
 * see the image-generation history for the exact prompts) rather than a
 * large lower-effort pool. Memory Match only ever needs 4 distinct assets
 * per round, so 6 is comfortable headroom for variety without diluting quality.
 */
const SEED_ASSETS: SeedAsset[] = [
  { id: 'cat', category: 'animals', name: 'Cat', tags: ['pet', 'whiskers', 'fur'], src: cat },
  { id: 'dog', category: 'animals', name: 'Dog', tags: ['pet', 'puppy', 'fur'], src: dog },
  { id: 'fox', category: 'animals', name: 'Fox', tags: ['wild', 'orange', 'fur'], src: fox },
  { id: 'pizza', category: 'food', name: 'Pizza', tags: ['savory', 'slice'], src: pizza },
  { id: 'burger', category: 'food', name: 'Burger', tags: ['savory', 'sandwich'], src: burger },
  { id: 'apple', category: 'fruits', name: 'Apple', tags: ['sweet', 'fresh'], src: apple },
];

export const IMAGE_REGISTRY: AssetMetadata[] = SEED_ASSETS.map((seed) => ({
  id: seed.id,
  category: seed.category,
  name: seed.name,
  tags: seed.tags,
  accent: CATEGORY_ACCENTS[seed.category],
  src: seed.src,
}));

/** All asset URLs, used to eagerly preload the full deck before gameplay begins. */
export const ALL_ASSET_URLS: string[] = IMAGE_REGISTRY.map((asset) => asset.src);

export function getAssetById(id: string): AssetMetadata | undefined {
  return IMAGE_REGISTRY.find((asset) => asset.id === id);
}
