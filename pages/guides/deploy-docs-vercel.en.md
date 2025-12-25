---
id: deploy-docs-vercel-en
title: Deploy docs to Vercel at /docs
---

When Next.js and Docusaurus share one Vercel project, `/docs/*` can return 404. Put docs in a separate project. Add rewrites so the app project forwards `/docs/*` to the docs project.

## Goals

- Keep the public URL as `https://<app-domain>/docs/...`.
- The docs project builds and serves the Docusaurus site.
- Build/CI should fail on 404 or broken links.

## Docs project (Vercel)

1. Add this repo as a separate Vercel project (e.g., `river-reviewer-docs`).
2. Build Command: `npm run build`; Output Directory: `build`.
3. Add env vars:
   - `DOCS_SITE_URL=https://<docs-domain>` (e.g., `https://river-reviewer-docs.vercel.app`)
   - `DOCS_BASE_URL=/docs/`
   - `DOCS_ROUTE_BASE_PATH=/`
4. Redirect root to `/docs/` (configured in `vercel.json`):

```json
{
  "trailingSlash": true,
  "redirects": [
    { "source": "/", "destination": "/docs/", "permanent": true },
    { "source": "/docs", "destination": "/docs/", "permanent": true }
  ]
}
```

If you omit `DOCS_BASE_URL`, the build targets GitHub Pages at `/river-reviewer/docs/` as before.

## App project (e.g., `<app-domain>` / `river-reviewer.vercel.app`)

Add rewrites in the app `vercel.json` to forward `/docs/*` to the docs domain:

```json
{
  "rewrites": [
    { "source": "/docs", "destination": "https://<docs-domain>/docs/" },
    { "source": "/docs/:path*", "destination": "https://<docs-domain>/docs/:path*" }
  ]
}
```

## Quality gates

- `onBrokenLinks` and `onBrokenMarkdownLinks` are set to `throw`, so broken internal links fail the build.
- `npm run build` (optionally with `DOCS_BASE_URL=/docs/ DOCS_ROUTE_BASE_PATH=/`) verifies local `/docs/` output.
- The link checker workflow blocks PRs when external links break.
