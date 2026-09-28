/** Re-mounts on every navigation, so each page gets a short fade-in (see .page-in). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
