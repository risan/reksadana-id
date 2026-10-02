import { defineMiddleware } from 'astro:middleware';
import { baseLocale, setLocale } from './paraglide/runtime.js';

// Static pages are rendered one after another, so the locale of the page being rendered can be a global.
export const onRequest = defineMiddleware((context, next) => {
  setLocale(context.currentLocale ?? baseLocale);

  return next();
});
