import { COMPANY_NAME, CONTACT_EMAIL, LEGAL_UPDATED, PRODUCT_NAME } from "@/lib/legal";
import { PublicPage } from "../public-page";

export const metadata = { title: { absolute: `Privacy policy · ${PRODUCT_NAME}` } };

export default function PrivacyPage() {
  return (
    <PublicPage title="Privacy policy" updated={LEGAL_UPDATED}>
      <p>
        This policy explains what {PRODUCT_NAME}, made by {COMPANY_NAME} (&quot;we&quot;), collects, how we use it, who we share it
        with, and how to have it deleted. {PRODUCT_NAME} is used by a business&apos;s marketing team (&quot;the team&quot;); the team
        decides which of its accounts to connect.
      </p>

      <h2>What we collect</h2>
      <h3>About the people who sign in</h3>
      <p>
        Your name and email address from Google sign-in, the role the team&apos;s admin gave you, and a record of what you did in{" "}
        {PRODUCT_NAME} (for example, approving a post), which the team keeps as its audit log.
      </p>
      <h3>From Google accounts the team connects</h3>
      <ul>
        <li>
          <strong>YouTube</strong> (permission to manage the channel&apos;s YouTube account): the channel&apos;s name, and the
          comments on its videos, with each commenter&apos;s public display name. We use it to show the team viewers&apos; questions
          and to post the replies a team member approved, as the channel. {PRODUCT_NAME} uses YouTube API Services.
        </li>
        <li>
          <strong>Google Ads</strong> (permission to manage the Google Ads account): campaigns, ad groups and ads with their spend,
          clicks and conversions. We use it to report results to the team, to report sign-ups back to Google Ads as conversions,
          and to pause ads or change bids and budgets within limits the team set or after a team member approved the change.
        </li>
        <li>
          <strong>Google Search Console</strong> (read-only): search queries, clicks, impressions and positions for the
          team&apos;s own website. We use it to show the team how its pages perform in search.
        </li>
      </ul>
      <p>
        For each connection we keep a refresh token, which lets {PRODUCT_NAME} keep working after you leave. We don&apos;t keep
        your Google password and never see it.
      </p>
      <h3>From other services the team connects</h3>
      <p>
        Depending on what the team connects: ad results from Meta, posts and their results from the team&apos;s publishing tool,
        leads and payments from the team&apos;s CRM, and analytics from its website and app.
      </p>

      <h2>How we use it</h2>
      <ul>
        <li>Only to provide {PRODUCT_NAME}&apos;s features to the team that connected it.</li>
        <li>
          {PRODUCT_NAME}&apos;s AI agents read this data to draft plans, posts, pages, replies and ad recommendations for the team.
          To do that, the relevant data is sent to our AI provider, Anthropic, which processes it on our behalf and does not use
          it to train its models.
        </li>
        <li>
          We never use Google user data, or any of the team&apos;s data, to train or improve AI or machine-learning models, ours or
          anyone else&apos;s.
        </li>
        <li>We never sell it, and never use it for advertising, ours or anyone else&apos;s.</li>
        <li>People at {COMPANY_NAME} read it only with the team&apos;s permission, to fix a problem, or where the law requires it.</li>
      </ul>
      <p>
        {PRODUCT_NAME}&apos;s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
        including the Limited Use requirements.
      </p>

      <h2>Who we share it with</h2>
      <ul>
        <li>The members of the team that connected it.</li>
        <li>Service providers that run {PRODUCT_NAME} for us: Google Cloud (hosting, in Mumbai, India) and Anthropic (AI processing).</li>
        <li>Anyone the law requires us to share it with.</li>
      </ul>
      <p>
        Google&apos;s own handling of data is described in the{" "}
        <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.
      </p>

      <h2>How we store and protect it</h2>
      <p>
        Data is stored on servers we run in Google Cloud, sent only over encrypted connections, and visible only to the team&apos;s
        signed-in members. Refresh tokens and other credentials are kept apart from the rest of the data, readable only by{" "}
        {PRODUCT_NAME}&apos;s own server process, and never shown again after they are saved. Sign-in sessions use secure cookies;{" "}
        {PRODUCT_NAME} uses no advertising or tracking cookies.
      </p>

      <h2>How long we keep it, and deleting it</h2>
      <ul>
        <li>
          Disconnecting a Google account in {PRODUCT_NAME} revokes our access at Google and deletes its token straight away. You can
          also remove {PRODUCT_NAME}&apos;s access yourself at any time from your Google Account&apos;s{" "}
          <a href="https://myaccount.google.com/connections">third-party connections</a> page (also at{" "}
          <a href="https://security.google.com/settings/security/permissions">security.google.com</a>).
        </li>
        <li>Data synced from a connection stays while the team uses {PRODUCT_NAME}, so its reports keep their history.</li>
        <li>
          When the team stops using {PRODUCT_NAME}, or on request, we delete the team&apos;s data within 30 days.
        </li>
      </ul>
      <p>
        To ask for a copy or deletion of your data, write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Changes</h2>
      <p>We&apos;ll update the date at the top of this page when the policy changes, and tell the team&apos;s admins of significant changes.</p>

      <h2>Contact</h2>
      <p>
        {COMPANY_NAME}, <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </PublicPage>
  );
}
