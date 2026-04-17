import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { unlockBeep } from "../lib/beep";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("qre_email");
    if (saved) setEmail(saved);

    const token = localStorage.getItem("qre_token");
    if (!token) { setChecking(false); return; }

    fetch(`${API}/auth/me`, {
      headers: { "Authorization": `Bearer ${token}` }
    }).then(r => {
      if (r.ok) navigate("/scanner");
      else setChecking(false);
    }).catch(() => setChecking(false));
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const trimmed = email.trim().toLowerCase();

    if (!trimmed) { setError("Ingresa un correo electrónico"); return; }
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
      setError("Formato de correo inválido"); return;
    }

    setLoading(true);
    unlockBeep();
    try {
      const response = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, password }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.needs_password) {
          setNeedsPassword(true);
          setError("Ingresa tu contraseña");
        } else if (data.session_token) {
          localStorage.setItem("qre_email", trimmed);
          localStorage.setItem("qre_token", data.session_token);
          if (data.is_admin) localStorage.setItem("qre_admin", "1");
          else localStorage.removeItem("qre_admin");
          navigate("/scanner", { replace: true });
        }
      } else {
        const data = await response.json();
        setError(data.detail || "Error al iniciar sesión");
      }
    } catch (err) {
      setError("Error de conexión. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <div className="loading-text">Verificando sesión...</div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <h1 className="login-title" data-testid="login-title">Escáner QR</h1>
        <p className="login-subtitle">Ingresa tu correo para comenzar a escanear</p>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            className="login-input"
            placeholder="tu@correo.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setNeedsPassword(false); setPassword(""); }}
            autoComplete="email"
            autoFocus
            data-testid="email-input"
          />
          {needsPassword && (
            <input
              type="password"
              className="login-input"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              data-testid="password-input"
            />
          )}
          {error && <div className="login-error" data-testid="login-error">{error}</div>}
          <button type="submit" className="login-button" disabled={loading} data-testid="login-button">
            {loading ? "Ingresando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;
