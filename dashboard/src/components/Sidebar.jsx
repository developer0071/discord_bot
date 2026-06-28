import { NavLink } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { getRegiment, setRegiment } from '../utils/api';

const NAV_ITEMS = [
  { key: 'members',   path: '/members',   icon: 'fa-users',             label: 'Members',       section: 'Management', badgeKey: 'memberCount' },
  { key: 'queue',     path: '/queue',     icon: 'fa-clock-rotate-left',  label: 'Join Queue',    section: 'Management', badgeKey: 'queueCount' },
  { key: 'feedback',  path: '/feedback',  icon: 'fa-message',            label: 'Feedback',      section: 'Management' },
  { key: 'giveaways', path: '/giveaways', icon: 'fa-gift',               label: 'Giveaways',     section: 'Management', badgeKey: 'giveawayCount' },
  { key: 'chat',      path: '/chat',      icon: 'fa-comments',           label: 'Live Chat',     section: 'Management' },
  { key: 'leveling',  path: '/leveling',  icon: 'fa-bolt',               label: 'Leveling',      section: 'Management' },
  { key: 'logs',      path: '/audit',     icon: 'fa-scroll',             label: 'Audit Log',     section: 'System' },
  { key: 'settings',  path: '/settings',  icon: 'fa-gear',               label: 'Settings',      section: 'System' },
];

const READONLY_TABS = new Set(['members', 'queue', 'chat', 'leveling']);

export default function Sidebar({ isOpen, onClose }) {
  const { members, queue, giveaways, isMod } = useApp();
  const regiment = getRegiment();

  const badgeValues = {
    memberCount: members.filter(m => m.status !== 'kicked').length,
    queueCount: queue.length,
    giveawayCount: giveaways.filter(g => g.status === 'active' || g.status === 'scheduled').length,
  };

  let lastSection = '';

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`} id="sidebar">
      <div className="sidebar-brand" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div className="brand-icon" style={{ flexShrink: 0 }}>
            <img src="/logo.png" alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div className="brand-text" style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            <h2 style={{ fontSize: '15px', margin: 0, textOverflow: 'ellipsis', overflow: 'hidden' }}>{regiment === 'sunshine' ? 'Sunshine' : 'Moonlight'} Soldiers</h2>
            <span style={{ fontSize: '12px' }}>Command Center</span>
          </div>
        </div>
        <select 
          value={regiment} 
          onChange={(e) => setRegiment(e.target.value)}
          style={{ width: '100%', padding: '6px 10px', background: '#202225', color: '#fff', border: '1px solid #2f3136', borderRadius: '4px', outline: 'none', cursor: 'pointer', fontSize: '13px' }}
        >
          <option value="moonlight">Moonlight Regiment</option>
          <option value="sunshine">Sunshine Regiment</option>
        </select>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.filter(item => isMod || READONLY_TABS.has(item.key)).map(item => {
          const showSection = item.section !== lastSection;
          if (showSection) lastSection = item.section;
          const badge = item.badgeKey ? badgeValues[item.badgeKey] : null;
          const showBadge = badge != null && (item.badgeKey !== 'giveawayCount' || badge > 0);

          return (
            <div key={item.key}>
              {showSection && (
                <div className="nav-section-title" style={item.section === 'System' ? { marginTop: 12 } : undefined}>
                  {item.section}
                </div>
              )}
              <NavLink
                to={item.path}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                onClick={onClose}
              >
                <i className={`fas ${item.icon}`} />
                {item.label}
                {showBadge && <span className="nav-badge">{badge}</span>}
              </NavLink>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">MS</div>
          <div className="sidebar-user-info">
            <p>Moonlight Soldier</p>
            <span>{isMod ? 'Moderator' : 'Viewer'}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
