'use client';

/**
 * PUT a file to a pre-signed R2 URL with progress. The URL's signature covers
 * Content-Type and Content-Length, so the type sent here must match what the
 * server signed; the browser sets Content-Length from the file itself.
 */
/** What storage said, in words: shown in the toast, with the technical cause in the console. */
function explain(status: number, body: string) {
  const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1];
  if (status === 0) {
    console.error('[upload] The browser blocked the upload before it reached storage. Usual cause: the R2 bucket CORS policy does not list this site (' + location.origin + ') in AllowedOrigins, or does not allow PUT with the content-type header.');
    return 'Upload blocked before it reached storage. Please try again later.';
  }
  const hint: Record<string, string> = {
    SignatureDoesNotMatch: 'The signed URL does not match: check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in Vercel.',
    NoSuchBucket: 'The bucket named in R2_BUCKET_* does not exist in this R2 account.',
    AccessDenied: 'The R2 API token lacks Object Read & Write on this bucket.',
    ExpiredRequest: 'The upload link expired; start the upload again.',
  };
  console.error(`[upload] Storage answered ${status}${code ? ` ${code}` : ''}.`, (code && hint[code]) || body.slice(0, 300));
  if (status === 403 && code === 'ExpiredRequest') return 'The upload link expired. Please try again.';
  if (status === 403 || status === 401) return 'Storage refused the upload. Please try again later.';
  if (status === 404) return 'Storage is not set up correctly. Please try again later.';
  if (status === 413) return 'That file is too large.';
  return `Upload failed (${status}). Please try again.`;
}

export function putWithProgress(url: string, file: Blob, contentType: string, onProgress: (sent: number) => void) {
  const xhr = new XMLHttpRequest();
  const done = new Promise<void>((resolve, reject) => {
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(explain(xhr.status, xhr.responseText))));
    xhr.onerror = () => reject(new Error(explain(0, '')));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(file);
  });
  return { done, abort: () => xhr.abort() };
}
