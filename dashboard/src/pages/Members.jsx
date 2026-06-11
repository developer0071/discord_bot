import { useState, useMemo, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import Modal from '../components/Modal';
import { getAvatarColor, getInitials, formatDate, statusLabel } from '../utils/helpers';
import { exportCSV, exportPNG } from '../utils/export';
import './Members.css';

const PAGE_SIZE = 8;

export default function Members({ searchQuery }) {
  const { members, kickMember, addMember, updateMember, reinstateMember, bulkKick, showToast, isMod } = useApp();

  // ── Local state ──
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name-asc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());

  // Modals
  const [addOpen, setAddOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [kickOpen, setKickOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [viewingMember, setViewingMember] = useState(null);
  const [kickTarget, setKickTarget] = useState(null);
  const [kickReason, setKickReason] = useState('');

  // Form
  const [formDiscord, setFormDiscord] = useState('');
  const [formRoblox, setFormRoblox] = useState('');
  const [formStatus, setFormStatus] = useState('active');
  const [formNotes, setFormNotes] = useState('');

  // ── Filtering, sorting, searching ──
  const filtered = useMemo(() => {
    let list = [...members];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(m =>
        m.discord.toLowerCase().includes(q) ||
        m.roblox.toLowerCase().includes(q) ||
        (m.feedback && m.feedback.toLowerCase().includes(q))
      );
    }
    if (filter !== 'all') list = list.filter(m => m.status === filter);

    const [field, dir] = sort.split('-');
    list.sort((a, b) => {
      let va, vb;
      if (field === 'name') { va = a.discord.toLowerCase(); vb = b.discord.toLowerCase(); }
      else if (field === 'roblox') { va = a.roblox.toLowerCase(); vb = b.roblox.toLowerCase(); }
      else if (field === 'status') { va = a.status; vb = b.status; }
      else if (field === 'date') { va = a.joined.getTime(); vb = b.joined.getTime(); }
      else if (field === 'feedback') { va = (a.feedback || '').toLowerCase(); vb = (b.feedback || '').toLowerCase(); }
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [members, searchQuery, filter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  // ── Counts ──
  const counts = useMemo(() => ({
    all: members.length,
    active: members.filter(m => m.status === 'active').length,
    pending: members.filter(m => m.status === 'pending').length,
    inactive: members.filter(m => m.status === 'inactive').length,
    kicked: members.filter(m => m.status === 'kicked').length,
  }), [members]);

  // ── Selection ──
  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    const ids = pageItems.map(m => m.id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  // ── Sort ──
  const handleSortSelect = (val) => {
    const map = { 'name-asc': 'name-asc', 'name-desc': 'name-desc', 'date-new': 'date-desc', 'date-old': 'date-asc', 'status': 'status-asc' };
    setSort(map[val] || val);
    setPage(1);
  };
  const handleColumnSort = (field) => {
    const f = { name: 'name', roblox: 'roblox', status: 'status', joined: 'date', feedback: 'feedback' }[field] || field;
    setSort(prev => prev.startsWith(f) ? (prev.endsWith('asc') ? f + '-desc' : f + '-asc') : f + '-asc');
    setPage(1);
  };

  // ── Modal handlers ──
  const openAdd = () => {
    setEditingMember(null);
    setFormDiscord(''); setFormRoblox(''); setFormStatus('active'); setFormNotes('');
    setAddOpen(true);
  };
  const openEdit = (m) => {
    setEditingMember(m);
    setFormDiscord(m.discord); setFormRoblox(m.roblox);
    setFormStatus(m.status === 'kicked' ? 'active' : m.status);
    setFormNotes(m.notes || '');
    setAddOpen(true);
  };
  const openView = (m) => { setViewingMember(m); setViewOpen(true); };
  const openKick = (m) => { setKickTarget(m); setKickReason(''); setKickOpen(true); };

  const handleSubmit = async () => {
    if (!formDiscord.trim()) { showToast('Discord name is required', 'error'); return; }
    try {
      if (editingMember) {
        await updateMember({ userId: editingMember.userId, roblox: formRoblox.trim() });
      } else {
        await addMember({ username: formDiscord.trim(), roblox: formRoblox.trim() });
      }
      setAddOpen(false);
    } catch { /* toast already shown */ }
  };

  const handleKick = async () => {
    if (!kickTarget) return;
    await kickMember(kickTarget.userId);
    setKickOpen(false);
  };

  const handleBulkKick = async () => {
    const userIds = members.filter(m => selected.has(m.id) && m.status !== 'kicked').map(m => m.userId);
    if (!userIds.length) { showToast('No kickable members selected', 'warning'); return; }
    await bulkKick(userIds);
    clearSelection();
  };

  // ── Export ──
  const handleExportCSV = () => {
    const count = exportCSV(filtered);
    showToast(`Exported ${count} members to CSV`, 'info');
  };
  const handleExportPNG = () => {
    if (!filtered.length) { showToast('No members to export', 'warning'); return; }
    const count = exportPNG(filtered);
    showToast(`Exported ${count} members as PNG`, 'info');
  };

  // ── Pagination builder ──
  const renderPagination = () => {
    if (totalPages <= 1) return null;
    const btns = [];
    btns.push(
      <button key="prev" className="page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1} style={safePage === 1 ? { opacity: 0.3, pointerEvents: 'none' } : undefined}>
        <i className="fas fa-chevron-left" style={{ fontSize: 10 }} />
      </button>
    );
    for (let i = 1; i <= totalPages; i++) {
      if (totalPages > 7 && Math.abs(i - safePage) > 2 && i !== 1 && i !== totalPages) {
        if (i === safePage - 3 || i === safePage + 3) btns.push(<span key={`e${i}`} style={{ color: 'var(--text-muted)', padding: '0 4px' }}>...</span>);
        continue;
      }
      btns.push(
        <button key={i} className={`page-btn${i === safePage ? ' active' : ''}`} onClick={() => setPage(i)}>{i}</button>
      );
    }
    btns.push(
      <button key="next" className="page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} style={safePage === totalPages ? { opacity: 0.3, pointerEvents: 'none' } : undefined}>
        <i className="fas fa-chevron-right" style={{ fontSize: 10 }} />
      </button>
    );
    return btns;
  };

  return (
    <div className="tab-content active" id="tab-members">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Regiment Members</h1>
          <div className="page-subtitle">{isMod ? 'Manage all members currently in the regiment' : 'View regiment members (read-only)'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleExportCSV}><i className="fas fa-download" /> Export CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportPNG} style={{ color: 'var(--accent)' }}><i className="fas fa-image" /> Export PNG</button>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        {['all', 'active', 'pending', 'inactive', 'kicked'].map(f => (
          <button
            key={f}
            className={`filter-chip${filter === f ? ' active' : ''}`}
            onClick={() => { setFilter(f); setPage(1); }}
          >
            {f === 'all' ? 'All' : f === 'active' ? 'In Regiment' : f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="count">{counts[f]}</span>
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="filter-select" value={sort.replace('date-desc', 'date-new').replace('date-asc', 'date-old').replace('status-asc', 'status')} onChange={e => handleSortSelect(e.target.value)}>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="date-new">Newest First</option>
            <option value="date-old">Oldest First</option>
            <option value="status">By Status</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrapper">
        {/* Bulk bar */}
        {isMod && selected.size > 0 && (
          <div className="bulk-bar visible">
            <span>{selected.size} selected</span>
            <button className="btn btn-danger btn-sm" onClick={handleBulkKick}><i className="fas fa-user-slash" /> Kick Selected</button>
            <button className="btn btn-ghost btn-sm" onClick={clearSelection}>Cancel</button>
          </div>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {isMod && (
                  <th style={{ width: 40, paddingLeft: 16 }}>
                    <div className={`custom-check${pageItems.length && pageItems.every(m => selected.has(m.id)) ? ' checked' : ''}`} onClick={toggleSelectAll} />
                  </th>
                )}
                <th onClick={() => handleColumnSort('name')}>Member <i className="fas fa-sort sort-icon" /></th>
                <th onClick={() => handleColumnSort('roblox')}>Roblox Username <i className="fas fa-sort sort-icon" /></th>
                <th onClick={() => handleColumnSort('status')}>Status <i className="fas fa-sort sort-icon" /></th>
                <th onClick={() => handleColumnSort('joined')}>Joined <i className="fas fa-sort sort-icon" /></th>
                <th onClick={() => handleColumnSort('feedback')}>Feedback <i className="fas fa-sort sort-icon" /></th>
                {isMod && <th style={{ width: 120 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr><td colSpan={isMod ? 7 : 5}>
                  <div className="empty-state"><i className="fas fa-users-slash" /><p>No members found</p><span>Try adjusting your filters or search query</span></div>
                </td></tr>
              ) : pageItems.map(m => (
                <tr key={m.id} className={selected.has(m.id) ? 'row-selected' : ''}>
                  {isMod && (
                    <td style={{ paddingLeft: 16 }}>
                      <div className={`custom-check${selected.has(m.id) ? ' checked' : ''}`} onClick={() => toggleSelect(m.id)} />
                    </td>
                  )}
                  <td>
                    <div className="user-cell">
                      <div className="user-avatar" style={{ background: getAvatarColor(m.discord) }}>{getInitials(m.discord)}</div>
                      <div>
                        <div className="user-name">{m.discord}</div>
                        <div className="user-tag">@{m.discord.toLowerCase()}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{m.roblox}</td>
                  <td><span className={`badge badge-${m.status}`}>{statusLabel(m.status)}</span></td>
                  <td>{formatDate(m.joined)}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.feedback || '-'}>
                    {m.feedback || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  {isMod && (
                    <td>
                      <div className="row-actions">
                        <button className="row-action-btn" title="View Details" onClick={() => openView(m)}><i className="fas fa-eye" /></button>
                        <button className="row-action-btn" title="Edit" onClick={() => openEdit(m)}><i className="fas fa-pen" /></button>
                        {m.status !== 'kicked'
                          ? <button className="row-action-btn danger" title="Kick" onClick={() => openKick(m)}><i className="fas fa-user-slash" /></button>
                          : <button className="row-action-btn" title="Reinstate" onClick={() => reinstateMember(m.userId)}><i className="fas fa-rotate-left" /></button>
                        }
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <span>{filtered.length === 0 ? 'No results' : `Showing ${start + 1}-${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} members`}</span>
          <div className="pagination">{renderPagination()}</div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        id="addModal"
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={editingMember ? 'Edit Member' : 'Add New Member'}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setAddOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}>{editingMember ? 'Save Changes' : 'Add Member'}</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Discord Name</label>
          <input className="form-input" placeholder="e.g. hunterstar" value={formDiscord} onChange={e => setFormDiscord(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Roblox Username</label>
          <input className="form-input" placeholder="e.g. HunterstarRBX" value={formRoblox} onChange={e => setFormRoblox(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-select-input" value={formStatus} onChange={e => setFormStatus(e.target.value)}>
            <option value="active">In Regiment</option>
            <option value="pending">Pending</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Notes / Feedback</label>
          <textarea className="form-textarea" placeholder="Any initial notes..." value={formNotes} onChange={e => setFormNotes(e.target.value)} />
        </div>
      </Modal>

      {/* View Detail Modal */}
      <Modal
        id="viewModal"
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        title="Member Details"
        footer={viewingMember && <>
          <button className="btn btn-ghost" onClick={() => setViewOpen(false)}>Close</button>
          <button className="btn btn-ghost" onClick={() => { setViewOpen(false); openEdit(viewingMember); }}><i className="fas fa-pen" /> Edit</button>
          {viewingMember.status !== 'kicked'
            ? <button className="btn btn-danger" onClick={() => { setViewOpen(false); openKick(viewingMember); }}><i className="fas fa-user-slash" /> Kick</button>
            : <button className="btn btn-success" onClick={() => { setViewOpen(false); reinstateMember(viewingMember.userId); }}><i className="fas fa-rotate-left" /> Reinstate</button>
          }
        </>}
      >
        {viewingMember && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div className="user-avatar" style={{ width: 56, height: 56, fontSize: 20, borderRadius: 12, background: getAvatarColor(viewingMember.discord) }}>{getInitials(viewingMember.discord)}</div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Chakra Petch', sans-serif" }}>{viewingMember.discord}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>@{viewingMember.discord.toLowerCase()}</div>
              </div>
              <span className={`badge badge-${viewingMember.status}`} style={{ marginLeft: 'auto' }}>{statusLabel(viewingMember.status)}</span>
            </div>
            <div className="detail-row"><span className="detail-label">Roblox Username</span><span className="detail-value">{viewingMember.roblox}</span></div>
            <div className="detail-row"><span className="detail-label">Joined Date</span><span className="detail-value">{formatDate(viewingMember.joined)}</span></div>
            <div className="detail-row"><span className="detail-label">Status</span><span className="detail-value" style={{ textTransform: 'capitalize' }}>{viewingMember.status}</span></div>
            <div className="detail-row"><span className="detail-label">Feedback</span><span className="detail-value">{viewingMember.feedback || '—'}</span></div>
            <div className="detail-row"><span className="detail-label">Notes</span><span className="detail-value">{viewingMember.notes || '—'}</span></div>
          </>
        )}
      </Modal>

      {/* Kick Confirm Modal */}
      <Modal
        id="kickModal"
        open={kickOpen}
        onClose={() => setKickOpen(false)}
        title={<><i className="fas fa-user-slash" /> Kick Member</>}
        titleStyle={{ color: 'var(--danger)' }}
        maxWidth="420px"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setKickOpen(false)}>Cancel</button>
          <button className="btn btn-danger" onClick={handleKick}>Kick</button>
        </>}
      >
        <div className="confirm-text">Are you sure you want to kick this member from the regiment?</div>
        {kickTarget && (
          <div className="confirm-user">
            <div className="user-avatar" style={{ background: getAvatarColor(kickTarget.discord), width: 40, height: 40, fontSize: 14 }}>{getInitials(kickTarget.discord)}</div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{kickTarget.discord}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{kickTarget.roblox}</div>
            </div>
          </div>
        )}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Reason (optional)</label>
          <input className="form-input" placeholder="Reason for kicking..." value={kickReason} onChange={e => setKickReason(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}

// Expose openAdd for Header component
Members.openAdd = null;
