import { useState, useEffect, useRef } from 'react';
import { useDataFetch } from '../hooks/useDataFetch';
import { getAuthToken } from '../utils/api';

export default function ZenOverlay({ isZenMode, setIsZenMode, context }) {
    const { data: tasksData, isLoading, forceRefetch } = useDataFetch('tasks', context);

    // Zen Mode State
    const [zenTask, setZenTask] = useState(null);

    // Timer State
    const [isFlowActive, setIsFlowActive] = useState(false);
    const [flowTimeSeconds, setFlowTimeSeconds] = useState(0);
    const flowAccumulated = useRef(0);
    const flowStartTime = useRef(null);
    const timerRef = useRef(null);

    useEffect(() => {
        if (tasksData && tasksData.tasks) {
            const doingTasks = tasksData.tasks.filter(t => t.status === 'doing');
            if (doingTasks.length > 0) {
                setZenTask(doingTasks[0]);
            } else {
                setZenTask(null);
            }
        }
    }, [tasksData]);

    const getFlowTimeSeconds = () => {
        if (isFlowActive && flowStartTime.current) {
            return Math.floor((flowAccumulated.current + (Date.now() - flowStartTime.current)) / 1000);
        }
        return Math.floor(flowAccumulated.current / 1000);
    };

    const updateFlowDisplay = () => {
        setFlowTimeSeconds(getFlowTimeSeconds());
    };

    const toggleFlowState = () => {
        if (isFlowActive) {
            // Pause
            if (timerRef.current) clearInterval(timerRef.current);
            flowAccumulated.current += (Date.now() - flowStartTime.current);
            setIsFlowActive(false);
            flowComplete(); // Log time on pause
        } else {
            // Start
            setIsFlowActive(true);
            flowStartTime.current = Date.now();
            timerRef.current = setInterval(() => {
                updateFlowDisplay();
            }, 1000);
        }
    };

    const resetFlow = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (isFlowActive) {
            flowComplete();
        }
        setIsFlowActive(false);
        flowAccumulated.current = 0;
        flowStartTime.current = null;
        setFlowTimeSeconds(0);
    };

    const flowComplete = async () => {
        const totalSeconds = getFlowTimeSeconds();
        if (totalSeconds >= 60) {
            const minutesFocused = Math.floor(totalSeconds / 60);
            try {
                const pomHeaders = { 'Content-Type': 'application/json' };
                const pomToken = getAuthToken();
                if (pomToken) pomHeaders['Authorization'] = `Bearer ${pomToken}`;
                await fetch(`/api/pomodoros`, {
                    method: 'POST',
                    headers: pomHeaders,
                    body: JSON.stringify({ duration_minutes: minutesFocused })
                });
            } catch (err) {
                console.error("Failed to log flow session", err);
            }
        }
    };

    const handleMarkComplete = async () => {
        if (!zenTask) return;
        try {
            const taskHeaders = { 'Content-Type': 'application/json' };
            const taskToken = getAuthToken();
            if (taskToken) taskHeaders['Authorization'] = `Bearer ${taskToken}`;
            await fetch(`/api/tasks/${zenTask.id}`, {
                method: 'PATCH',
                headers: taskHeaders,
                body: JSON.stringify({ status: 'done' })
            });
            forceRefetch(); // Refresh tasks
        } catch (err) {
            console.error("Failed to mark task complete", err);
        }
    };

    // formatting time
    const minutes = Math.floor(flowTimeSeconds / 60);
    const seconds = flowTimeSeconds % 60;
    const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Document title update
    useEffect(() => {
        if (isFlowActive) {
            document.title = `[${timeString}] Flow State`;
        } else {
            document.title = "Personal OS v2.0";
        }
    }, [isFlowActive, timeString]);

    return (
        <div id="zen-layout"
            className={`fixed inset-0 z-40 flex-col items-center justify-center transition-opacity duration-700 bg-black/20 backdrop-blur-sm ${isZenMode ? 'opacity-100 flex pointer-events-auto' : 'opacity-0 hidden pointer-events-none'}`}>

            <div className="pointer-events-auto text-center max-w-4xl px-8 py-16 w-full flat-panel rounded-none mx-auto shadow-2xl flex flex-col items-center justify-center relative backdrop-blur-2xl bg-black/40 border-white/10 m-6">

                {/* Close Button top right */}
                <button
                    onClick={() => setIsZenMode(false)}
                    className="absolute top-6 right-6 text-white/40 hover:text-white/80 transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>

                <h2 className="text-sm uppercase tracking-[0.4em] text-white/60 mb-8 flex items-center justify-center">
                    <svg className="w-4 h-4 mr-3 text-neon-indigo" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                    </svg>
                    Focus Flow
                </h2>

                <div id="zen-task-display" className="text-4xl md:text-5xl lg:text-6xl font-semibold text-white/90 leading-tight mb-12 max-w-2xl mx-auto">
                    {zenTask ? zenTask.title : "Breathe. You have no active focus."}
                </div>

                {/* Flow State Timer */}
                <div className="flex flex-col items-center justify-center mb-12 relative w-64 h-64 mx-auto">
                    <div className="breathing-circle" style={{ animationPlayState: isFlowActive ? 'running' : 'paused' }}></div>
                    {/* z-index to stay above the breathing circle */}
                    <div className="relative z-10 flex flex-col items-center justify-center h-full">
                        <div id="flow-display" className="text-5xl md:text-7xl font-light tracking-widest text-white/90 mb-2 font-mono drop-shadow-lg">
                            {isFlowActive || flowTimeSeconds > 0 ? timeString : ""}
                        </div>
                        <div id="zen-flow-text" className={`text-xs tracking-[0.2em] text-white/30 uppercase ${isFlowActive ? 'block' : 'hidden'}`}>
                            Time in Flow
                        </div>
                    </div>
                </div>

                <div className="flex space-x-4 justify-center mb-12">
                    <button id="flow-toggle" onClick={toggleFlowState}
                        className={`px-8 py-3 rounded-full text-lg font-medium transition-colors text-white/90 border-white/10 relative z-10 ${isFlowActive ? 'bg-white/20' : 'flat-panel hover:bg-white/10'}`}>
                        {isFlowActive ? 'Pause Flow' : (flowTimeSeconds > 0 ? 'Resume Flow' : 'Enter Flow')}
                    </button>
                    <button id="flow-reset" onClick={resetFlow}
                        className="px-6 flat-panel py-3 rounded-full text-lg font-medium hover:bg-white/10 transition-colors text-white/60 border-white/10 relative z-10">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15">
                            </path>
                        </svg>
                    </button>
                </div>

                {zenTask && (
                    <button id="zen-complete-btn" onClick={handleMarkComplete}
                        className="flat-panel px-8 py-3 rounded-full font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors border-white/10 mx-auto">
                        <svg className="w-5 h-5 inline-block mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                        Mark Complete
                    </button>
                )}
            </div>
        </div>
    );
}
