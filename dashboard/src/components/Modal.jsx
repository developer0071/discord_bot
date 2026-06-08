import { useEffect, useCallback } from 'react';
import './Modal.css';

export default function Modal({ id, open, onClose, title, titleStyle, children, footer, maxWidth }) {
  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && open) onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  return (
    <div
      className={`modal-overlay${open ? ' open' : ''}`}
      id={id}
      onClick={handleOverlayClick}
    >
      <div className="modal" style={maxWidth ? { maxWidth } : undefined}>
        <div className="modal-header">
          <h3 style={titleStyle}>{title}</h3>
          <button className="modal-close" onClick={onClose}>
            <i className="fas fa-xmark" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
