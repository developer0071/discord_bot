import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Members from './pages/Members';
import Queue from './pages/Queue';
import Giveaways from './pages/Giveaways';
import PrivateServers from './pages/PrivateServers';
import AuditLog from './pages/AuditLog';
import Chat from './pages/Chat';

import Settings from './pages/Settings';
import Feedback from './pages/Feedback';
import LoginOverlay from './components/LoginOverlay';
import Toast from './components/Toast';
import { useApp } from './context/AppContext';

export default function App() {
  const { loading, authenticated, isMod } = useApp();

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'white', fontFamily: 'Inter' }}>
        <h2>Loading connection...</h2>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <>
        <LoginOverlay />
        <Toast />
      </>
    );
  }

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/members" replace />} />
          <Route path="/members" element={<Members />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/giveaways" element={<Giveaways />} />
          <Route path="/private-servers" element={<PrivateServers />} />
          <Route path="/chat" element={<Chat />} />

          <Route path="/audit" element={<AuditLog />} />
          <Route path="/feedback" element={<Feedback />} />
          <Route path="/settings" element={isMod ? <Settings /> : <Navigate to="/members" replace />} />
          <Route path="*" element={<Navigate to="/members" replace />} />
        </Routes>
      </Layout>
      <Toast />
    </BrowserRouter>
  );
}
