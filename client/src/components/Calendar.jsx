import { useDataFetch } from '../hooks/useDataFetch';

export default function Calendar({ context }) {
    const { data: events, isLoading, error } = useDataFetch('calendar', context);

    return (
        <div className="flex flex-col flex-grow overflow-hidden">
            <div className="mb-6 shrink-0 pt-6">
                <h2 className="text-lg font-semibold flex items-center text-white/90 mb-1">
                    <svg className="w-5 h-5 mr-2 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                    Events
                </h2>
            </div>
            <div className="flex-grow overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-white/40">
                        <svg className="w-8 h-8 mb-2 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Loading Events...</span>
                    </div>
                ) : error ? (
                    <div className="text-red-400 text-sm p-4 bg-red-500/10 rounded-none border border-red-500/20">Error: {error}</div>
                ) : !events || events.length === 0 ? (
                    <div className="text-sm text-white/50 p-4">No events in the upcoming 30 days.</div>
                ) : (
                    events.map((event, idx) => {
                        const date = new Date(event.start);
                        const isToday = new Date().toDateString() === date.toDateString();
                        const timeStr = event.start.includes('T') ?
                            date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : 'All Day';

                        return (
                            <div
                                key={idx}
                                className={`p-3 rounded-none border ${isToday ? 'bg-blue-500/10 border-blue-500/30' : 'flat-panel border-white/5'} flex justify-between items-start cursor-grab active:cursor-grabbing hover:bg-white/5 transition-colors`}
                                draggable="true"
                                onDragStart={(e) => {
                                    e.currentTarget.style.opacity = '0.5';
                                    e.dataTransfer.setData('text/plain', 'NEW_TASK:' + (event.summary || 'Busy'));
                                }}
                                onDragEnd={(e) => e.currentTarget.style.opacity = '1'}
                            >
                                <div>
                                    <p className="font-medium text-sm text-white/90 leading-tight mb-1">{event.summary || 'Busy'}</p>
                                    <p className={`text-xs ${isToday ? 'text-blue-300' : 'text-white/50'}`}>{timeStr} • {date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
