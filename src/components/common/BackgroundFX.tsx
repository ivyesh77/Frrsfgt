import './BackgroundFX.css';

/**
 * Purely decorative, GPU-cheap ambient background: a few large blurred blobs
 * drifting slowly plus a static starfield. Disabled/flattened automatically
 * under prefers-reduced-motion via global.css.
 */
export function BackgroundFX() {
  return (
    <div className="bgfx" aria-hidden="true">
      <div className="bgfx__blob bgfx__blob--a" />
      <div className="bgfx__blob bgfx__blob--b" />
      <div className="bgfx__blob bgfx__blob--c" />
      <div className="bgfx__grid" />
      <div className="bgfx__stars" />
    </div>
  );
}
