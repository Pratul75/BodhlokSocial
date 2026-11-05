import Link from "next/link";
import { COMPANY_NAME, CONTACT_EMAIL, LEGAL_UPDATED, PRODUCT_NAME } from "@/lib/legal";
import { PublicPage } from "../public-page";

export const metadata = { title: { absolute: `Terms of service · ${PRODUCT_NAME}` } };

export default function TermsPage() {
  return (
    <PublicPage title="Terms of service" updated={LEGAL_UPDATED}>
      <p>
        These terms cover the use of {PRODUCT_NAME}, a marketing workspace made by {COMPANY_NAME} (&quot;we&quot;). By signing in or
        connecting an account, you agree to them on behalf of yourself and the team you work for.
      </p>

      <h2>Your team and its accounts</h2>
      <ul>
        <li>The team&apos;s admin decides who can sign in and which accounts are connected. Keep your sign-in to yourself.</li>
        <li>Connect only accounts the team owns or is allowed to manage, such as its own YouTube channel or Google Ads account.</li>
        <li>
          The team owns what it creates and connects. We use it only to run {PRODUCT_NAME} for the team, as the{" "}
          <Link href="/privacy">privacy policy</Link> describes.
        </li>
      </ul>

      <h2>AI drafts and approvals</h2>
      <p>
        {PRODUCT_NAME}&apos;s AI agents draft plans, posts, pages, replies and ad changes. Drafts can be wrong. The team reviews and
        approves what is published or spent, and is responsible for it, including making sure it is accurate and follows the
        rules of each platform it goes to.
      </p>

      <h2>Services from other companies</h2>
      <p>
        {PRODUCT_NAME} works with services the team connects, and their own terms apply to the team&apos;s use of them. In
        particular, {PRODUCT_NAME} uses YouTube API Services: by connecting a YouTube channel you agree to be bound by the{" "}
        <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>, and Google&apos;s handling of data is covered by the{" "}
        <a href="https://policies.google.com/privacy">Google Privacy Policy</a>. Google Ads is covered by Google&apos;s advertising
        terms for the team&apos;s account.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don&apos;t use {PRODUCT_NAME} to send spam, to mislead people, to break a platform&apos;s rules or the law, or to get into
        accounts or data you aren&apos;t allowed to.
      </p>

      <h2>Ending use</h2>
      <p>
        The team can stop using {PRODUCT_NAME} at any time; disconnecting an account revokes our access to it. We may suspend
        access that breaks these terms. When the team leaves, we delete its data as the privacy policy says.
      </p>

      <h2>No warranty, and limits</h2>
      <p>
        {PRODUCT_NAME} is provided as it is. As far as the law allows, we aren&apos;t liable for indirect losses, or for results of
        content or ad changes the team approved.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We&apos;ll update the date at the top when these terms change. Questions:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </PublicPage>
  );
}
