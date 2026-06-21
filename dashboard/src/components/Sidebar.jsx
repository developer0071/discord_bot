import { NavLink } from 'react-router-dom';
import { useApp } from '../context/AppContext';

const NAV_ITEMS = [
  { key: 'members',   path: '/members',   icon: 'fa-users',             label: 'Members',       section: 'Management', badgeKey: 'memberCount' },
  { key: 'queue',     path: '/queue',     icon: 'fa-clock-rotate-left',  label: 'Join Queue',    section: 'Management', badgeKey: 'queueCount' },
  { key: 'feedback',  path: '/feedback',  icon: 'fa-message',            label: 'Feedback',      section: 'Management' },
  { key: 'giveaways', path: '/giveaways', icon: 'fa-gift',               label: 'Giveaways',     section: 'Management', badgeKey: 'giveawayCount' },
  { key: 'chat',      path: '/chat',      icon: 'fa-comments',           label: 'Live Chat',     section: 'Management' },
  { key: 'logs',      path: '/audit',     icon: 'fa-scroll',             label: 'Audit Log',     section: 'System' },
  { key: 'settings',  path: '/settings',  icon: 'fa-gear',               label: 'Settings',      section: 'System' },
];

const READONLY_TABS = new Set(['members', 'queue', 'chat']);

export default function Sidebar() {
  const { members, queue, giveaways, isMod } = useApp();

  const badgeValues = {
    memberCount: members.filter(m => m.status !== 'kicked').length,
    queueCount: queue.length,
    giveawayCount: giveaways.filter(g => g.status === 'active' || g.status === 'scheduled').length,
  };

  let lastSection = '';

  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">
          <img src="/logo.png" alt="Moonlight Soldiers" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div className="brand-text">
          <h2>Moonlight Soldiers</h2>
          <span>Command Center</span>
        </div>
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
