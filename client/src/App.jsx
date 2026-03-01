import { useState, useEffect } from 'react';
import Header from './components/Header';
import ActionableInbox from './components/ActionableInbox';
import QuickNotes from './components/QuickNotes';
import MailCraft from './components/MailCraft';
import DailyRituals from './components/DailyRituals';
import KanbanBoard from './components/KanbanBoard';
import UpcomingTrips from './components/UpcomingTrips';
import FocusHeatmap from './components/FocusHeatmap';
import Calendar from './components/Calendar';
import ZenOverlay from './components/ZenOverlay';
import { AuthProvider } from './contexts/AuthContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import AuthModal from './components/AuthModal';

function App() {
  const [context, setContext] = useState('both'); // 'both', 'personal', 'professional'
  const [isZenMode, setIsZenMode] = useState(false);
  const [mailcraftData, setMailcraftData] = useState(null); // { id, subject }

  useEffect(() => {
    if (isZenMode) {
      document.body.classList.add('zen-active');
    } else {
      document.body.classList.remove('zen-active');
    }
  }, [isZenMode]);

  useEffect(() => {
    if (context === 'personal') {
      document.body.classList.add('theme-personal');
    } else {
      document.body.classList.remove('theme-personal');
    }
  }, [context]);

  return (
    <AuthProvider>
      <WebSocketProvider>
        <div className="min-h-screen relative flex flex-col items-center py-8 px-4 sm:px-6 lg:px-8 font-sans">


          <AuthModal />

          <ZenOverlay
            isZenMode={isZenMode}
            setIsZenMode={setIsZenMode}
            context={context}
          />

          <Header
            context={context}
            setContext={setContext}
            isZenMode={isZenMode}
            setIsZenMode={setIsZenMode}
          />

          {/* Main Sunsama 3-Column Layout */}
          <div id="main-layout" className={`w-full max-w-[1400px] grid grid-cols-1 lg:grid-cols-12 gap-6 h-auto lg:h-[80vh] transition-all duration-700 ${isZenMode ? 'opacity-0 pointer-events-none scale-95' : 'opacity-100 scale-100'}`}>

            {/* Column 1: Actionable Inbox & dynamic panel */}
            <div className="lg:col-span-3 flex flex-col space-y-6 h-auto lg:h-full transition-all-slow">
              <ActionableInbox context={context} onOpenMailcraft={setMailcraftData} />
              <div id="dynamic-notes-container" className="relative flex-grow shrink-0 flex flex-col mt-4 min-h-[350px]">
                <QuickNotes context={context} isVisible={!mailcraftData} />
                <MailCraft context={context} mailcraftData={mailcraftData} onClose={() => setMailcraftData(null)} />
              </div>
            </div>

            {/* Column 2: Rituals, Tasks & Trips */}
            <div className="lg:col-span-6 flex flex-col space-y-6 h-auto lg:h-[80vh] transition-all-slow">
              <DailyRituals context={context} />
              <KanbanBoard context={context} />
              <UpcomingTrips context={context} />
            </div>

            {/* Column 3: Focus & Pomodoro */}
            <div className="lg:col-span-3 flex flex-col rounded-none p-6 flat-panel h-auto min-h-[500px] lg:h-[80vh] lg:overflow-hidden transition-all-slow">
              <FocusHeatmap context={context} />
              <Calendar context={context} />
            </div>

          </div>

        </div>
      </WebSocketProvider>
    </AuthProvider>
  )
}

export default App;
