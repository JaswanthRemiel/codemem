import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'remimem';
export const appDescription =
  'Codebase memory for coding agents: a local-first MCP server and CLI that serves only the code context an agent needs.';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';

export const gitConfig = {
  user: 'JaswanthRemiel',
  repo: 'remimem',
  branch: 'main',
};

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
export const npmUrl = 'https://www.npmjs.com/package/remimem';
/** The docs live in this folder of the repository, for the "edit on GitHub" links. */
export const contentPath = 'web-app/content/docs';

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
