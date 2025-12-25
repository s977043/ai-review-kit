import React from 'react';
import { Redirect } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';

const inferredBaseUrl = ((value) => {
  const withLeading = value.startsWith('/') ? value : `/${value}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
})(
  process.env.DOCS_BASE_URL
    ? process.env.DOCS_BASE_URL
    : process.env.VERCEL
      ? '/docs/'
      : '/river-reviewer/'
);

const docsRouteBasePath =
  process.env.DOCS_ROUTE_BASE_PATH ?? (inferredBaseUrl.endsWith('/docs/') ? '/' : 'docs');
const normalizedRouteBasePath =
  docsRouteBasePath === '/' ? '' : `/${docsRouteBasePath.replace(/^\/+|\/+$/g, '')}`;

export default function Home() {
  const target = useBaseUrl(`${normalizedRouteBasePath}/home`);
  return <Redirect to={target} />;
}
