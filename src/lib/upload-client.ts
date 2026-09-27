'use client';

/**
 * PUT a file to a pre-signed R2 URL with progress. The URL's signature covers
 * Content-Type and Content-Length, so the type sent here must match what the
 * server signed; the browser sets Content-Length from the file itself.
 */
export function putWithProgress(url: string, file: Blob, contentType: string, onProgress: (sent: number) => void) {
  const xhr = new XMLHttpRequest();
  const done = new Promise<void>((resolve, reject) => {
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
}
