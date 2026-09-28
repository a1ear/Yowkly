import type { IconName } from '@/components/icons';

/**
 * Profile links. The database stores only the handle (each column has a CHECK
 * with the same pattern); the URL is always built from the fixed domain here,
 * so a profile can never link somewhere its label doesn't say.
 * People may paste a full URL or an @handle, so parse() accepts both.
 */
export type SocialKey = 'github' | 'linkedin' | 'x_handle' | 'dribbble' | 'behance' | 'instagram' | 'youtube';

type Social = {
  key: SocialKey;
  label: string;
  icon: IconName;
  pattern: RegExp;
  /** Host (and path prefix) a pasted URL may use. */
  from: RegExp;
  url: (handle: string) => string;
  placeholder: string;
};

export const SOCIALS: Social[] = [
  { key: 'github', label: 'GitHub', icon: 'github', pattern: /^[A-Za-z0-9-]{1,39}$/,
    from: /^(?:https?:\/\/)?(?:www\.)?github\.com\//i, url: (h) => `https://github.com/${h}`, placeholder: 'username' },
  { key: 'linkedin', label: 'LinkedIn', icon: 'linkedin', pattern: /^[A-Za-z0-9-]{3,100}$/,
    from: /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\//i, url: (h) => `https://www.linkedin.com/in/${h}`, placeholder: 'linkedin.com/in/…' },
  { key: 'x_handle', label: 'X', icon: 'xLogo', pattern: /^[A-Za-z0-9_]{1,15}$/,
    from: /^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i, url: (h) => `https://x.com/${h}`, placeholder: '@handle' },
  { key: 'dribbble', label: 'Dribbble', icon: 'dribbble', pattern: /^[A-Za-z0-9_-]{2,40}$/,
    from: /^(?:https?:\/\/)?(?:www\.)?dribbble\.com\//i, url: (h) => `https://dribbble.com/${h}`, placeholder: 'username' },
  { key: 'behance', label: 'Behance', icon: 'behance', pattern: /^[A-Za-z0-9_-]{3,40}$/,
    from: /^(?:https?:\/\/)?(?:www\.)?behance\.net\//i, url: (h) => `https://www.behance.net/${h}`, placeholder: 'username' },
  { key: 'instagram', label: 'Instagram', icon: 'instagram', pattern: /^[A-Za-z0-9_.]{1,30}$/,
    from: /^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, url: (h) => `https://www.instagram.com/${h}`, placeholder: '@handle' },
  { key: 'youtube', label: 'YouTube', icon: 'youtube', pattern: /^[A-Za-z0-9_.-]{3,30}$/,
    from: /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/@?/i, url: (h) => `https://www.youtube.com/@${h}`, placeholder: '@channel' },
];

/** '' → null (cleared). A bad value → undefined (invalid). Otherwise the bare handle. */
export function parseHandle(s: Social, raw: string): string | null | undefined {
  let v = raw.trim();
  if (!v) return null;
  if (s.from.test(v)) v = v.replace(s.from, '');
  else if (/^https?:\/\//i.test(v) || /\.[a-z]{2,}\//i.test(v)) return undefined; // a URL on some other site
  v = v.replace(/^@/, '').split(/[/?#]/)[0];
  return s.pattern.test(v) ? v : undefined;
}
