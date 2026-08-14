export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white/80 p-6 backdrop-blur-sm">
      <div className="text-center">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Access denied</h1>
        <p className="text-slate-500">You don't have permission to view this page.</p>
      </div>
    </div>
  );
}
