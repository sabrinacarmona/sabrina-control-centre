import { useState, useEffect, useRef } from 'react';
import { useDataFetch } from '../hooks/useDataFetch';
import { getAuthToken } from '../utils/api';

export default function QuickNotes({ context, isVisible = true }) {
    const { data: notesData, isLoading, error } = useDataFetch('notes', context);
    const [content, setContent] = useState('');
    const [saveStatus, setSaveStatus] = useState(''); // '' | 'Saving...' | 'Saved'
    const timeoutRef = useRef(null);
    const isInitialLoad = useRef(true);

    // Initialize content when data loads
    useEffect(() => {
        if (notesData && notesData.content !== undefined) {
            setContent(notesData.content);
            isInitialLoad.current = true; // reset to prevent immediate save on load
        }
    }, [notesData]);

    // Handle auto-save
    useEffect(() => {
        if (isInitialLoad.current) {
            isInitialLoad.current = false;
            return;
        }

        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        setSaveStatus('Saving...');
        timeoutRef.current = setTimeout(async () => {
            try {
                const token = getAuthToken() || '';
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                await fetch(`/api/notes?context=${context || ''}`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ content })
                });
                setSaveStatus('Saved');
                setTimeout(() => setSaveStatus(''), 2000); // clear status after 2s
            } catch (err) {
                console.error("Notes save error:", err);
                setSaveStatus('Error');
            }
        }, 1000); // 1s debounce

        return () => clearTimeout(timeoutRef.current);
    }, [content, context]); // Depend on content and context

    return (
        <div id="quick-notes-panel" className={`absolute inset-0 rounded-none p-5 flat-panel flex flex-col transition-opacity duration-300 z-10 ${isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
            <h2 className="text-md font-semibold flex items-center text-white/90 mb-3 shrink-0">
                <svg className="w-4 h-4 mr-2 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path>
                </svg>
                Quick Notes
                {isLoading && (
                    <svg className="w-3 h-3 ml-2 animate-spin text-white/40" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                )}
            </h2>
            <textarea
                className="w-full flex-grow bg-transparent text-sm text-white/80 placeholder-white/30 resize-none focus:outline-none custom-scrollbar"
                placeholder="Jot down thoughts here... (auto-saves)"
                value={content}
                disabled={isLoading && !notesData}
                onChange={(e) => setContent(e.target.value)}
            ></textarea>
            {error && <div className="text-red-400 text-xs mt-1">Failed to load: {error}</div>}
            <div className="text-right mt-1 h-4">
                <span className={`text-xs italic transition-opacity duration-300 ${saveStatus ? 'opacity-100' : 'opacity-0'} ${saveStatus === 'Error' ? 'text-red-400' : 'text-white/40'}`}>
                    {saveStatus}
                </span>
            </div>
        </div>
    );
}
