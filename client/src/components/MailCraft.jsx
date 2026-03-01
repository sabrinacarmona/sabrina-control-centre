import { useState, useRef, useEffect } from 'react';
import { useDataFetch } from '../hooks/useDataFetch'; // For re-fetching inbox after send

const TONES = ['professional', 'warm', 'concise', 'friendly', 'formal', 'persuasive', 'apologetic', 'grateful'];

export default function MailCraft({ context, mailcraftData, onClose }) {
    const { refetch: refetchInbox } = useDataFetch('inbox', context); // Don't auto-fetch, just want the refetch function

    const [activeTone, setActiveTone] = useState('professional');
    const [draftText, setDraftText] = useState('');
    const [generatedText, setGeneratedText] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [copyStatus, setCopyStatus] = useState('');
    const [sendStatus, setSendStatus] = useState('');
    const [error, setError] = useState(null);

    const abortControllerRef = useRef(null);
    const outputTextRef = useRef(null);

    // Reset when mailcraftData changes (a new email is selected)
    useEffect(() => {
        if (mailcraftData) {
            setDraftText('');
            setGeneratedText('');
            setCopyStatus('');
            setSendStatus('');
            setError(null);
            setIsGenerating(false);
            setIsSending(false);
        }
    }, [mailcraftData]);

    const handleClose = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        onClose();
    };

    const handleGenerate = async () => {
        if (!draftText.trim()) {
            alert("Please provide some rough thoughts first.");
            return;
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        setGeneratedText('');
        setError(null);
        setIsGenerating(true);

        try {
            const token = localStorage.getItem('google_auth_token') || '';
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const response = await fetch(`/api/mailcraft`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    draftText,
                    tone: activeTone,
                    replyContext: mailcraftData?.subject || ''
                }),
                signal: abortControllerRef.current.signal
            });

            if (!response.ok) throw new Error("Failed to connect to backend stream");

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let accumulatedText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataPayload = line.replace('data: ', '').trim();
                        if (dataPayload === '[DONE]') break;
                        let parsed;
                        try {
                            parsed = JSON.parse(dataPayload);
                        } catch (e) {
                            continue;
                        }

                        if (parsed.error) {
                            throw new Error(parsed.error);
                        }
                        if (parsed.text) {
                            accumulatedText += parsed.text;
                            setGeneratedText(accumulatedText);
                            if (outputTextRef.current) {
                                outputTextRef.current.scrollTop = outputTextRef.current.scrollHeight;
                            }
                        }
                    }
                }
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error("MailCraft error:", err);
                let displayMeta = err.message;
                try {
                    let innerObj = JSON.parse(err.message);
                    if (innerObj.error && innerObj.error.message) {
                        let deepObj = JSON.parse(innerObj.error.message);
                        if (deepObj.error && deepObj.error.message) {
                            displayMeta = deepObj.error.message;
                        }
                    } else if (innerObj.error) {
                        displayMeta = innerObj.error;
                    }
                } catch (e) { /* use raw */ }
                setError(displayMeta);
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopy = async () => {
        if (!generatedText) return;
        await navigator.clipboard.writeText(generatedText);
        setCopyStatus('Copied!');
        setTimeout(() => setCopyStatus(''), 2000);
    };

    const handleSend = async () => {
        if (!mailcraftData?.id || !generatedText) {
            alert("Missing draft content or original email ID.");
            return;
        }

        setIsSending(true);
        setError(null);
        setSendStatus('Sending...');

        try {
            const token = localStorage.getItem('google_auth_token') || '';
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(`/api/mailcraft/send`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    replyToMessageId: mailcraftData.id,
                    payloadText: generatedText
                })
            });

            const data = await res.json();
            if (data.success) {
                setSendStatus('Sent!');
                setTimeout(() => {
                    handleClose();
                    refetchInbox(); // Refresh inbox to show sent status or removal
                }, 1500);
            } else {
                throw new Error(data.error || "Failed to send");
            }
        } catch (err) {
            setError(err.message);
            setSendStatus('');
            setIsSending(false);
        }
    };

    return (
        <div id="mailcraft-panel" className={`absolute inset-0 rounded-none flat-panel flex flex-col transition-opacity duration-300 z-20 overflow-hidden ${mailcraftData ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} style={{ backdropFilter: 'blur(15px)' }}>
            <div className="bg-white/5 p-3 shrink-0 border-b border-white/10 flex justify-between items-center">
                <div className="flex items-center">
                    <h2 className="text-sm font-semibold flex items-center text-white/90">
                        <svg className="w-4 h-4 mr-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                        </svg>
                        <span>MailCraft</span>
                    </h2>
                </div>
                <button onClick={handleClose} className="w-6 h-6 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/60 hover:text-white/90 cursor-pointer">✕</button>
            </div>

            <div className="flex flex-col flex-grow p-4 gap-3 overflow-y-auto w-full custom-scrollbar">
                <div className="flex flex-col gap-1 shrink-0">
                    <div className="text-[10px] text-white/70 uppercase tracking-widest truncate w-full flex items-center">
                        Replying to:
                        <span className="font-bold text-white normal-case ml-2 text-[11px] truncate">{mailcraftData?.subject}</span>
                    </div>
                </div>

                <textarea
                    className="w-full min-h-[80px] custom-scrollbar bg-black/40 rounded-none p-4 text-sm text-white placeholder-white/50 resize-none focus:outline-none focus:ring-1 shadow-inner ring-1 ring-white/10 transition-shadow shrink-0"
                    placeholder="Rough thoughts for your reply..."
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                />

                <div className="flex flex-col gap-3 shrink-0 mb-2">
                    <span className="text-[11px] text-white/50 uppercase tracking-widest font-bold flex justify-between mb-1 items-center">
                        Select Tone
                        <span className="font-bold text-white uppercase">{activeTone}</span>
                    </span>
                    <div className="flex flex-wrap gap-2 w-full">
                        {TONES.map(tone => (
                            <button
                                key={tone}
                                onClick={() => setActiveTone(tone)}
                                className={`capitalize px-3 py-1.5 text-xs font-semibold tracking-wide border transition-all duration-200 focus:outline-none flex-grow-0 cursor-pointer ${activeTone === tone ? 'border-white/90 text-white bg-white/5' : 'border-white/10 text-white/70 bg-black/20 hover:bg-white/10'}`}
                            >
                                {tone}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mt-auto pt-2 shrink-0 flex flex-col gap-2">
                    {!generatedText && !isGenerating && (
                        <button
                            onClick={handleGenerate}
                            disabled={!draftText.trim()}
                            className="w-full min-h-[48px] rounded-none bg-[#333333] hover:bg-[#444444] disabled:opacity-50 transition-all text-sm font-bold flex justify-center items-center text-white border border-white/5 cursor-pointer"
                        >
                            Generate Draft
                            <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                            </svg>
                        </button>
                    )}

                    {(isGenerating || generatedText || error) && (
                        <div className="flex flex-col gap-2">
                            {isGenerating && !generatedText && (
                                <div className="text-center text-sm font-bold animate-pulse py-2 text-white/80">Writing...</div>
                            )}

                            {(generatedText || error) && (
                                <>
                                    <div className="relative">
                                        <div className="absolute top-2 right-2 flex gap-2">
                                            {generatedText && (
                                                <button
                                                    onClick={handleCopy}
                                                    className={`p-1.5 bg-black/50 hover:bg-black/70 rounded text-white/70 hover:text-white transition-colors cursor-pointer text-xs flex items-center ${copyStatus ? 'text-green-400 bg-green-400/10' : ''}`}
                                                    title="Copy output"
                                                >
                                                    {copyStatus ? (
                                                        <>Copied! <svg className="w-3 h-3 text-green-400 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg></>
                                                    ) : (
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                                                    )}
                                                </button>
                                            )}
                                            <button
                                                onClick={handleGenerate}
                                                className="p-1.5 bg-black/50 hover:bg-black/70 rounded text-white/70 hover:text-white transition-colors cursor-pointer"
                                                title="Regenerate"
                                            >
                                                <svg className={`w-4 h-4 ${isGenerating ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                            </button>
                                        </div>
                                        <pre
                                            ref={outputTextRef}
                                            className="bg-black/30 rounded-none p-3 pt-8 pb-3 text-sm text-white/90 whitespace-pre-wrap font-sans min-h-[100px] max-h-[250px] overflow-y-auto custom-scrollbar border border-white/5 ring-1 ring-inset ring-white/10"
                                        >
                                            {error ? (
                                                <span className="text-red-400">
                                                    <span className="font-semibold mb-1 block">API Connection Error</span>
                                                    <span className="text-white/60 text-xs">{error}</span>
                                                </span>
                                            ) : (
                                                generatedText
                                            )}
                                        </pre>
                                    </div>

                                    <button
                                        onClick={handleSend}
                                        disabled={isGenerating || isSending || !!error}
                                        className="w-full mt-2 min-h-[48px] rounded-none bg-neon-indigo/20 hover:bg-neon-indigo/40 disabled:opacity-50 transition-all text-sm font-bold flex justify-center items-center text-neon-indigo border border-neon-indigo/30 cursor-pointer"
                                    >
                                        {sendStatus ? (
                                            <>
                                                {sendStatus}
                                                {sendStatus === 'Sent!' && <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>}
                                                {sendStatus === 'Sending...' && <svg className="w-4 h-4 ml-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"></circle><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" className="opacity-75"></path></svg>}
                                            </>
                                        ) : (
                                            <>
                                                Send
                                                <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
                                            </>
                                        )}
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
