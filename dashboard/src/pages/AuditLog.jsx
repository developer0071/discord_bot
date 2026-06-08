import { useApp } from '../context/AppContext';
import { ACTION_STYLES } from '../utils/helpers';

export default function AuditLog() {
  const { logs } = useApp();

  return (
    <div className="tab-content active" id="tab-logs">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <div className="page-subtitle">Track all management actions taken on the regiment</div>
        </div>
      </div>

      <div id="logList">
        {logs.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-scroll" />
            <p>No logs yet</p>
            <span>Actions will appear here as you manage members</span>
          </div>
        ) : logs.map((l, i) => {
          const s = ACTION_STYLES[l.action] || { icon: 'fa-circle', color: 'var(--text-muted)', bg: 'rgba(90,106,128,0.15)' };
          const label = l.action.replace(/_/g, ' ');
          const timeStr = l.at.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

          return (
            <div className="feedback-item" style={{ padding: '14px 20px' }} key={i}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 8, background: s.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: s.color, fontSize: 14, flexShrink: 0
                }}>
                  <i className={`fas ${s.icon}`} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    <strong>{l.target}</strong> — <span style={{ color: s.color, fontWeight: 600 }}>{label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{l.detail}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{timeStr}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
