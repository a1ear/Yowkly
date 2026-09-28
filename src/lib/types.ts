export type TemplateStatus = 'draft' | 'pending_review' | 'published' | 'unlisted' | 'removed';
export type ScanStatus = 'pending' | 'scanning' | 'clean' | 'infected' | 'rejected';
export type CategoryKind = 'web' | 'mobile' | 'kit' | 'component' | 'other' | 'concept';
export type Tool =
  | 'code' | 'figma' | 'psd' | 'canva' | 'sketch' | 'xd' | 'ai' | 'penpot' | 'pdf'
  | 'github' | 'framer' | 'webflow';
export type LinkKind = 'github' | 'figma' | 'canva' | 'framer' | 'webflow' | 'penpot';

export type Award = { period: 'day' | 'week' | 'month'; period_start: string; category: string | null };

/** Row of the public.template_cards view. */
export type TemplateCard = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  cover_path: string | null;
  status: TemplateStatus;
  published_at: string | null;
  created_at: string;
  owner_id: string;
  owner_username: string;
  owner_display_name: string;
  owner_avatar_path: string | null;
  category_id: number | null;
  category_slug: string | null;
  category_name: string | null;
  category_kind: CategoryKind | null;
  parent_category_slug: string | null;
  like_count: number;
  download_count: number;
  save_count: number;
  comment_count: number;
  view_count: number;
  vote_count: number;
  hot_score: number;
  version: string | null;
  license_code: string | null;
  allows_commercial: boolean | null;
  tag_slugs: string[];
  tags: { slug: string; name: string; type: 'stack' | 'tool' | 'style' | 'industry' }[];
  tools: Tool[];
  award: Award | null;
};

export type Creator = {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  bio: string | null;
  location: string | null;
  skills: string[];
  available_for_hire: boolean;
  website: string | null;
  github: string | null;
  x_handle: string | null;
  created_at: string;
  hide_likes: boolean;
  template_count: number;
  downloads: number;
  likes_received: number;
  awards: number;
  followers: number;
  following: number;
  votes_received: number;
  dev_awards: number;
  banner_path: string | null;
  linkedin: string | null;
  dribbble: string | null;
  behance: string | null;
  instagram: string | null;
  youtube: string | null;
};

export type License = {
  code: string;
  name: string;
  url: string | null;
  summary: string;
  allows_commercial: boolean;
  requires_attribution: boolean;
};

export type Category = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  parent_id: number | null;
  kind: CategoryKind;
  sort: number;
};
