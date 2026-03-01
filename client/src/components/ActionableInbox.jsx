import { useDataFetch } from '../hooks/useDataFetch';

export default function ActionableInbox({ context, onOpenMailcraft }) {
    const { data: messages, isLoading, error } = useDataFetch('inbox', context);

    // Mock Office 365 logic for professional context
    if (context === 'professional') {
        return (
            <div className="rounded-none p-5 flat-panel flex-grow overflow-hidden flex flex-col">
                <div className="mb-4">
                    <h2 className="text-md font-semibold flex items-center text-white/90 mb-1">
                        <svg className="w-5 h-5 mr-2 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                        </svg>
                        Actionable Inbox
                    </h2>
                    <p className="text-xs text-white/50 ml-7 leading-tight">Drag unread emails to create follow-up tasks</p>
                </div>
                <div className="h-full flex flex-col items-center justify-center space-y-3 p-4 text-center animate-fade-in">
                    <svg className="w-8 h-8 text-blue-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207"></path>
                    </svg>
                    <div>
                        <p className="text-[11px] font-semibold text-white/70 tracking-wider uppercase mb-1">Office 365</p>
                        <p className="text-xs text-white/50 leading-relaxed max-w-[200px] mx-auto">Connect <span className="text-white/70">sabrina.carmona@supercell.com</span> to sync your work inbox.</p>
                    </div>
                    <button className="mt-2 text-[10px] font-semibold tracking-wider text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 px-4 py-2 rounded-full transition-colors uppercase border border-blue-500/20">Connect Account</button>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-none p-5 flat-panel flex-grow overflow-hidden flex flex-col h-full max-h-[100%]">
            <div className="mb-4 shrink-0">
                <h2 className="text-md font-semibold flex items-center text-white/90 mb-1">
                    <svg className="w-5 h-5 mr-2 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                    </svg>
                    Actionable Inbox
                </h2>
                <p className="text-xs text-white/50 ml-7 leading-tight">Drag unread emails to create follow-up tasks</p>
            </div>

            <div className="flex-grow overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-white/40">
                        <svg className="w-8 h-8 mb-2 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Loading messages...</span>
                    </div>
                ) : error ? (
                    <div className="text-red-400 text-sm p-4 bg-red-500/10 rounded-none border border-red-500/20">Error: {error}</div>
                ) : !messages || messages.length === 0 ? (
                    <div className="h-32 flex flex-col items-center justify-center text-white/40 space-y-3 animate-fade-in">
                        <svg className="w-8 h-8 text-green-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <span className="text-[10px] tracking-[0.2em] font-medium uppercase">All clear.</span>
                    </div>
                ) : (
                    messages.map(msg => (
                        <div
                            key={msg.id}
                            className="inbox-item w-full p-3 bg-white/5 hover:bg-white/10 transition-colors rounded-none border border-white/5 cursor-grab active:cursor-grabbing group relative"
                            draggable="true"
                            data-subject={msg.subject}
                            data-id={msg.id}
                            onDragStart={(e) => {
                                e.currentTarget.classList.add('is-dragging');
                                e.dataTransfer.setData('text/plain', 'NEW_TASK:' + msg.subject);
                            }}
                            onDragEnd={(e) => e.currentTarget.classList.remove('is-dragging')}
                        >
                            <p className="text-xs font-semibold text-white/70 truncate mb-1">{msg.from}</p>
                            <p className="text-sm font-medium text-white/90 truncate pr-8">{msg.subject}</p>

                            {/* Actions overlay replacing regular layout on hover */}
                            <button
                                onClick={() => onOpenMailcraft({ id: msg.id, subject: msg.subject })}
                                className="absolute right-3 top-[50%] -translate-y-[50%] opacity-0 group-hover:opacity-100 bg-white/10 hover:bg-white/20 p-1.5 rounded transition-all">
                                <svg className="w-4 h-4 text-neon-indigo" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path></svg>
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
