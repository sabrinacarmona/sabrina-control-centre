import { useState, useEffect } from 'react';
import { useDataFetch } from '../hooks/useDataFetch';
import { useWebSocket } from '../contexts/WebSocketContext';

export default function UpcomingTrips({ context }) {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const { data: groupedTrips, isLoading, error, refetch } = useDataFetch('trips', context);
    const ws = useWebSocket();
    const latestEvent = ws ? ws.latestEvent : null;
    const isSyncing = latestEvent && latestEvent.type === 'TRIP_SYNC_START' && (!latestEvent.payload.context || latestEvent.payload.context === context || context === 'both' || latestEvent.payload.context === 'both');
    const [expandedTrips, setExpandedTrips] = useState({});

    // Clear syncing state when complete
    useEffect(() => {
        if (latestEvent && (latestEvent.type === 'TRIP_SYNC_COMPLETE' || latestEvent.type === 'TRIP_SYNC_ERROR')) {
            // isSyncing derived state naturally handles this since the type changes
        }
    }, [latestEvent]);

    const toggleTrip = (index) => {
        setExpandedTrips(prev => ({
            ...prev,
            [index]: !prev[index]
        }));
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1]}`;
        }
        return dateStr;
    };

    return (
        <div className="rounded-none p-5 flat-panel flex-1 flex flex-col overflow-hidden min-h-[300px]">
            <div className="flex items-center justify-between mb-4 shrink-0">
                <h2 className="text-md font-semibold flex items-center text-white/90">
                    <svg className="w-5 h-5 mr-2 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    Upcoming Trips
                </h2>
                <button
                    onClick={refetch}
                    disabled={isLoading}
                    className={`p-1.5 text-white/40 hover:text-white/90 hover:bg-white/10 rounded transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title="Force Sync Trips"
                >
                    <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                    </svg>
                </button>
            </div>
            <div className="flex-grow overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {isLoading && !groupedTrips ? (
                    <div className="text-sm text-white/40 italic flex items-center">
                        <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Syncing Calendar data...
                    </div>
                ) : error ? (
                    <div className="text-red-400 text-sm p-4 bg-red-500/10 rounded-none border border-red-500/20">Error: {error}</div>
                ) : !groupedTrips || groupedTrips.length === 0 ? (
                    <div className="text-sm text-white/50 p-4">No upcoming bookings found.</div>
                ) : (
                    groupedTrips.map((group, index) => {
                        const startFormatted = formatDate(group.StartDate);
                        const endFormatted = formatDate(group.EndDate);
                        const dateRange = (group.StartDate && group.EndDate && group.StartDate !== group.EndDate)
                            ? `${startFormatted} - ${endFormatted}`
                            : startFormatted;
                        const isExpanded = expandedTrips[index];

                        return (
                            <div key={index} className="trip-accordion flat-panel bg-white/5 border border-white/10 rounded-none overflow-hidden cursor-pointer hover:bg-white/10 transition-colors">
                                <div className="p-4 flex justify-between items-center select-none" onClick={() => toggleTrip(index)}>
                                    <div>
                                        <p className="text-sm font-bold text-white/90 mb-0.5 flex items-center">
                                            🗺️ {group.TripName}
                                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60 font-medium">{group.Components?.length || 0} items</span>
                                        </p>
                                        <p className="text-xs text-neon-indigo font-medium">{dateRange}</p>
                                    </div>
                                    <svg className={`trip-chevron w-5 h-5 text-white/40 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                                    </svg>
                                </div>

                                {isExpanded && (
                                    <div className="trip-accordion-content border-t border-white/5">
                                        <div className="p-3 pt-1">
                                            {(group.Components || []).map((comp, compIndex) => {
                                                const lowerType = comp.Type ? comp.Type.toLowerCase() : '';
                                                const isHotel = lowerType.includes('hotel');
                                                const isTrain = lowerType.includes('train');
                                                const textClass = isHotel ? 'text-teal-300' : (isTrain ? 'text-indigo-300' : 'text-emerald-300');
                                                const icon = isHotel ? '🏨' : (isTrain ? '🚆' : '✈️');

                                                return (
                                                    <div key={compIndex} className="mt-2 p-2 bg-white/5 rounded flex justify-between items-center group/comp">
                                                        <div>
                                                            <p className={`text-xs font-semibold ${textClass} mb-0.5`}>{icon} {comp.Title || comp.Name || comp.Type}</p>
                                                            <p className="text-[10px] text-white/50 uppercase tracking-widest">{comp.DateTime || comp.Date || 'TBA'}</p>
                                                        </div>
                                                        <div className="text-[10px] text-white/40 font-mono tracking-wider opacity-0 group-hover/comp:opacity-100 transition-opacity">
                                                            Ref: {comp.ConfirmationCode || comp.ConfirmationNumber || 'N/A'}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
