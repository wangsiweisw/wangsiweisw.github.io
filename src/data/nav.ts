import { resume } from '../lib/resume';

// Site sections. Links to sections that aren't built yet are shown in dev only, so production never links to a 404.
export interface NavItem {
  href: string;
  label: string;
  live: boolean;
}

export const nav: NavItem[] = [
  // Resume stays hidden in production until resume.yaml has real content (sample: false).
  { href: '/resume', label: 'Resume', live: !resume.sample },
  { href: '/photos', label: 'Photos', live: false },
  { href: '/coffee', label: 'Coffee', live: false },
  { href: '/running', label: 'Running', live: false },
  // Flip to live once the first post is published (drafts are excluded from production).
  { href: '/blog', label: 'Blog', live: false },
];

export const visibleNav = nav.filter((item) => item.live || import.meta.env.DEV);

export const isLive = (href: string) => visibleNav.some((item) => item.href === href);
