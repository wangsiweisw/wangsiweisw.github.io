// Site sections. Links to sections that aren't built yet are shown in dev only, so production never links to a 404.
export interface NavItem {
  href: string;
  label: string;
  live: boolean;
}

export const nav: NavItem[] = [
  { href: '/resume', label: 'Resume', live: false },
  { href: '/photos', label: 'Photos', live: false },
  { href: '/coffee', label: 'Coffee', live: false },
  { href: '/running', label: 'Running', live: false },
  { href: '/blog', label: 'Blog', live: false },
];

export const visibleNav = nav.filter((item) => item.live || import.meta.env.DEV);

export const isLive = (href: string) => visibleNav.some((item) => item.href === href);
