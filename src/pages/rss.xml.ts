// RSS feed with full post content (MDX rendered through the container API).
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { render } from 'astro:content';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { getContainerRenderer } from '@astrojs/mdx/container-renderer';
import { getPosts } from '../lib/posts';
import { site } from '../lib/site';

export async function GET(context: APIContext) {
  const container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
  const posts = (await getPosts()).filter((p) => !p.data.draft);

  const items = await Promise.all(
    posts.map(async (post) => {
      const { Content } = await render(post);
      return {
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.date,
        link: `/blog/${post.id}/`,
        categories: post.data.tags,
        content: await container.renderToString(Content),
      };
    }),
  );

  return rss({
    title: `${site.name} — Blog`,
    description: site.description,
    site: context.site!,
    items,
  });
}
