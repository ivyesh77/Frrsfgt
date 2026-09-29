/** Warms the browser image cache/decoder for a list of URLs. Never throws. */
export function preloadImages(urls: string[]): Promise<void> {
  const tasks = urls.map(
    (url) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve();
        img.onerror = () => resolve(); // A failed asset shouldn't block the rest of the game.
        img.src = url;
      }),
  );
  return Promise.all(tasks).then(() => undefined);
}
