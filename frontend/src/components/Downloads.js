import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

function Downloads() {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("qre_token");
    if (!token) { navigate("/login"); return; }

    fetch(`${API}/admin/csv-list`, {
      headers: { "Authorization": `Bearer ${token}` }
    })
      .then(r => {
        if (r.status === 403) { navigate("/scanner"); return null; }
        if (!r.ok) throw new Error("Error");
        return r.json();
      })
      .then(data => { if (data) setFiles(data.files); })
      .catch(() => setError("Error al cargar archivos"))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleDownload = (filename) => {
    const token = localStorage.getItem("qre_token");
    const url = `${API}/admin/csv-download/${filename}`;
    fetch(url, { headers: { "Authorization": `Bearer ${token}` } })
      .then(r => {
        if (!r.ok) throw new Error("Error");
        return r.blob();
      })
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch(() => alert("Error al descargar"));
  };

  return (
    <div className="scanner-container">
      <div className="scanner-header">
        <h1>Archivos CSV</h1>
        <div className="user-info">
          <button className="logout-button" onClick={() => navigate("/scanner")} data-testid="back-to-scanner">
            Volver
          </button>
        </div>
      </div>

      <div style={{ padding: "16px" }}>
        {loading && <div className="loading-text">Cargando archivos...</div>}
        {error && <div className="login-error">{error}</div>}

        {!loading && files.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--text-light)" }}>No hay archivos CSV disponibles</p>
        )}

        {files.map((f) => (
          <div key={f.filename} data-testid={`csv-file-${f.filename}`} style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px",
            marginBottom: "8px",
            backgroundColor: "var(--white)",
            borderRadius: "8px",
            border: "1px solid var(--accent-color)"
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: "bold", color: "var(--primary-color)", fontSize: "13px", wordBreak: "break-all" }}>
                {f.filename}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-light)", marginTop: "4px" }}>
                {f.size_kb} KB &middot; {f.modified}
              </div>
            </div>
            <button
              onClick={() => handleDownload(f.filename)}
              data-testid={`download-${f.filename}`}
              style={{
                marginLeft: "12px",
                padding: "8px 16px",
                backgroundColor: "var(--primary-color)",
                color: "var(--white)",
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
                fontSize: "13px",
                flexShrink: 0
              }}
            >
              Descargar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Downloads;
