import { useState } from 'react';
import { Zap, Loader2, ShieldCheck, LogIn } from 'lucide-react';
import { API_BASE, setToken, type AuthUser } from './auth';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';

type Props = {
  onLogin: (user: AuthUser) => void;
};

const DEMO_ACCOUNTS = [
  { label: 'Dispatcher', email: 'dispatcher@goldenhour.dev', password: 'Dispatch#2026' },
  { label: 'Admin', email: 'admin@goldenhour.dev', password: 'GoldenHour#2026' },
  { label: 'Hospital', email: 'hospital@goldenhour.dev', password: 'Hospital#2026' },
];

export default function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState('dispatcher@goldenhour.dev');
  const [password, setPassword] = useState('Dispatch#2026');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Sign in failed');
        return;
      }
      setToken(data.data.token);
      onLogin(data.data.user);
    } catch {
      setError('Cannot reach the dispatch network. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0B0F1A] text-gray-100 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-[0_0_30px_rgba(37,99,235,0.45)]">
            <Zap className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white leading-none">GoldenHour Dispatch</h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-[0.25em] mt-1">Emergency Triage Command</p>
          </div>
        </div>

        <div className="bg-[#0B1224] border border-white/10 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Secure Sign In</h2>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500"
              />
            </div>

            {error && (
              <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-5 rounded-xl"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              <span className="ml-2">{loading ? 'Authenticating…' : 'Sign In'}</span>
            </Button>
          </form>

          <div className="mt-6 border-t border-white/5 pt-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Demo accounts</p>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.label}
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                    setError(null);
                  }}
                  className="text-[11px] font-semibold text-slate-300 bg-white/5 border border-white/10 rounded-lg py-2 hover:bg-blue-500/10 hover:border-blue-500/40 transition-colors"
                >
                  {account.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-3 leading-relaxed">
              Dispatcher can create missions; hospital ops can only update their own capacity; admin can do both.
            </p>
          </div>
        </div>

        <p className="text-center text-[10px] text-slate-600 mt-6 uppercase tracking-[0.2em]">
          Role-based access · JWT sessions
        </p>
      </div>
    </div>
  );
}
