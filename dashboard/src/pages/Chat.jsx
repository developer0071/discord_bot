import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { apiFetch } from '../utils/api';
import 'emoji-picker-element';

export default function Chat() {
  const { isMod, showToast } = useApp();
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [history, setHistory] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  
  const chatBodyRef = useRef(null);
  const inputRef = useRef(null);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!isMod) return;
    apiFetch('GET', '/api/chat/channels')
      .then(res => {
        if (res.channels) {
          setChannels(res.channels);
          const saved = localStorage.getItem('chat_target_channel');
          if (saved && res.channels.some(c => c.id === saved)) setSelectedChannel(saved);
          else if (res.channels.length > 0) setSelectedChannel(res.channels[0].id);
        }
      })
      .catch(() => showToast('Failed to load channels', 'error'));
  }, [isMod]);

  useEffect(() => {
    if (selectedChannel) localStorage.setItem('chat_target_channel', selectedChannel);
  }, [selectedChannel]);

  useEffect(() => {
    const handleEmoji = (e) => {
      const cursor = inputRef.current?.selectionStart || 0;
      const text = message;
      const newText = text.slice(0, cursor) + e.detail.unicode + text.slice(cursor);
      setMessage(newText);
    };
    const picker = pickerRef.current;
    if (picker) picker.addEventListener('emoji-click', handleEmoji);
    return () => { if (picker) picker.removeEventListener('emoji-click', handleEmoji); };
  }, [message]);

  const handleSend = async () => {
    const content = message.trim();
    if (!content && !file) return;
    if (!selectedChannel) { showToast('Please select a channel', 'error'); return; }

    setIsSending(true);
    try {
      let payload;
      if (file) {
        payload = new FormData();
        payload.append('channelId', selectedChannel);
        payload.append('content', content);
        payload.append('file', file);
      } else {
        payload = { channelId: selectedChannel, content };
      }

      await apiFetch('POST', '/api/chat/send', payload);
      const channelName = channels.find(c => c.id === selectedChannel)?.name || selectedChannel;
      setHistory(prev => [...prev, { content: content + (file ? `\n[Attached: ${file.name}]` : ''), channelName, time: new Date() }]);
      setMessage('');
      setFile(null);
      setShowEmoji(false);
      setTimeout(() => {
        if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
      }, 50);
    } catch (e) {
      showToast('Failed to send: ' + e.message, 'error');
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isMod) return <div className="page-content"><h2>Access Denied</h2></div>;

  return (
    <div className="page-content">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Live Chat Relay</h1>
          <div className="page-subtitle">Send messages directly to Discord as the bot</div>
        </div>
      </div>

      <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 16, display: 'flex', flexDirection: 'column', height: '70vh', position: 'relative' }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 20, margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
            <i className="fa-solid fa-robot" style={{ color: 'var(--accent)' }} /> Bot Relay
          </h2>
          <select 
            className="filter-select" 
            style={{ width: 250 }}
            value={selectedChannel} 
            onChange={e => setSelectedChannel(e.target.value)}
          >
            {channels.length === 0 ? <option value="">Loading channels...</option> : 
             channels.map(c => <option key={c.id} value={c.id}>{c.parent ? c.parent + ' / ' : ''}#{c.name}</option>)}
          </select>
        </div>

        <div ref={chatBodyRef} style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, background: 'linear-gradient(180deg, var(--bg-base) 0%, var(--bg-surface) 100%)' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 20 }}>
            Messages sent here will be relayed directly to the selected Discord channel as the bot.<br/>
            You can paste GIF links and they will unfurl automatically.
          </div>
          {history.map((msg, i) => (
            <div key={i} style={{ alignSelf: 'flex-end', background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '12px 18px', borderRadius: '16px 16px 0 16px', maxWidth: '80%', color: 'var(--text-primary)', fontSize: 14, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, borderBottom: '1px solid var(--border-light)', paddingBottom: 4 }}>
                Sent to #{msg.channelName}
              </span>
              {msg.content.split('\n').map((line, j) => <div key={j}>{line}</div>)}
            </div>
          ))}
        </div>

        <div style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' }}>
          {file && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border)', width: 'fit-content' }}>
              <i className="fa-solid fa-file" style={{ color: 'var(--accent)' }} />
              <span style={{ fontSize: 13, color: 'var(--text-primary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
              </span>
              <button 
                className="btn btn-ghost" 
                style={{ padding: '4px 8px', minHeight: 'unset', height: 'auto', marginLeft: 4 }}
                onClick={() => { setFile(null); document.getElementById('file-upload').value = ''; }}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {showEmoji && (
              <div style={{ position: 'absolute', bottom: '100%', right: 20, zIndex: 100 }}>
                <emoji-picker ref={pickerRef} class="dark"></emoji-picker>
              </div>
            )}
            <input 
              type="file" 
              id="file-upload" 
              style={{ display: 'none' }} 
              onChange={(e) => {
                const f = e.target.files[0];
                if (f && f.size > 25 * 1024 * 1024) {
                  showToast('File is too large! Maximum allowed is 25MB.', 'error');
                  e.target.value = '';
                  return;
                }
                setFile(f || null);
              }} 
            />
            <button className="btn btn-ghost" onClick={() => document.getElementById('file-upload').click()}>
               <i className="fa-solid fa-paperclip" style={{ color: file ? 'var(--accent)' : 'inherit' }} />
            </button>
            <button className="btn btn-ghost" onClick={() => setShowEmoji(!showEmoji)}><i className="fa-regular fa-face-smile" /></button>
            <textarea
              ref={inputRef}
              style={{ flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '14px 16px', borderRadius: 12, fontFamily: 'Space Grotesk', fontSize: 15, resize: 'none', height: 52 }}
              placeholder="Type a message... (Shift+Enter for new line)"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSending}
            />
            <button className="btn btn-primary" onClick={handleSend} disabled={isSending || (!message.trim() && !file)}><i className="fa-solid fa-paper-plane" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
