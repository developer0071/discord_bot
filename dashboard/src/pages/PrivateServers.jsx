import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function PrivateServers() {
  const {
    privateServers, loadPrivateServers, submitPrivateServer, removePrivateServer,
    showToast, isMod
  } = useApp();

  const [link, setLink] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadPrivateServers().catch(() => {});
  }, [loadPrivateServers]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!link.trim()) {
      showToast('Please enter a server link or code', 'error');
      return;
    }
    
    setIsSubmitting(true);
    try {
      await submitPrivateServer(link.trim());
      setLink('');
    } catch (e) {
      // Toast is handled in context
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (userId) => {
    if (!confirm('Are you sure you want to remove this private server?')) return;
    await removePrivateServer(userId);
  };

  if (!isMod) {
    return (
      <div className="page-content" id="tab-pservers">
        <div className="empty-state">
          <i className="fas fa-lock" />
          <p>Access Denied</p>
          <span>You do not have permission to view private servers.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content" id="tab-pservers">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Private Servers</h1>
          <div className="page-subtitle">Manage VIP / private server links for the regiment</div>
        </div>
      </div>

      <div style={{ background: 'var(--bg-secondary)', padding: 20, borderRadius: 12, marginBottom: 24, border: '1px solid var(--border)' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Add Private Server</h3>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 12 }}>
          <input
            type="text"
            className="form-input"
            style={{ flex: 1 }}
            placeholder="Enter Roblox private server link or code..."
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={isSubmitting}
          />
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-plus" />}
            <span style={{ marginLeft: 8 }}>Add Server</span>
          </button>
        </form>
      </div>

      <div className="queue-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {!privateServers || privateServers.length === 0 ? (
          <div className="empty-state" style={{ gridColumn: '1/-1' }}>
            <i className="fas fa-server" />
            <p>No Private Servers</p>
            <span>Add a private server link above to share it with the regiment</span>
          </div>
        ) : (
          privateServers.map(server => (
            <div className="queue-card" key={server.userId}>
              <div className="queue-card-header">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>{server.tag}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Added {new Date(server.addedAt).toLocaleDateString()}
                  </div>
                </div>
                <button 
                  className="btn btn-danger btn-sm" 
                  onClick={() => handleDelete(server.userId)}
                  title="Remove Server"
                >
                  <i className="fas fa-trash" />
                </button>
              </div>
              <div className="queue-card-body" style={{ wordBreak: 'break-all', fontSize: 13, background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: 6, marginTop: 12 }}>
                {server.link}
              </div>
              <div className="queue-card-actions" style={{ marginTop: 12 }}>
                <a 
                  href={server.link.startsWith('http') ? server.link : `https://${server.link}`} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="btn btn-primary btn-sm" 
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  <i className="fas fa-external-link-alt" /> Join Server
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
