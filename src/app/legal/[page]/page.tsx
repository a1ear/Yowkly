import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLicenses } from '@/lib/data/public';

export const revalidate = 3600;

const DRAFT = (
  <p role="note" className="m-0 rounded-md bg-surface-2 p-3 text-[13px] text-warning">
    Draft for launch preparation. This page must be reviewed by a lawyer for your jurisdiction before Yowkly goes live.
  </p>
);

const PAGES: Record<string, { title: string; body: (licenses: Awaited<ReturnType<typeof getLicenses>>) => React.ReactNode }> = {
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
    body: () => (
      <>
        {DRAFT}
        <h2>Outline to be completed</h2>
        <ul>
          <li>Who may use Yowkly (minimum age, one account per person).</li>
          <li>Creator responsibilities: you own or have rights to what you upload, and you grant Yowkly a license to host and display it.</li>
          <li>Downloader responsibilities: follow the license attached to each version.</li>
          <li>Prohibited content and conduct (malware, infringement, spam, vote manipulation).</li>
          <li>Moderation, removal and account termination. Appeals by replying to the removal email.</li>
          <li>Disclaimers and limitation of liability (templates are provided by their creators “as is”).</li>
          <li>Governing law and contact address.</li>
        </ul>
      </>
    ),
  },
  privacy: {
    title: 'Privacy Policy',
    body: () => (
      <>
        {DRAFT}
        <h2>What Yowkly actually stores (from the system design)</h2>
        <ul>
          <li>Account: email, hashed password (or OAuth identity), profile fields you choose to fill in.</li>
          <li>Activity: likes, votes, follows, comments, downloads (with the license accepted), reports.</li>
          <li>Views are counted per template per day. IP addresses are not stored in the database.</li>
          <li>Uploaded files and images, and the results of malware scans on them.</li>
        </ul>
        <h2>Your controls</h2>
        <ul>
          <li>Hide your liked templates from others (Settings).</li>
          <li>Delete your account: hidden immediately, permanently deleted after 30 days.</li>
        </ul>
        <h2>Processors</h2>
        <p>Supabase (database, auth, storage), Vercel (hosting), Upstash (rate limiting), Resend (email), Sentry (error monitoring), Fly.io (file scanning), Cloudflare R2 (backups).</p>
      </>
    ),
  },
  dmca: {
    title: 'Copyright & DMCA',
    body: () => (
      <>
        {DRAFT}
        <p>If a template on Yowkly infringes your copyright, use the Report button on the template and choose “Copied from someone else”, or email the designated agent below with:</p>
        <ul>
          <li>The Yowkly URL of the infringing template and a link to your original work.</li>
          <li>Your contact details, and a statement of good-faith belief that the use is not authorised.</li>
          <li>A statement, under penalty of perjury, that the information is accurate and you are the owner or authorised to act.</li>
          <li>Your physical or electronic signature.</li>
        </ul>
        <p>Designated agent: <strong>[agent name and email, to be registered]</strong>. Moderators remove infringing templates and log every action. Repeat infringers lose their accounts.</p>
      </>
    ),
  },
};

export async function generateMetadata(props: PageProps<'/legal/[page]'>): Promise<Metadata> {
  const p = PAGES[(await props.params).page];
  return p ? { title: p.title } : {};
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
