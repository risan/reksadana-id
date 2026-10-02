// Runs both at build time and in the browser, so it must not import Node modules.
export const DEFAULT_LOCALE = 'id';
export const LOCALES = ['id', 'en'];

// English uses en-US numbers and spells dates itself (see format.js), because en-GB writes "Sept".
const INTL_LOCALES = { id: 'id-ID', en: 'en-US' };

export const intlLocale = (locale) => INTL_LOCALES[locale] ?? INTL_LOCALES[DEFAULT_LOCALE];

export const isLocale = (value) => LOCALES.includes(value);

export const otherLocale = (locale) => (locale === DEFAULT_LOCALE ? 'en' : DEFAULT_LOCALE);

// The pages of this site. JSON, CSV, and zip files are the same in every language, so their paths stay as they are.
const PAGE_HREF = /^\/(?:[?#].*)?$|^\/(?:funds|api|download|compare)\/[^.?#]*(?:[?#].*)?$/;

export function localizeHref(href, locale) {
  if (locale === DEFAULT_LOCALE || !PAGE_HREF.test(href)) {
    return href;
  }

  return `/${locale}${href}`;
}

// The static paths of a page in every language, for the `[...lang]` route: no prefix for the default language.
export function localePaths(paramsList = [{}]) {
  return LOCALES.flatMap((locale) => paramsList.map((params) => ({ params: { lang: locale === DEFAULT_LOCALE ? undefined : locale, ...params } })));
}

export const anchor = (href, text) => `<a href="${href}">${text}</a>`;

// The path of a page without its language prefix: /en/funds/RD1/ and /funds/RD1/ are the same page.
export function unlocalizedPath(pathname) {
  const stripped = pathname.replace(/^\/en(?=\/|$)/, '');

  return stripped === '' ? '/' : stripped;
}
