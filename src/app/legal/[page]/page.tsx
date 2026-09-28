import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLicenses } from '@/lib/data/public';
import { publicEnv } from '@/lib/env';

export const revalidate = 3600;

const UPDATED = 'September 28, 2026';
const CONTACT = publicEnv.NEXT_PUBLIC_CONTACT_EMAIL;
const CONTACT_SUFFIX = CONTACT ? <> at <a href={`mailto:${CONTACT}`}>{CONTACT}</a></> : null;
const CONTACT_SENTENCE = CONTACT
  ? <> Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and we&apos;ll reply within 30 days.</>
  : <> Reply to any email from us or use the Report button, and we&apos;ll reply within 30 days.</>;


const PAGES: Record<string, { title: string; description?: string; body: (licenses: Awaited<ReturnType<typeof getLicenses>>) => React.ReactNode }> = {
  licenses: {
    title: 'Licenses explained',
    body: (licenses) => (
      <>
        <p>Every version of every template carries one license, chosen by its creator and saved with that version. When you download, we record which license you accepted, so it can never change under you.</p>
        {licenses.map((l) => (
          <section key={l.code}>
            <h2>{l.name}</h2>
            <p>{l.summary}</p>
            <ul>
              <li>Commercial use (client work, products you sell): <strong>{l.allows_commercial ? 'allowed' : 'not allowed'}</strong></li>
              <li>Credit to the creator: <strong>{l.requires_attribution ? 'required' : 'not required'}</strong></li>
            </ul>
            {l.url && <p><a href={l.url} rel="noopener noreferrer" target="_blank">Read the full license text</a></p>}
          </section>
        ))}
      </>
    ),
  },
  'upload-guidelines': {
    title: 'Upload guidelines',
    body: () => (
      <>
        <p>Share work you made, or have the rights to share. Everything uploaded is checked before anyone can download it.</p>
        <h2>What you can upload</h2>
        <ul>
          <li>Files: .zip (code), .fig, .psd, .ai, .sketch, .xd, .penpot, .pdf, up to 200 MB each and 5 per version.</li>
          <li>Links: Figma, Canva, GitHub, Framer, Webflow and Penpot, plus a live demo URL.</li>
          <li>Images: a cover plus up to 11 gallery images or app screens, each with alt text.</li>
        </ul>
        <h2>What gets rejected</h2>
        <ul>
          <li>Anything flagged by the malware scan.</li>
          <li>Executables and installers inside archives (.exe, .dll, .sh, .msi, .jar, .apk and similar).</li>
          <li>Password-protected archives, archives with unsafe paths or links, and archives that unpack to more than 500 MB.</li>
          <li>Files whose contents don&apos;t match their extension.</li>
          <li>Work you don&apos;t own, or that copies someone else&apos;s template.</li>
        </ul>
        <h2>Review</h2>
        <p>Your first two uploads are reviewed by a moderator, usually within 24 hours. After that, your uploads publish immediately (still scanned).</p>
        <h2>Versions</h2>
        <p>Published versions can&apos;t be edited, so people always get exactly what they downloaded. To change files, publish a new version. You can pull (&quot;yank&quot;) a broken version once a newer one exists.</p>
      </>
    ),
  },
  terms: {
    title: 'Terms of Service',
    description: 'The rules for using Yowkly: accounts, uploads, licenses, yowkbits and voting, and what happens when rules are broken.',
    body: () => (
      <>
        <p><strong>Last updated {UPDATED}.</strong> These terms are an agreement between you and NightPatch, which runs Yowkly. By creating an account or using the site you accept them.</p>
        <h2>Accounts</h2>
        <ul>
          <li>You must be at least 16 years old (or the minimum age for online services where you live, if higher).</li>
          <li>One account per person. Keep your password safe; you are responsible for what happens under your account.</li>
          <li>Give us a working email address. We use it for sign-in, security and account messages only.</li>
        </ul>
        <h2>What you upload</h2>
        <ul>
          <li>Only upload work you made or have the right to share. You keep ownership of everything you upload.</li>
          <li>You give NightPatch a worldwide, non-exclusive, royalty-free permission to store, scan, display and distribute your uploads on Yowkly so the site can work (showing previews, serving downloads under the license you chose). This ends when you delete the upload or your account, except for copies people already downloaded.</li>
          <li>Each version you publish carries the license you picked. Published versions can&apos;t be edited, only replaced by a new version or withdrawn, so people always know what they downloaded.</li>
          <li>Every file is automatically scanned for malware before anyone can download it. Files that fail are deleted.</li>
        </ul>
        <h2>Downloading</h2>
        <p>Templates are made by their creators and provided as is. Follow the license shown before each download; Yowkly records which license you accepted. NightPatch doesn&apos;t own or guarantee third-party templates.</p>
        <h2>Yowkbits and voting</h2>
        <ul>
          <li>Every account gets 100 yowkbits. A vote costs 1 yowkbit, you can vote for a template once, and votes are final.</li>
          <li>Yowkbits have no cash value. They can&apos;t be bought, sold, transferred or exchanged for anything.</li>
          <li>Manipulating votes is not allowed: extra accounts, vote trading or buying, or automated voting. We may remove those votes, reverse rankings and close the accounts involved.</li>
        </ul>
        <h2>Not allowed</h2>
        <ul>
          <li>Malware, phishing, or files that try to harm people&apos;s devices.</li>
          <li>Work that infringes someone else&apos;s copyright, trademark or privacy.</li>
          <li>Spam, harassment, hate, sexual content involving minors, or anything illegal.</li>
          <li>Scraping, overloading or trying to break into the service, or getting around rate limits and security checks.</li>
        </ul>
        <h2>Moderation</h2>
        <p>Moderators can hide or remove content and suspend accounts that break these terms. Every moderation action is logged. If you think we got it wrong, reply to the notice or contact us{CONTACT_SUFFIX}.</p>
        <h2>Ending your account</h2>
        <p>You can delete your account in Settings at any time. It is hidden immediately and permanently deleted after 30 days. People who already downloaded your work keep it under the license they accepted.</p>
        <h2>Liability</h2>
        <p>Yowkly is provided as is, without warranties. To the extent the law allows, NightPatch isn&apos;t liable for indirect or consequential losses, or for templates made by other people. Nothing in these terms limits rights you have under consumer law where you live.</p>
        <h2>Changes</h2>
        <p>If these terms change in a way that matters, we&apos;ll tell you on the site or by email before the change takes effect.</p>
      </>
    ),
  },
  privacy: {
    title: 'Privacy Policy',
    description: 'What personal data Yowkly collects, why, who processes it, how long it is kept, and how to see, change or delete it.',
    body: () => (
      <>
        <p><strong>Last updated {UPDATED}.</strong> Yowkly is run by NightPatch. This policy explains what we collect and why. The short version: we collect what the site needs to work, we don&apos;t sell data, and there are no ads or ad trackers.</p>
        <h2>What we collect</h2>
        <ul>
          <li><strong>Account:</strong> your email, a securely hashed password (or your GitHub/Google sign-in), and the profile you choose to fill in (name, username, bio, location, skills, photos, links).</li>
          <li><strong>What you do:</strong> templates and files you upload, likes, votes and your yowkbit history, follows, comments, collections, reports, and downloads (with the license you accepted).</li>
          <li><strong>Usage:</strong> page views counted per template per day, and cookie-free page-view statistics. IP addresses are used briefly for rate limiting and security and are not stored in our database.</li>
        </ul>
        <h2>Why</h2>
        <ul>
          <li>To run your account and the features you use.</li>
          <li>To keep Yowkly safe: malware scanning, spam and abuse prevention, rate limiting.</li>
          <li>To improve the site using aggregate statistics.</li>
          <li>Account and security emails only. No marketing emails unless you opt in.</li>
        </ul>
        <h2>What&apos;s public</h2>
        <p>Your profile, published templates, comments, public collections and (unless you hide them in Settings) your likes are public. Your email, votes, downloads, yowkbit balance and reports are private.</p>
        <h2 id="cookies">Cookies</h2>
        <p>We use only strictly necessary cookies: the ones that keep you signed in. Our analytics (Vercel Web Analytics) don&apos;t use cookies and don&apos;t track you across sites. Your browser also remembers small preferences, like having dismissed the cookie notice. There&apos;s nothing to opt into; if we ever add optional cookies, we&apos;ll ask first.</p>
        <h2>Who processes data for us</h2>
        <ul>
          <li>Supabase: database, sign-in and profile images.</li>
          <li>Cloudflare R2: uploaded files, template images and backups.</li>
          <li>Vercel: hosting and cookie-free analytics.</li>
          <li>Upstash: rate limiting.</li>
          <li>GitHub: automated jobs (malware scanning, backups).</li>
        </ul>
        <p>These providers may store data outside your country. We only use providers that protect it under contract.</p>
        <h2>How long we keep it</h2>
        <ul>
          <li>Until you delete it or your account. Deleted accounts are hidden immediately and erased after 30 days.</li>
          <li>Backups roll over within 30 days. Moderation and download records needed for safety or legal reasons may be kept longer, with no more data than needed.</li>
        </ul>
        <h2>Your rights</h2>
        <p>You can see and edit your profile in Settings, hide your likes, and delete your account yourself. You can also ask us for a copy of your data, to correct it, or to stop certain processing, and you can complain to your data protection authority.{CONTACT_SENTENCE}</p>
        <h2>Children</h2>
        <p>Yowkly isn&apos;t for anyone under 16. If you believe a child has an account, tell us and we&apos;ll remove it.</p>
      </>
    ),
  },
  dmca: {
    title: 'Copyright & DMCA',
    body: () => (
      <>
        <p>If a template on Yowkly infringes your copyright, use the Report button on the template and choose “Copied from someone else”, or email the designated agent below with:</p>
        <ul>
          <li>The Yowkly URL of the infringing template and a link to your original work.</li>
          <li>Your contact details, and a statement of good-faith belief that the use is not authorised.</li>
          <li>A statement, under penalty of perjury, that the information is accurate and you are the owner or authorised to act.</li>
          <li>Your physical or electronic signature.</li>
        </ul>
        <p>Send notices{CONTACT_SUFFIX}{CONTACT ? '' : ' through the Report button'}. Moderators remove infringing templates and log every action. Repeat infringers lose their accounts.</p>
      </>
    ),
  },
};

export async function generateMetadata(props: PageProps<'/legal/[page]'>): Promise<Metadata> {
  const p = PAGES[(await props.params).page];
  const page = (await props.params).page;
  return p ? { title: p.title, description: p.description ?? `${p.title} on Yowkly.`, alternates: { canonical: `/legal/${page}` } } : {};
}

export function generateStaticParams() {
  return Object.keys(PAGES).map((page) => ({ page }));
}

export default async function LegalPage(props: PageProps<'/legal/[page]'>) {
  const { page } = await props.params;
  const p = PAGES[page];
  if (!p) notFound();
  const licenses = page === 'licenses' ? await getLicenses() : [];
  return (
    <article className="mx-auto max-w-2xl px-4 pt-10 text-[15px] leading-relaxed text-ink-2 [&_a]:text-accent-ink [&_a]:underline [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-normal [&_h2]:text-ink [&_li]:mb-1 [&_p]:my-3 [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="m-0 mb-6 font-display text-5xl font-normal text-ink">{p.title}</h1>
      {p.body(licenses)}
    </article>
  );
}
