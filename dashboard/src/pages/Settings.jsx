import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function Settings() {
  const { settings, regimentStatus, saveSettings } = useApp();

  const [name, setName] = useState('');
  const [maxSize, setMaxSize] = useState('');
  const [autoAccept, setAutoAccept] = useState('');
  const [kickReason, setKickReason] = useState('');

  useEffect(() => {
    setName(settings.name || 'Moonlight Soldiers');
    setMaxSize(regimentStatus?.maxSlots ?? '');
    setAutoAccept(settings.autoAccept !== undefined ? settings.autoAccept : '48');
    setKickReason(settings.kickReason || 'Removed from regiment by command.');
  }, [settings, regimentStatus]);

  const handleSave = () => {
    saveSettings({ name, maxSize, autoAccept, kickReason });
  };

  return (
    <div className="page-content" id="tab-settings">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-subtitle">Configure regiment management preferences</div>
        </div>
      </div>

      <div style={{ maxWidth: 600 }}>
        <div className="form-group">
          <label className="form-label">Regiment Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Max Regiment Size</label>
          <input className="form-input" type="number" value={maxSize} onChange={e => setMaxSize(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Auto-accept Queue After (hours)</label>
          <input className="form-input" type="number" value={autoAccept} onChange={e => setAutoAccept(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Default Kick Reason</label>
          <input className="form-input" value={kickReason} onChange={e => setKickReason(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={handleSave}><i className="fas fa-save" /> Save Settings</button>
      </div>
    </div>
  );
}
