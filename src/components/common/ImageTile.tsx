import { useState } from 'react';
import type { AssetMetadata } from '../../types';
import './ImageTile.css';

interface ImageTileProps {
  asset: AssetMetadata;
  className?: string;
  priority?: boolean;
}

/**
 * Renders a single game asset with a graceful loading skeleton and a
 * guaranteed non-broken fallback if the image ever fails to decode.
 */
export function ImageTile({ asset, className, priority = false }: ImageTileProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [gradA, gradB] = asset.accent;

  return (
    <div
      className={['image-tile', className].filter(Boolean).join(' ')}
      style={{ ['--tile-a' as string]: gradA, ['--tile-b' as string]: gradB }}
    >
      {status !== 'loaded' && <div className="image-tile__skeleton" aria-hidden="true" />}
      {status === 'error' ? (
        <div className="image-tile__fallback" role="img" aria-label={asset.name}>
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="4" stroke="white" strokeWidth="1.6" opacity="0.85" />
            <circle cx="9" cy="9" r="1.8" fill="white" opacity="0.85" />
            <path d="M4 17l5-5 4 4 3-3 4 4" stroke="white" strokeWidth="1.6" opacity="0.85" fill="none" />
          </svg>
        </div>
      ) : (
        <img
          src={asset.src}
          alt={asset.name}
          className="image-tile__img"
          draggable={false}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          style={{ opacity: status === 'loaded' ? 1 : 0 }}
        />
      )}
    </div>
  );
}
