import { useState, useEffect } from 'react';
import { API_BASE, getAuthToken, setAuthToken } from '../utils/api';

export default function LoginGate({ children }) {
    const [isAuthed, setIsAuthed] = useState(false);
    const [isChecking, setIsChecking] = useState(true);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // On mount, check if we have a stored token that's still valid
    useEffect(() => {
        const token = getAuthToken();
        if (!token) {
            setIsChecking(false);
            return;
        }
        // Validate the stored token against the backend
        fetch(`${API_BASE}/tasks?context=both`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
            .then(res => {
                if (res.status === 401) {
                    setIsChecking(false);
                } else {
                    setIsAuthed(true);
                    setIsChecking(false);
                }
            })
            .catch(() => {
                // Backend might not have AUTH_PASSWORD set — allow through
                setIsAuthed(true);
                setIsChecking(false);
            });
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!password.trim()) return;
        setIsSubmitting(true);
        setError('');
        try {
            const res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password.trim() })
            });
            const data = await res.json();
            if (data.success) {
                setAuthToken(password.trim());
                setIsAuthed(true);
            } else {
                setError(data.error || 'Invalid password');
            }
        } catch {
            setError('Cannot reach server');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isChecking) return null;
    if (isAuthed) return children;

    return (
        <div className="min-h-screen flex items-center justify-center px-4"
            style={{ backgroundColor: 'var(--bg-color)' }}>
            <form onSubmit={handleSubmit} className="w-full max-w-xs text-center">
                <h1 className="font-display text-2xl font-semibold tracking-tight mb-1"
                    style={{ color: 'var(--text-primary)' }}>
                    Control Centre
                </h1>
                <p className="text-xs mb-8" style={{ color: 'rgba(248,250,252,0.4)' }}>
                    Enter your access key to continue.
                </p>

                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    placeholder="Password"
                    className="w-full px-4 py-3 text-sm rounded-none border outline-none transition-colors duration-200"
                    style={{
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        borderColor: error ? 'rgba(239,68,68,0.5)' : 'var(--border-color)',
                        color: 'var(--text-primary)',
                    }}
                    onFocus={(e) => {
                        if (!error) e.target.style.borderColor = 'rgba(79,70,229,0.5)';
                    }}
                    onBlur={(e) => {
                        if (!error) e.target.style.borderColor = 'var(--border-color)';
                    }}
                />

                {error && (
                    <p className="text-xs mt-2" style={{ color: 'rgba(239,68,68,0.8)' }}>{error}</p>
                )}

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full mt-4 py-3 text-sm font-medium rounded-none border transition-all duration-200 disabled:opacity-40"
                    style={{
                        backgroundColor: 'rgba(79,70,229,0.1)',
                        borderColor: 'rgba(79,70,229,0.25)',
                        color: '#818cf8',
                    }}
                >
                    {isSubmitting ? 'Verifying...' : 'Enter'}
                </button>
            </form>
        </div>
    );
}
