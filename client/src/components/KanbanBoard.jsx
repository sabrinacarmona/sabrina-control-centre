import { useState, useRef, useEffect } from 'react';
import { useDataFetch } from '../hooks/useDataFetch';
import { getAuthToken } from '../utils/api';

export default function KanbanBoard({ context }) {
    const { data: tasks, setData, isLoading, error, refetch } = useDataFetch('tasks', context);
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const inputRef = useRef(null);

    // Filter tasks
    const todoTasks = (tasks || []).filter(t => t.status === 'todo');
    const doingTasks = (tasks || []).filter(t => t.status === 'doing');

    // Handle global 'A' shortcut
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key.toLowerCase() === 'a') {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    const saveTasks = async (updatedTasks) => {
        // Optimistic update
        setData(updatedTasks);
        try {
            const token = getAuthToken() || '';
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            await fetch(`/api/tasks?context=${context || ''}`, {
                method: 'POST',
                headers,
                body: JSON.stringify(updatedTasks)
            });
        } catch (err) {
            console.error('Failed to save tasks', err);
            // Optionally revert on failure, or just refetch
            refetch();
        }
    };

    const handleAddTask = (e) => {
        e.preventDefault();
        const title = newTaskTitle.trim();
        if (title) {
            const newTask = { id: Date.now().toString(), title, status: 'todo' };
            saveTasks([...(tasks || []), newTask]);
            setNewTaskTitle('');
        }
    };

    const handleCheckboxChange = (taskId) => {
        const updatedTasks = (tasks || []).map(t =>
            t.id === taskId ? { ...t, status: 'done' } : t
        );
        saveTasks(updatedTasks);
    };

    // --- Drag and Drop Logic ---
    const handleDragStart = (e, taskId) => {
        e.dataTransfer.setData('text/plain', taskId);
        e.currentTarget.style.opacity = '0.4';
    };

    const handleDragEnd = (e) => {
        e.currentTarget.style.opacity = '1';
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.currentTarget.classList.add('border-white/20', 'bg-white/5');
    };

    const handleDragLeave = (e) => {
        e.currentTarget.classList.remove('border-white/20', 'bg-white/5');
    };

    const handleDrop = (e, newStatus) => {
        e.preventDefault();
        e.currentTarget.classList.remove('border-white/20', 'bg-white/5');
        const dragData = e.dataTransfer.getData('text/plain');

        if (!dragData) return;

        // Handle external drop (NEW_TASK:...) from Calendar or Email
        if (dragData.startsWith('NEW_TASK:')) {
            const title = dragData.substring(9);
            const newTask = { id: Date.now().toString(), title, status: newStatus };
            saveTasks([...(tasks || []), newTask]);
            return;
        }

        // Handle internal task move
        const taskExists = (tasks || []).find(t => t.id === dragData);
        if (taskExists && taskExists.status !== newStatus) {
            const updatedTasks = (tasks || []).map(t =>
                t.id === dragData ? { ...t, status: newStatus } : t
            );
            saveTasks(updatedTasks);
        }
    };

    const renderTaskNode = (task) => {
        return (
            <div
                key={task.id}
                className={`task-item p-3 rounded-none border border-white/10 ${task.status === 'doing' ? 'bg-neon-indigo/10 border-neon-indigo/30' : 'bg-white/5'} cursor-grab active:cursor-grabbing hover:bg-white/10 transition-colors`}
                draggable="true"
                onDragStart={(e) => handleDragStart(e, task.id)}
                onDragEnd={handleDragEnd}
            >
                <div className="flex items-start">
                    <input
                        type="checkbox"
                        className="task-checkbox mt-1 mr-3 w-4 h-4 rounded border-gray-600 bg-gray-700 text-neon-indigo focus:ring-neon-indigo/50 cursor-pointer"
                        onChange={() => handleCheckboxChange(task.id)}
                    />
                    <div className="flex-grow">
                        <p className="text-sm text-white/90 leading-snug">{task.title}</p>
                        {task.isScheduling && (
                            <div className="mt-2 text-xs font-medium text-neon-indigo animate-pulse">✨ AI is finding a time...</div>
                        )}
                        {task.scheduledTime && (
                            <div className="mt-2 text-xs font-medium text-blue-300 bg-blue-500/10 inline-block px-2 py-0.5 rounded border border-blue-500/20">
                                📅 {new Date(task.scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })} - {task.scheduledReasoning}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="rounded-none p-6 flat-panel flex-1 flex flex-col overflow-hidden min-h-[300px]">
            <h2 className="text-lg font-semibold flex items-center text-white/90 mb-4 shrink-0">
                <svg className="w-5 h-5 mr-2 text-neon-indigo" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                Tasks
                {isLoading && (
                    <svg className="w-4 h-4 ml-2 animate-spin text-white/40" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                )}
            </h2>
            <form className="mb-4 relative shrink-0" onSubmit={handleAddTask}>
                <input
                    ref={inputRef}
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-none px-4 py-3 pl-12 text-sm text-white focus:outline-none focus:border-neon-indigo transition-colors"
                    placeholder="Type a task and hit Enter..."
                />
                <span className="absolute left-4 top-3.5 text-white/40 font-mono text-xs border border-white/20 rounded px-1">A</span>
                <button type="submit" className="absolute right-3 top-2.5 p-1 text-white/40 hover:text-white/80 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
                    </svg>
                </button>
            </form>

            <div className="flex-grow overflow-y-auto pr-2 min-h-0 space-y-4 kanban-container custom-scrollbar">
                {error && <div className="text-red-400 text-sm p-4 bg-red-500/10 border border-red-500/20">{error}</div>}

                <div
                    className="flex flex-col h-full space-y-4"
                >
                    {/* Focus / Doing */}
                    <div className="flex-1 flex flex-col border border-dashed border-transparent transition-all">
                        <h3 className="text-xs uppercase tracking-wider font-semibold text-white/40 mb-2 ml-1 shrink-0">Focus / Doing</h3>
                        <div
                            className="flex-grow space-y-2 p-1 kanban-dropzone min-h-[60px] rounded-none transition-colors duration-200"
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, 'doing')}
                        >
                            {doingTasks.length === 0 ? (
                                <div className="text-sm text-white/30 italic text-center py-4 border border-dashed border-white/10">Drag tasks here</div>
                            ) : (
                                doingTasks.map(renderTaskNode)
                            )}
                        </div>
                    </div>

                    {/* Next Up / Todo */}
                    <div className="flex-1 flex flex-col border border-dashed border-transparent transition-all">
                        <h3 className="text-xs uppercase tracking-wider font-semibold text-white/40 mb-2 ml-1 mt-2 shrink-0">Next Up / Todo</h3>
                        <div
                            className="flex-grow space-y-2 p-1 kanban-dropzone min-h-[60px] rounded-none transition-colors duration-200"
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, 'todo')}
                        >
                            {todoTasks.length === 0 ? (
                                <div className="text-sm text-white/30 italic text-center py-4 border border-dashed border-white/10">Drag tasks here</div>
                            ) : (
                                todoTasks.map(renderTaskNode)
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
