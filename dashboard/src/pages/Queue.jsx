import { useApp } from '../context/AppContext';
import { getAvatarColor, getInitials, getTimeAgo } from '../utils/helpers';

export default function Queue() {
  const { queue, acceptFromQueue, rejectFromQueue, acceptAllQueue, rejectAllQueue, isMod } = useApp();

  return (
    <div className="tab-content active" id="tab-queue">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Join Queue</h1>
          <div className="page-subtitle">{isMod ? 'Review and accept incoming join requests' : 'View pending join requests (read-only)'}</div>
        </div>
        {isMod && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-success btn-sm" onClick={acceptAllQueue}><i className="fas fa-check-double" /> Accept All</button>
            <button className="btn btn-danger btn-sm" onClick={rejectAllQueue}><i className="fas fa-xmark" /> Reject All</button>
          </div>
        )}
      </div>

      <div className="queue-grid">
        {queue.length === 0 ? (
          <div className="empty-state" style={{ gridColumn: '1/-1' }}>
            <i className="fas fa-inbox" />
            <p>No pending requests</p>
            <span>The join queue is empty right now</span>
          </div>
        ) : queue.map(q => (
          <div className="queue-card" key={q.id}>
            <div className="queue-card-header">
              <div className="user-avatar" style={{ background: getAvatarColor(q.discord) }}>{getInitials(q.discord)}</div>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>{q.discord}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{q.roblox}</div>
              </div>
              <span className="badge badge-queue" style={{ marginLeft: 'auto' }}>Queued</span>
            </div>
            <div className="queue-card-body">"{q.reason}"</div>
            <div className="queue-card-meta">
              <span><i className="fas fa-clock" /> {getTimeAgo(q.requestedAt)}</span>
              <span><i className="fas fa-at" /> {q.discordId}</span>
            </div>
            {isMod && (
              <div className="queue-card-actions">
                <button className="btn btn-success btn-sm" onClick={() => acceptFromQueue(q.userId)}><i className="fas fa-check" /> Accept</button>
                <button className="btn btn-danger btn-sm" onClick={() => rejectFromQueue(q.userId)}><i className="fas fa-xmark" /> Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
