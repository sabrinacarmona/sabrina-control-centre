import React, { createContext, useContext, useEffect, useState } from 'react';

const WebSocketContext = createContext(null);

export function WebSocketProvider({ children }) {
    const [latestEvent, setLatestEvent] = useState(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        // Automatically determine WS URL based on current host (handling proxy/production)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // The Vite proxy or production server will route /ws to the backend
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('[WebSocket] Connected to backend');
            setIsConnected(true);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('[WebSocket] Event received:', data);
                setLatestEvent(data); // { type, payload }
            } catch (err) {
                console.error('[WebSocket] Invalid message format', event.data);
            }
        };

        ws.onclose = () => {
            console.log('[WebSocket] Disconnected from backend');
            setIsConnected(false);
            // Optionally add reconnect logic here
        };

        return () => {
            ws.close();
        };
    }, []);

    return (
        <WebSocketContext.Provider value={{ latestEvent, isConnected }}>
            {children}
        </WebSocketContext.Provider>
    );
}

export function useWebSocket() {
    return useContext(WebSocketContext);
}
