import { useDataFetch } from '../hooks/useDataFetch';

export default function DailyRituals({ context }) {
    const { data: rituals, isLoading, error, refetch } = useDataFetch('rituals', context);

    const handleToggle = async (id, currentStatus) => {
        try {
            const token = localStorage.getItem('google_auth_token') || '';
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            await fetch(`/api/rituals/${id}`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({ completed: !currentStatus })
            });
            refetch();
        } catch (err) {
            console.error("Rituals toggle error:", err);
        }
    };

    const handleAdd = async () => {
        const title = prompt("Enter new daily ritual:");
        if (!title || !title.trim()) return;
        try {
            const token = localStorage.getItem('google_auth_token') || '';
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            await fetch(`/api/rituals`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ title: title.trim(), context_mode: context })
            });
            refetch();
        } catch (err) {
            console.error("Failed to add ritual:", err);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("Delete this daily ritual?")) return;
        try {
            const token = localStorage.getItem('google_auth_token') || '';
            const headers = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            await fetch(`/api/rituals/${id}`, {
                method: 'DELETE',
                headers
            });
            refetch();
        } catch (err) {
            console.error("Failed to delete ritual:", err);
        }
    };

    const allCompleted = rituals && rituals.length > 0 && rituals.every(r => r.completed);

    return (
        <div className="rounded-none p-4 flat-panel shrink-0">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold flex items-center text-white/90">
                    <svg className="w-4 h-4 mr-2 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    Daily Rituals
                </h2>
                <button onClick={handleAdd} className="text-white/40 hover:text-pink-400 transition-colors cursor-pointer p-1" title="Add Ritual">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path>
                    </svg>
                </button>
            </div>
            <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1 custom-scrollbar">
                {isLoading && !rituals ? (
                    <div className="text-xs text-white/40 italic flex items-center">
                        <svg className="w-3 h-3 justify-center mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Loading rituals...
                    </div>
                ) : error ? (
                    <div className="text-red-400 text-xs p-2 bg-red-500/10 rounded-none border border-red-500/20">Error: {error}</div>
                ) : !rituals || rituals.length === 0 || allCompleted ? (
                    <div className="flex flex-col items-center justify-center text-white/40 space-y-2 py-4 animate-fade-in">
                        <svg className="w-5 h-5 text-green-400/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <span className="text-[10px] tracking-[0.2em] font-medium uppercase">All clear.</span>
                    </div>
                ) : (
                    rituals.map(ritual => (
                        <div key={ritual.id} className={`group flex items-center justify-between p-2 rounded-none transition-colors hover:bg-white/5 ${ritual.completed ? 'opacity-50' : 'opacity-100'}`}>
                            <label className="flex items-center space-x-3 cursor-pointer flex-1">
                                <input
                                    type="checkbox"
                                    className="form-checkbox ritual-checkbox h-4 w-4 rounded border-gray-600 bg-gray-700 text-pink-500 focus:ring-pink-500/50 cursor-pointer"
                                    checked={ritual.completed}
                                    onChange={() => handleToggle(ritual.id, ritual.completed)}
                                />
                                <span className={`text-sm text-white/90 ${ritual.completed ? 'line-through text-white/50' : ''}`}>{ritual.title}</span>
                            </label>
                            <button
                                onClick={() => handleDelete(ritual.id)}
                                className="ritual-delete-btn opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity p-1"
                                title="Delete Ritual"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                </svg>
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
