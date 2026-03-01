import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE, getAuthToken } from '../utils/api';

export default function AuthModal({ onAuthSuccess }) {
    const { isAuthModalOpen, setIsAuthModalOpen } = useAuth();
    const [authUrl, setAuthUrl] = useState('#');
    const [authCode, setAuthCode] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        if (isAuthModalOpen) {
            const headers = {};
            const token = getAuthToken();
            if (token) headers['Authorization'] = `Bearer ${token}`;
            fetch(`${API_BASE}/auth/url`, { headers })
                .then(res => res.json())
                .then(data => {
                    if (data.url) {
                        setAuthUrl(data.url);
                        setErrorMsg('');
                    } else {
                        setAuthUrl('#');
                        setErrorMsg(data.error || 'Failed to load Auth URL. Please place your Google Cloud credentials.json in the project root.');
                    }
                })
                .catch(err => {
                    console.error('Auth URL Fetch Error:', err);
                    setErrorMsg('Backend Offline');
                });
        }
    }, [isAuthModalOpen]);

    if (!isAuthModalOpen) return null;

    const handleSubmit = async () => {
        if (!authCode.trim()) return;
        setIsSubmitting(true);
        try {
            const reqHeaders = { 'Content-Type': 'application/json' };
            const tk = getAuthToken();
            if (tk) reqHeaders['Authorization'] = `Bearer ${tk}`;
            const res = await fetch(`${API_BASE}/auth/token`, {
                method: 'POST',
                headers: reqHeaders,
                body: JSON.stringify({ code: authCode.trim() })
            });
            const data = await res.json();
            if (data.success) {
                setIsAuthModalOpen(false);
                if (onAuthSuccess) onAuthSuccess();
                // Optional: we can force a reload to let all hooks re-fetch data
                window.location.reload();
            } else {
                throw new Error(data.error);
            }
        } catch (err) {
            alert('Authentication failed: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
            <div className="flat-panel p-8 rounded-none max-w-md w-full text-center">
                <h2 className="text-xl font-bold mb-4 text-white">Google Authentication Required</h2>
                <p className="text-sm text-white/70 mb-6">Personal-OS needs permission to read your Calendar and Gmail to populate the dashboard.</p>

                {errorMsg ? (
                    <p className="text-xs text-red-400 mb-4 px-4">Error: {errorMsg}</p>
                ) : null}

                <a href={authUrl} target="_blank" rel="noreferrer"
                    className={`inline-block bg-white text-black font-medium px-6 py-3 rounded-full hover:bg-gray-200 transition mb-6 ${authUrl === '#' ? 'pointer-events-none opacity-50' : ''}`}>
                    Authorize with Google
                </a>

                <div className="text-left mt-4 border-t border-white/10 pt-4">
                    <p className="text-xs text-white/50 mb-2">After authorizing, paste the code here:</p>
                    <div className="flex space-x-2">
                        <input
                            type="text"
                            value={authCode}
                            onChange={(e) => setAuthCode(e.target.value)}
                            className="flex-grow bg-white/5 border border-white/10 rounded-none px-3 py-2 text-sm text-white focus:outline-none focus:border-neon-indigo"
                            placeholder="Paste code..."
                        />
                        <button
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            className="bg-neon-indigo/20 text-neon-indigo border border-neon-indigo/30 px-4 py-2 rounded-none text-sm hover:bg-neon-indigo/30 transition disabled:opacity-50">
                            {isSubmitting ? 'Verifying...' : 'Submit'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
