// Blog helpers: published posts (drafts only in dev), tags, reading time, date formatting.
import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/** Published posts, newest first. Lists (index, tags, RSS) take one language so a translated post appears once. */
export async function getPosts(lang?: 'en' | 'zh'): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => (import.meta.env.DEV || !data.draft) && (!lang || data.lang === lang));
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function tagSlug(tag: string): string {
  return tag.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

export function allTags(posts: Post[]): { tag: string; slug: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      const slug = tagSlug(tag);
      const entry = counts.get(slug) ?? { tag, count: 0 };
      entry.count += 1;
      counts.set(slug, entry);
    }
  }
  return [...counts.entries()]
    .map(([slug, v]) => ({ slug, ...v }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Minutes to read, from the raw MDX body without code blocks: ~230 words a minute, or ~400 characters for Chinese. */
export function readingTime(body: string | undefined, lang: 'en' | 'zh' = 'en'): number {
  const text = (body ?? '').replace(/```[\s\S]*?```/g, ' ');
  if (lang === 'zh') return Math.max(1, Math.round((text.match(/\p{Script=Han}/gu) ?? []).length / 400));
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

export function formatDate(date: Date, lang: 'en' | 'zh' = 'en'): string {
  return date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
