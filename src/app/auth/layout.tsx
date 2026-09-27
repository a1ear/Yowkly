export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[440px] flex-col justify-center px-4 py-12">
      {children}
    </div>
  );
}
