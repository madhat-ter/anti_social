/**
 * Marks text that is (partly) Bangla with lang="bn": screen readers pronounce it as Bangla, and the
 * poster headings give Bangla words room (globals.css, [lang=bn]): their condensed English space is
 * too narrow to separate Bangla words. English titles are left alone.
 */
const BANGLA = /[ঀ-৿]/;
export const bnLang = (text: string | null | undefined): { lang?: 'bn' } => (text && BANGLA.test(text) ? { lang: 'bn' } : {});
