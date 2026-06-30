export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex flex-1 items-center justify-center px-4">
      <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative z-10 w-full max-w-sm">{children}</div>
    </div>
  );
}
