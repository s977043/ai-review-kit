import React from 'react';
import { Redirect } from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

const normalizeRouteBasePath = (routeBasePath) =>
  routeBasePath === '/' ? '' : `/${routeBasePath.replace(/^\/+|\/+$/g, '')}`;

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  const docsRouteBasePath = siteConfig?.customFields?.docsRouteBasePath ?? 'docs';
  const normalizedRouteBasePath = normalizeRouteBasePath(docsRouteBasePath);
  const target = useBaseUrl(`${normalizedRouteBasePath}/home`);
  return <Redirect to={target} />;
}
