import { Link } from 'react-router-dom';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 bg-gray-900/50 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-white">
            AegisTrader
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <Link to="/" className="text-gray-400 hover:text-gray-200 transition-colors">
              Dashboard
            </Link>
            <Link to="/tournaments" className="text-gray-400 hover:text-gray-200 transition-colors">
              Tournaments
            </Link>
            <span className="text-gray-600">Phase 2</span>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
