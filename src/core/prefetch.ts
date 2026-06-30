// prefetch() — Remotion-compatible. Fetches a media URL up front (the editor warms its
// preview assets this way) into a blob URL, and returns a handle to await or free it.
// rerender's renderer doesn't use this — render assets stream from the dev server — so it's
// purely an editor-side helper.
export interface PrefetchHandle {
  free: () => void;
  waitUntilDone: () => Promise<string>;
}

export function prefetch(src: string, options?: { method?: 'blob-url' | 'base64' }): PrefetchHandle {
  let objectUrl: string | null = null;
  const promise = fetch(src)
    .then((res) => res.blob())
    .then((blob) => {
      if (options?.method === 'base64') {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error(`prefetch(${src}) failed to read as base64`));
          reader.readAsDataURL(blob);
        });
      }
      objectUrl = URL.createObjectURL(blob);
      return objectUrl;
    });
  promise.catch(() => undefined); // a caller that never awaits shouldn't trigger an unhandled rejection
  return {
    free: () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    waitUntilDone: () => promise,
  };
}
