import { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { getAvatarColor, getInitials, formatDate } from '../utils/helpers';

const TAG_CLASSES = {
  event: 'feedback-tag-event',
  channel: 'feedback-tag-channel',
  giveaway: 'feedback-tag-giveaway',
  general: 'feedback-tag-general',
  other: 'feedback-tag-other',
};
const TAG_LABELS = { event: 'Event', channel: 'Channel', giveaway: 'Giveaway', general: 'General', other: 'Other' };

export default function Feedback() {
  const { feedback } = useApp();
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    return filter === 'all' ? feedback : feedback.filter(f => f.category === filter);
  }, [feedback, filter]);

  return (
    <div className="tab-content active" id="tab-feedback">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Member Feedback</h1>
          <div className="page-subtitle">Suggestions and recommendations from regiment members</div>
        </div>
        <select className="filter-select" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All Categories</option>
          <option value="event">Events</option>
          <option value="channel">Channels</option>
          <option value="giveaway">Giveaways</option>
          <option value="general">General</option>
        </select>
      </div>

      <div id="feedbackList">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-comment-slash" />
            <p>No feedback found</p>
            <span>No feedback in this category yet</span>
          </div>
        ) : filtered.map(f => (
          <div className="feedback-item" key={f.id}>
            <div className="feedback-header">
              <div className="user-cell">
                <div className="user-avatar" style={{ width: 30, height: 30, fontSize: 11, borderRadius: 6, background: getAvatarColor(f.author) }}>
                  {getInitials(f.author)}
                </div>
                <div>
                  <span className="user-name" style={{ fontSize: 13 }}>{f.author}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 8 }}>{formatDate(f.date)}</span>
                </div>
              </div>
              <span className={`feedback-tag ${TAG_CLASSES[f.category] || 'feedback-tag-other'}`}>
                <i className="fas fa-tag" style={{ fontSize: 8 }} /> {TAG_LABELS[f.category] || f.category}
              </span>
            </div>
            <div className="feedback-text">{f.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
