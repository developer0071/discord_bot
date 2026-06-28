import { useApp } from '../context/AppContext';
import './Header.css';

export default function Header({ onAddMember, onToggleSidebar }) {
  const { members, queue, loadData, showToast, logout, isMod, searchQuery, setSearchQuery } = useApp();
  const total = members.length;
  const active = members.filter(m => m.status === 'active').length;
  const queued = queue.length;

  return (
    <header className="main-header" id="mainHeader">
      <button className="btn btn-ghost btn-icon mobile-menu-btn" onClick={onToggleSidebar}>
        <i className="fas fa-bars" />
      </button>
      <div className="header-search">
        <i className="fas fa-search" />
        <input
          type="text"
          id="globalSearch"
          placeholder="Search members by name, Roblox, or Discord..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>
      <div className="header-stats">
        <div className="stat-chip">
          <i className="fas fa-users" style={{ color: 'var(--success)' }} />
          <span className="num">{total}</span> Total
        </div>
        <div className="stat-chip">
          <i className="fas fa-circle-check" style={{ color: 'var(--accent)' }} />
          <span className="num">{active}</span> Active
        </div>
        <div className="stat-chip">
          <i className="fas fa-hourglass-half" style={{ color: 'var(--warning)' }} />
          <span className="num">{queued}</span> Queued
        </div>
      </div>
      <div className="header-actions">
        <button
          className="btn btn-ghost btn-icon"
          title="Refresh"
          onClick={() => { loadData().catch(() => {}); showToast('Data refreshed', 'info'); }}
        >
          <i className="fas fa-arrows-rotate" />
        </button>
        {isMod && (
          <button className="btn btn-primary" onClick={() => {
            if (onAddMember) onAddMember();
            else window.dispatchEvent(new CustomEvent('open-add-member'));
          }}>
            <i className="fas fa-plus" /> Add Member
          </button>
        )}
        <button
          className="btn btn-ghost btn-icon"
          title="Log out"
          onClick={logout}
          style={{ marginLeft: 4 }}
        >
          <i className="fas fa-right-from-bracket" />
        </button>
      </div>
    </header>
  );
}
