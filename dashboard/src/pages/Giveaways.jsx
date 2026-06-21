import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import Modal from '../components/Modal';
import { formatCountdown } from '../utils/helpers';

export default function Giveaways() {
  const {
    giveaways, loadGiveaways, loadChannels, channels,
    submitGiveaway, endGiveaway, rerollGiveaway, removeGiveaway,
    showToast, getApiBase, fetchGiveawayDetail,
  } = useApp();

  const [gFilter, setGFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewData, setViewData] = useState(null);
  const [, setTick] = useState(0); // for countdown re-render

  // Form
  const [gwTitle, setGwTitle] = useState('');
  const [gwPrize, setGwPrize] = useState('');
  const [gwStarts, setGwStarts] = useState('');
  const [gwEnds, setGwEnds] = useState('');
  const [gwWinners, setGwWinners] = useState('1');
  const [gwChannel, setGwChannel] = useState('');

  // Countdown ticker
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Load on mount
  useEffect(() => { loadGiveaways().catch(() => {}); }, [loadGiveaways]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = giveaways.filter(g => {
      if (gFilter === 'active') return g.status === 'active' || g.status === 'scheduled';
      return g.status === 'ended' || g.status === 'cancelled';
    });
    if (q) list = list.filter(g => g.title.toLowerCase().includes(q) || (g.hostTag || '').toLowerCase().includes(q));
    return list;
  }, [giveaways, gFilter, search]);

  const openCreate = useCallback(async () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setGwTitle(''); setGwPrize(''); setGwStarts(local); setGwEnds(local); setGwWinners('1');
    setCreateOpen(true);
    try {
      const data = await loadChannels();
      if (data.channels?.length) setGwChannel(data.defaultChannelId || data.channels[0].id);
    } catch { /* ignore */ }
  }, [loadChannels]);

  const handleCreate = async () => {
    if (!gwTitle.trim()) { showToast('Title is required', 'error'); return; }
    if (!gwEnds) { showToast('End time is required', 'error'); return; }
    try {
      await submitGiveaway({ title: gwTitle, prize: gwPrize, startsAt: gwStarts, endsAt: gwEnds, winnerCount: gwWinners, channelId: gwChannel });
      setCreateOpen(false);
    } catch { /* toast already shown */ }
  };

  const handleView = async (id) => {
    try {
      const g = await fetchGiveawayDetail(id);
      setViewData(g);
      setViewOpen(true);
    } catch (e) { showToast('Load failed: ' + e.message, 'error'); }
  };

  const handleEnd = async (id) => {
    if (!confirm('End this giveaway now and pick winners?')) return;
    await endGiveaway(id);
  };

  const handleReroll = async (id) => {
    if (!confirm('Reroll winners for this giveaway?')) return;
    await rerollGiveaway(id);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this giveaway? This cannot be undone.')) return;
    await removeGiveaway(id);
  };

  const apiBase = getApiBase();

  return (
    <div className="page-content" id="tab-giveaways">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Giveaways</h1>
          <div className="page-subtitle">Create and manage server giveaways from the dashboard</div>
        </div>
        <button className="btn btn-primary" onClick={openCreate}><i className="fas fa-plus" /> Create Giveaway</button>
      </div>

      <div className="filters-bar" style={{ marginBottom: 16 }}>
        <button className={`filter-chip${gFilter === 'active' ? ' active' : ''}`} onClick={() => setGFilter('active')}>Active Giveaways</button>
        <button className={`filter-chip${gFilter === 'ended' ? ' active' : ''}`} onClick={() => setGFilter('ended')}>Ended Giveaways</button>
        <div style={{ marginLeft: 'auto' }}>
          <input className="form-input" placeholder="Search giveaways..." style={{ width: 220 }} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="queue-grid">
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ gridColumn: '1/-1' }}>
            <i className="fas fa-gift" />
            <p>No {gFilter} giveaways</p>
            <span>{gFilter === 'active' ? 'Create one to get started' : 'Ended giveaways will appear here'}</span>
          </div>
        ) : filtered.map(g => {
          const remaining = (g.endsAt || 0) - Date.now();
          const isLive = g.status === 'active' || g.status === 'scheduled';
          const timer = isLive ? formatCountdown(remaining) : (g.status === 'ended' ? 'Ended' : 'Cancelled');
          const winnerText = g.winners?.length ? g.winners.map(w => w.tag).join(', ') : '';
          const shareUrl = apiBase + '/giveaway/' + g.id;

          return (
            <div className="queue-card" key={g.id}>
              <div className="queue-card-header">
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>{g.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>by {g.hostTag || 'Unknown'}</div>
                </div>
                <span className={`badge ${isLive ? 'badge-active' : 'badge-inactive'}`} style={{ marginLeft: 'auto' }}>{g.status}</span>
              </div>
              {g.prize && <div className="queue-card-body">{g.prize}</div>}
              <div className="queue-card-meta">
                <span style={{ color: 'var(--success)', fontWeight: 700 }}><i className="fas fa-ticket" /> {g.entryCount || 0} Entries</span>
                <span style={{ color: 'var(--accent)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}><i className="fas fa-clock" /> {timer}</span>
              </div>
              {winnerText && <div style={{ fontSize: 12, color: 'var(--success)', marginBottom: 12 }}>🏆 {winnerText}</div>}
              <div className="queue-card-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => handleView(g.id)}><i className="fas fa-eye" /> View</button>
                {isLive && <button className="btn btn-ghost btn-sm" style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }} onClick={() => handleEnd(g.id)}><i className="fas fa-flag-checkered" /> End</button>}
                {g.status === 'ended' && <button className="btn btn-ghost btn-sm" onClick={() => handleReroll(g.id)}><i className="fas fa-dice" /> Reroll</button>}
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(g.id)}><i className="fas fa-trash" /></button>
              </div>
              <div
                style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}
                onClick={() => { navigator.clipboard.writeText(shareUrl); showToast('Link copied!', 'success'); }}
              >
                <i className="fas fa-link" /> {shareUrl}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Giveaway Modal */}
      <Modal
        id="giveawayModal"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={<><i className="fas fa-gift" /> Create Giveaway</>}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setCreateOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate}><i className="fas fa-save" /> Save Giveaway</button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Giveaway Title</label>
          <input className="form-input" placeholder="e.g. 67 Scrolls Nokia Giveaway" value={gwTitle} onChange={e => setGwTitle(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Prize Details (optional)</label>
          <textarea className="form-textarea" placeholder="Describe the prize..." value={gwPrize} onChange={e => setGwPrize(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Starts On</label>
          <input className="form-input" type="datetime-local" value={gwStarts} onChange={e => setGwStarts(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Ends On</label>
          <input className="form-input" type="datetime-local" value={gwEnds} onChange={e => setGwEnds(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Number of Winners</label>
          <input className="form-input" type="number" value={gwWinners} onChange={e => setGwWinners(e.target.value)} min="1" />
        </div>
        <div className="form-group">
          <label className="form-label">Giveaway Channel</label>
          <select className="form-select-input" value={gwChannel} onChange={e => setGwChannel(e.target.value)}>
            {channels.length === 0
              ? <option value="">Loading channels...</option>
              : channels.map(c => <option key={c.id} value={c.id}>{c.parent ? c.parent + ' / ' : ''}#{c.name}</option>)
            }
          </select>
        </div>
      </Modal>

      {/* View Giveaway Detail Modal */}
      <Modal
        id="viewGiveawayModal"
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        title="Giveaway Details"
        footer={viewData && <>
          <button className="btn btn-ghost" onClick={() => setViewOpen(false)}>Close</button>
          <button className="btn btn-primary" onClick={() => { navigator.clipboard.writeText(apiBase + '/giveaway/' + viewData.id); showToast('Link copied!', 'success'); }}>
            <i className="fas fa-copy" /> Copy Link
          </button>
        </>}
      >
        {viewData && (() => {
          const shareUrl = apiBase + '/giveaway/' + viewData.id;
          const entrants = (viewData.entrants || []).map(e => e.tag).join(', ') || 'None yet';
          const winners = (viewData.winners || []).map(w => w.tag).join(', ') || '—';
          return (
            <>
              <div className="detail-row"><span className="detail-label">Title</span><span className="detail-value">{viewData.title}</span></div>
              <div className="detail-row"><span className="detail-label">Prize</span><span className="detail-value">{viewData.prize || '—'}</span></div>
              <div className="detail-row"><span className="detail-label">Status</span><span className="detail-value">{viewData.status}</span></div>
              <div className="detail-row"><span className="detail-label">Entries</span><span className="detail-value">{viewData.entryCount || 0}</span></div>
              <div className="detail-row"><span className="detail-label">Winners picked</span><span className="detail-value">{winners}</span></div>
              <div className="detail-row"><span className="detail-label">Hosted by</span><span className="detail-value">{viewData.hostTag || '—'}</span></div>
              <div className="detail-row"><span className="detail-label">Ends</span><span className="detail-value">{viewData.endsAt ? new Date(viewData.endsAt).toLocaleString() : '—'}</span></div>
              <div className="detail-row"><span className="detail-label">Share link</span><span className="detail-value" style={{ fontSize: 11, wordBreak: 'break-all' }}>{shareUrl}</span></div>
              <div className="detail-row"><span className="detail-label">Entrants</span><span className="detail-value" style={{ fontSize: 12 }}>{entrants}</span></div>
            </>
          );
        })()}
      </Modal>
    </div>
  );
}
