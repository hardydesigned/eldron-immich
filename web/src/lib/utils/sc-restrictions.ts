import { authManager } from '$lib/managers/auth-manager.svelte';
import { Route } from '$lib/route';

export const restrictedRoutes = [
  '/buy',
  '/sharing',
  '/shared-links',
  '/trash',
  '/archive',
  '/locked',
  '/utilities',
  '/user-settings',
  '/workflows',
];

export const isRestricted = () => authManager.authenticated && !authManager.user.isAdmin;

export const isRestrictedPath = (pathname: string) =>
  restrictedRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

export const restrictedRedirect = Route.photos();
