/**
 * Demo client portal — re-exports the parent page unchanged.
 * All data is sourced from demo-actions (shimmed via next.config.mjs webpack alias),
 * so no real database is touched.
 */
export { default, generateMetadata } from '@/app/client-portal/[id]/page';
