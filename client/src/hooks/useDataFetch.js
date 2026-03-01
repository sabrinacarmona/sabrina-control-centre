import { useState, useEffect } from 'react';
import { fetchWithAuth } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocket } from '../contexts/WebSocketContext';

export function useDataFetch(endpoint, context = null, intervalMs = null) {
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [trigger, setTrigger] = useState(0); // Add trigger for manual refetch
    const { requireAuth, markAuthenticated } = useAuth();
    const ws = useWebSocket();
    const latestEvent = ws ? ws.latestEvent : null;

    const refetch = () => setTrigger(prev => prev + 1);

    // Watch for websocket events that match our endpoint
    useEffect(() => {
        if (!latestEvent) return;

        const eventMap = {
            'trips': ['TRIP_SYNC_COMPLETE']
        };

        const relevantEvents = eventMap[endpoint];
        if (relevantEvents && relevantEvents.includes(latestEvent.type)) {
            if (latestEvent.payload && latestEvent.payload.context) {
                if (context !== 'both' && latestEvent.payload.context !== 'both' && context !== latestEvent.payload.context) {
                    return; // Ignore updates from another specific context
                }
            }
            console.log(`[useDataFetch] Auto-Refetching ${endpoint} due to ${latestEvent.type}`);
            refetch();
        }
    }, [latestEvent, endpoint, context]);

    useEffect(() => {
        let abortController = new AbortController();

        async function fetchData() {
            setIsLoading(true);
            setError(null);
            try {
                const result = await fetchWithAuth(endpoint, context, abortController.signal);
                setData(result);
                markAuthenticated();
            } catch (err) {
                if (err.requiresAuth) {
                    requireAuth();
                } else if (err.name !== 'AbortError') {
                    setError(err.message);
                }
            } finally {
                setIsLoading(false);
            }
        }

        fetchData();

        let intervalId;
        if (intervalMs) {
            intervalId = setInterval(fetchData, intervalMs);
        }

        return () => {
            abortController.abort();
            if (intervalId) clearInterval(intervalId);
        };
    }, [endpoint, context, intervalMs, markAuthenticated, requireAuth, trigger]);

    return { data, isLoading, error, setData, refetch };
}
