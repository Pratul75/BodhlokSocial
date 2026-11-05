import Link from "next/link";
import { COMPANY_NAME, CONTACT_EMAIL, PRODUCT_NAME } from "@/lib/legal";
import { PublicPage } from "../public-page";

export const metadata = { title: { absolute: `${PRODUCT_NAME} by ${COMPANY_NAME}` } };

/** The app's public home page, the one named on the Google OAuth consent screen. */
export default function AboutPage() {
  return (
    <PublicPage title={`${PRODUCT_NAME}: a marketing workspace for small teams`}>
      <p>
        {PRODUCT_NAME} is a marketing workspace made by {COMPANY_NAME}. A business&apos;s marketing team uses it to plan a month of
        content, draft posts and web pages with AI agents, approve everything before it goes out, publish to its own channels, and
        see which channels and ads bring customers.
      </p>
      <p>
        Only people a team&apos;s admin adds can sign in. Nothing an agent drafts is published, and no ad is changed beyond the
        team&apos;s own limits, without a person on the team approving it.
      </p>

      <h2>What it connects to, and why</h2>
      <p>A team&apos;s admin can connect the team&apos;s own Google accounts. Each connection asks only for what that feature needs:</p>
      <ul>
        <li>
          <strong>YouTube</strong>, to read the comments on the team&apos;s own channel, so the team sees viewers&apos; questions in
          one place, and to post the replies a team member approved, as the channel.
        </li>
        <li>
          <strong>Google Ads</strong>, to show what each campaign spent and what it brought in, to report sign-ups back to Google
          Ads as conversions, and to pause ads or change bids and budgets within limits the team sets. Bigger changes wait for a
          person to approve them.
        </li>
        <li>
          <strong>Google Search Console</strong>, read-only, to show which searches bring people to the team&apos;s website and
          how its pages rank.
        </li>
      </ul>
      <p>
        {PRODUCT_NAME} never uses this data for advertising, never sells it, and never uses it to train AI models. How it&apos;s
        handled is in the <Link href="/privacy">privacy policy</Link>. Use of {PRODUCT_NAME} is governed by the{" "}
        <Link href="/terms">terms of service</Link>.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about {PRODUCT_NAME} or your data: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </PublicPage>
  );
}
