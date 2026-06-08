import { useApp } from '../context/AppContext';
import './Toast.css';

export default function Toast() {
  const { toasts } = useApp();

  return (
    <div className="toast-container" id="toastContainer">
      {toasts.map(t => {
        const icons = {
          success: 'fa-circle-check',
          error: 'fa-circle-xmark',
          info: 'fa-circle-info',
          warning: 'fa-triangle-exclamation',
        };
        return (
          <div
            key={t.id}
            className={`toast toast-${t.type}${t.removing ? ' removing' : ''}`}
          >
            <i className={`fas ${icons[t.type] || icons.info}`} />
            {t.message}
          </div>
        );
      })}
    </div>
  );
}
