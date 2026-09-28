import type { Award, Tool } from './types';
import { formatMonth, formatShortDate } from './format';
import { publicEnv } from './env';

export const TOOL_LABEL: Record<Tool, string> = {
  code: 'ZIP', figma: 'Figma', psd: 'Photoshop', canva: 'Canva', sketch: 'Sketch', xd: 'XD',
  ai: 'Illustrator', penpot: 'Penpot', pdf: 'PDF', github: 'GitHub', framer: 'Framer', webflow: 'Webflow',
};

export const LICENSE_SHORT: Record<string, string> = {
  MIT: 'MIT', 'CC-BY-4.0': 'CC BY 4.0', 'CC-BY-NC-4.0': 'CC BY-NC', PERSONAL: 'Personal use',
};

/** Tools deduplicated for display (a Figma file and a Figma link show once). */
export function displayTools(tools: Tool[]) {
  return [...new Set(tools.map((t) => TOOL_LABEL[t] ?? t))];
}

const AWARD_SUBJECT: Record<string, string> = {
  'Mobile Apps': 'Mobile Design', Websites: 'Website', 'UI Kits': 'UI Kit', Components: 'Component',
};

export function awardLabel(a: Award) {
  const subject = a.category ? AWARD_SUBJECT[a.category] ?? a.category : 'Template';
  if (a.period === 'day') return `${subject} of the Day · ${formatShortDate(a.period_start)}`;
  if (a.period === 'week') return `${subject} of the Week · ${formatShortDate(a.period_start)}`;
  return `${subject} of the Month · ${formatMonth(a.period_start)}`;
}

/** Template images live in the public R2 media bucket; avatars (small) stay in Supabase Storage. */
export function mediaUrl(path: string, bucket: 'media' | 'avatars' = 'media') {
  if (bucket === 'media') return `${publicEnv.NEXT_PUBLIC_MEDIA_URL.replace(/\/$/, '')}/${path}`;
  return `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}
