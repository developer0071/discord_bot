import { useApp } from '../context/AppContext';
import './Sidebar.css';

const NAV_ITEMS = [
  { key: 'members',   icon: 'fa-users',              label: 'Members',    section: 'Management', badgeKey: 'memberCount' },
  { key: 'queue',     icon: 'fa-clock-rotate-left',   label: 'Join Queue', section: 'Management', badgeKey: 'queueCount' },
  { key: 'feedback',  icon: 'fa-message',             label: 'Feedback',   section: 'Management' },
  { key: 'giveaways', icon: 'fa-gift',                label: 'Giveaways',  section: 'Management', badgeKey: 'giveawayCount' },
  { key: 'logs',      icon: 'fa-scroll',              label: 'Audit Log',  section: 'System' },
  { key: 'settings',  icon: 'fa-gear',                label: 'Settings',   section: 'System' },
];

export default function Sidebar() {
  const { activeTab, setActiveTab, members, queue, giveaways } = useApp();

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
        {NAV_ITEMS.map(item => {
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
              <div
                className={`nav-item${activeTab === item.key ? ' active' : ''}`}
                onClick={() => setActiveTab(item.key)}
              >
                <i className={`fas ${item.icon}`} />
                {item.label}
                {showBadge && <span className="nav-badge">{badge}</span>}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">HS</div>
          <div className="sidebar-user-info">
            <p>Hunterstar</p>
            <span>Owner</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
