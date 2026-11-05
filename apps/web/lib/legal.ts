/**
 * Names and contact on the public pages (home, privacy policy, terms) that Google's OAuth app
 * verification checks. Keep them identical to the app name and support email on the Google Auth
 * Platform branding page: Google compares them.
 */
export const PRODUCT_NAME = process.env.PRODUCT_NAME ?? "Growth OS";
export const COMPANY_NAME = process.env.COMPANY_NAME ?? "Recharge Studio";
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "kshitij@rechargestudio.com";
/** Last change to the privacy policy or terms. Update it with every change to their text. */
export const LEGAL_UPDATED = "5 November 2026";
