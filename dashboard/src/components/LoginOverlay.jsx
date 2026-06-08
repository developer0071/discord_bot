import { useApp } from '../context/AppContext';
import './LoginOverlay.css';
import { getApiBase } from '../utils/api';

export default function LoginOverlay() {
  const { authenticated, authError, login } = useApp();

  if (authenticated) return null;

  return (
    <div className="login-overlay" id="loginOverlay">
      <div className="login-card">
        <img
          src={getApiBase() + '/logo.png'}
          alt=""
          className="login-logo"
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <h1>Dashboard Login</h1>
        <p className="login-msg">
          {authError || 'Sign in with Discord to manage the regiment.'}
        </p>
        <button className="login-btn" onClick={login}>
          <i className="fab fa-discord" /> Login with Discord
        </button>
      </div>
    </div>
  );
}
