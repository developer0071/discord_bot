import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { getApiBase } from '../utils/api';
import './Members.css';

export default function Leveling() {
  const { leveling, isMod, showToast, loadData, searchQuery } = useApp();
  const [selectedUser, setSelectedUser] = useState(null);
  const [actionType, setActionType] = useState('add_xp');
  const [actionValue, setActionValue] = useState('');
  const [loading, setLoading] = useState(false);

  // Use the same nightmare curve calculation for progress bar
  function getXpForLevel(level) {
    return 500 * level * (level + 1);
  }

  // Use the members array (which already has xp and level from cache)
  // Filter by search query and sort by level desc, then xp desc
  const filtered = (leveling || [])
    .filter(m => 
      !searchQuery || 
      m.discord.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.roblox && m.roblox.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    .sort((a, b) => {
      const aLevel = a.level || 0;
      const bLevel = b.level || 0;
      const aXp = a.xp || 0;
      const bXp = b.xp || 0;
      if (bLevel !== aLevel) return bLevel - aLevel;
      return bXp - aXp;
    });

  const handleAction = async (e) => {
    e.preventDefault();
    if (!selectedUser || !isMod) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('dash_token');
      const res = await fetch(getApiBase() + '/api/leveling', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: selectedUser.userId,
          action: actionType,
          amount: actionValue || 0
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');

      showToast(`Successfully updated ${selectedUser.discord}'s leveling stats.`, 'success');
      setSelectedUser(null);
      setActionValue('');
      await loadData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="members-page">
      <div className="page-header">
        <div className="header-text">
          <h1>Leveling Management</h1>
          <p>Boost and manage member XP across the regiment.</p>
        </div>
      </div>

      <div className="controls-bar">
        <div className="stats-badges">
          <span className="badge-stat"><i className="fas fa-users"></i> {filtered.length} Members</span>
        </div>
      </div>

      <div className="table-container">
        <table className="members-table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}></th>
              <th>Member</th>
              <th>Current Level</th>
              <th>Total XP</th>
              <th>Progress</th>
              {isMod && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={isMod ? "6" : "5"} style={{ textAlign: 'center', padding: '40px' }}>
                  <div className="empty-state">
                    <i className="fas fa-bolt" style={{ fontSize: '32px', color: '#ff4757', opacity: 0.5, marginBottom: '16px' }}></i>
                    <p>No members found</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((m, index) => {
                const xp = m.xp || 0;
                const level = m.level || 0;
                const currentLevelXp = getXpForLevel(level);
                const nextLevelXp = getXpForLevel(level + 1);
                const progressNeeded = nextLevelXp - currentLevelXp;
                const progressMade = xp - currentLevelXp;
                const progressPercent = Math.min(100, Math.max(0, (progressMade / progressNeeded) * 100));

                return (
                  <tr key={m.userId}>
                    <td className="rank-cell">
                      <span className={`rank-badge ${index < 3 ? `top-${index + 1}` : ''}`}>
                        {index + 1}
                      </span>
                    </td>
                    <td>
                      <div className="member-info">
                        <div className="avatar">{m.discord.charAt(0).toUpperCase()}</div>
                        <div>
                          <div className="discord-name">{m.roblox || m.discord}</div>
                          <div className="roblox-name">@{m.discord}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="status-badge" style={{ background: 'rgba(255, 215, 0, 0.1)', color: '#FFD700', border: '1px solid rgba(255, 215, 0, 0.2)' }}>
                        <i className="fas fa-star" style={{ marginRight: '6px' }}></i>
                        Level {level}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '14px', color: '#a0a0b0' }}>
                        {xp.toLocaleString()} XP
                      </span>
                    </td>
                    <td style={{ minWidth: '200px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#7c666a' }}>
                          <span>{xp.toLocaleString()}</span>
                          <span>{nextLevelXp.toLocaleString()}</span>
                        </div>
                        <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${progressPercent}%`, background: 'linear-gradient(90deg, #ff4757, #ff6b81)', borderRadius: '4px' }}></div>
                        </div>
                      </div>
                    </td>
                    {isMod && (
                      <td>
                        <button 
                          className="btn-icon" 
                          onClick={() => setSelectedUser(m)}
                          title="Manage Leveling"
                          style={{ color: '#ff4757', background: 'rgba(255, 71, 87, 0.1)' }}
                        >
                          <i className="fas fa-bolt"></i>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedUser && (
        <div className="modal-overlay open" onClick={() => setSelectedUser(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Boost {selectedUser.roblox || selectedUser.discord}</h3>
              <button className="modal-close" onClick={() => setSelectedUser(null)}>&times;</button>
            </div>
            <form onSubmit={handleAction} className="modal-form">
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Action Type</label>
                  <select value={actionType} onChange={e => setActionType(e.target.value)} className="form-select-input">
                    <option value="add_xp">Add XP</option>
                    <option value="set_xp">Set Total XP</option>
                    <option value="set_level">Set Level (Nightmare Curve)</option>
                    <option value="reset">Reset to Level 0</option>
                  </select>
                </div>

                {actionType !== 'reset' && (
                  <div className="form-group">
                    <label className="form-label">Amount</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={actionValue}
                      onChange={e => setActionValue(e.target.value)}
                      placeholder={actionType.includes('level') ? "e.g. 50" : "e.g. 1000"}
                      className="form-input"
                    />
                    {actionType === 'add_xp' && <p className="form-hint" style={{fontSize: '12px', marginTop: '6px', color: 'var(--text-muted)'}}>Adds this amount to their current {selectedUser.xp || 0} XP.</p>}
                    {actionType === 'set_level' && <p className="form-hint" style={{fontSize: '12px', marginTop: '6px', color: 'var(--danger)'}}>Warning: This will set their total XP to precisely the amount required for this level.</p>}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setSelectedUser(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'Applying...' : 'Apply Action'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
