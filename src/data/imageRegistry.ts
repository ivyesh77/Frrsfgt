import type { AssetCategory, AssetMetadata } from '../types';

import cat from '../assets/images/animals/cat.webp';
import dog from '../assets/images/animals/dog.webp';
import fox from '../assets/images/animals/fox.webp';
import rabbit from '../assets/images/animals/rabbit.webp';
import owl from '../assets/images/animals/owl.webp';
import pizza from '../assets/images/food/pizza.webp';
import burger from '../assets/images/food/burger.webp';
import donut from '../assets/images/food/donut.webp';
import cupcake from '../assets/images/food/cupcake.webp';
import apple from '../assets/images/fruits/apple.webp';

/** Accent gradient pairs per category, used for card backdrops behind each icon. */
const CATEGORY_ACCENTS: Record<AssetCategory, [string, string]> = {
  animals: ['#ff9a6c', '#ff6b8b'],
  food: ['#ffb26b', '#ff7a59'],
  fruits: ['#8de89a', '#3fbf7f'],
  vegetables: ['#9be15d', '#4f9a4a'],
  objects: ['#7fd1e8', '#4c8bd6'],
  vehicles: ['#8fb8ff', '#5c6bd8'],
  nature: ['#ffe08a', '#ffb84c'],
  household: ['#c9a6ff', '#8a6bd6'],
  toys: ['#ff9ecf', '#e0629c'],
  sports: ['#7fe0c0', '#33a888'],
  symbols: ['#ffd36b', '#ff9e4a'],
};

interface SeedAsset {
  id: string;
  category: AssetCategory;
  name: string;
  tags: string[];
  src: string;
}

const SEED_ASSETS: SeedAsset[] = [
  { id: 'cat', category: 'animals', name: 'Cat', tags: ['pet', 'whiskers', 'fur'], src: cat },
  { id: 'dog', category: 'animals', name: 'Dog', tags: ['pet', 'puppy', 'fur'], src: dog },
  { id: 'fox', category: 'animals', name: 'Fox', tags: ['wild', 'orange', 'fur'], src: fox },
  { id: 'rabbit', category: 'animals', name: 'Rabbit', tags: ['pet', 'ears', 'fur'], src: rabbit },
  { id: 'owl', category: 'animals', name: 'Owl', tags: ['bird', 'wild', 'feathers'], src: owl },
  { id: 'pizza', category: 'food', name: 'Pizza', tags: ['savory', 'slice'], src: pizza },
  { id: 'burger', category: 'food', name: 'Burger', tags: ['savory', 'sandwich'], src: burger },
  { id: 'donut', category: 'food', name: 'Donut', tags: ['sweet', 'dessert'], src: donut },
  { id: 'cupcake', category: 'food', name: 'Cupcake', tags: ['sweet', 'dessert'], src: cupcake },
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
