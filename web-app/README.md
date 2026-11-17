# remimem website

The landing page and documentation for [remimem](https://github.com/JaswanthRemiel/remimem), built with Next.js and [Fumadocs](https://fumadocs.dev).

This folder is a separate project with its own dependencies. It is not part of the npm package, and the root scripts (lint, tests, build) do not touch it.

```sh
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run typecheck
```

- Pages are MDX files in `content/docs`. Each folder's `meta.json` sets the sidebar order.
- The landing page is `app/(home)/page.tsx`.
- Site name, repository links, and the docs folder used by "edit on GitHub" are in `lib/shared.ts`.
- Set `NEXT_PUBLIC_SITE_URL` to the deployed URL so social preview images get absolute links.

Like the rest of the repository, no tracked file may contain an em dash or an emoji: `npm run check:chars` at the repository root checks this folder too.
