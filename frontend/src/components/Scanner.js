import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function Scanner() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [counter, setCounter] = useState(0);
  const [lastScannedCode, setLastScannedCode] = useState(null);
  const [alert, setAlert] = useState(null);
  const [nextEnabled, setNextEnabled] = useState(false);
  const [showFinalizeModal, setShowFinalizeModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef(null);
  const html5QrcodeScannerRef = useRef(null);

  useEffect(() => {
    // Get current user
    const fetchUser = async () => {
      try {
        const response = await fetch(`${API}/auth/me`, {
          credentials: 'include'
        });
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        }
      } catch (error) {
        console.error('Error fetching user:', error);
      }
    };

    // Get session stats
    const fetchStats = async () => {
      try {
        const response = await fetch(`${API}/session-stats`, {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setCounter(data.barcode_count);
        }
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    };

    fetchUser();
    fetchStats();
  }, []);

  useEffect(() => {
    // Initialize barcode scanner
    const initScanner = async () => {
      if (html5QrcodeScannerRef.current) {
        return; // Already initialized
      }

      try {
        const scanner = new Html5QrcodeScanner(
          "reader",
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            // Support all barcode formats
            formatsToSupport: [
              0, // QR_CODE
              1, // AZTEC
              2, // CODABAR
              3, // CODE_39
              4, // CODE_93
              5, // CODE_128
              6, // DATA_MATRIX
              7, // MAXICODE
              8, // ITF
              9, // EAN_13
              10, // EAN_8
              11, // PDF_417
              12, // RSS_14
              13, // RSS_EXPANDED
              14, // UPC_A
              15, // UPC_E
              16, // UPC_EAN_EXTENSION
            ],
            rememberLastUsedCamera: true,
            aspectRatio: 1.0,
            showTorchButtonIfSupported: true,
            videoConstraints: {
              facingMode: { ideal: "environment" } // Prefer back camera
            },
            // IMPORTANT: Only show camera option, not file upload
            supportedScanTypes: [1] // 1 = camera only, 0 = file only
          },
          false
        );

        html5QrcodeScannerRef.current = scanner;

        scanner.render(
          async (decodedText, decodedResult) => {
            if (isScanning) return; // Prevent multiple scans at once
            setIsScanning(true);

            try {
              // Save barcode to backend
              const response = await fetch(`${API}/barcode`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({ barcode: decodedText })
              });

              if (response.ok) {
                const data = await response.json();
                setCounter(data.barcode_count);
                setLastScannedCode(decodedText);
                setNextEnabled(true);

                if (data.is_duplicate) {
                  setAlert({
                    type: 'warning',
                    message: `⚠️ Código duplicado: ${decodedText}. Se ha guardado de todos modos.`
                  });
                } else {
                  setAlert({
                    type: 'success',
                    message: `✅ Código escaneado: ${decodedText}`
                  });
                }

                // Clear alert after 3 seconds
                setTimeout(() => setAlert(null), 3000);
              } else {
                setAlert({
                  type: 'warning',
                  message: '❌ Error al guardar el código'
                });
              }
            } catch (error) {
              console.error('Error saving barcode:', error);
              setAlert({
                type: 'warning',
                message: '❌ Error de conexión'
              });
            } finally {
              setIsScanning(false);
            }
          },
          (errorMessage) => {
            // Ignore scanning errors (too frequent)
          }
        );
      } catch (error) {
        console.error('Error initializing scanner:', error);
        setAlert({
          type: 'warning',
          message: '❌ Error al inicializar el escáner. Recarga la página.'
        });
      }
    };

    // Delay initialization to ensure DOM is ready
    const timer = setTimeout(() => {
      initScanner();
    }, 500);

    return () => {
      clearTimeout(timer);
      if (html5QrcodeScannerRef.current) {
        html5QrcodeScannerRef.current.clear().catch(console.error);
        html5QrcodeScannerRef.current = null;
      }
    };
  }, []); // Empty dependency array - run once on mount

  const handleNext = () => {
    setNextEnabled(false);
    setLastScannedCode(null);
    setAlert(null);
  };

  const handleFinalize = () => {
    if (counter === 0) {
      setAlert({
        type: 'warning',
        message: '⚠️ No hay códigos escaneados para finalizar'
      });
      setTimeout(() => setAlert(null), 3000);
      return;
    }
    setShowFinalizeModal(true);
  };

  const confirmFinalize = async () => {
    try {
      const response = await fetch(`${API}/finalize-session`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setAlert({
          type: 'success',
          message: `✅ Sesión finalizada. Archivo: ${data.csv_filename}`
        });
        setShowFinalizeModal(false);
        
        // Reset state
        setTimeout(() => {
          setCounter(0);
          setNextEnabled(false);
          setLastScannedCode(null);
          setAlert(null);
        }, 3000);
      } else {
        setAlert({
          type: 'warning',
          message: '❌ Error al finalizar la sesión'
        });
      }
    } catch (error) {
      console.error('Error finalizing session:', error);
      setAlert({
        type: 'warning',
        message: '❌ Error de conexión'
      });
    }
    setShowFinalizeModal(false);
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      navigate('/login');
    } catch (error) {
      console.error('Error logging out:', error);
      navigate('/login');
    }
  };

  return (
    <div className="scanner-container">
      <div className="scanner-header">
        <h1>📦 Escáner de Códigos de Barras</h1>
        {user && (
          <div className="user-info">
            {user.picture && (
              <img
                src={user.picture}
                alt={user.name}
                className="user-avatar"
              />
            )}
            <span className="user-name">{user.name}</span>
            <button
              className="logout-button"
              onClick={handleLogout}
              data-testid="logout-button"
            >
              Cerrar sesión
            </button>
          </div>
        )}
      </div>

      <div className="counter-card">
        <div className="counter-label">Lecturas válidas</div>
        <div className="counter-value" data-testid="barcode-counter">{counter}</div>
      </div>

      {alert && (
        <div className={`alert alert-${alert.type}`} data-testid="alert-message">
          <span className="alert-icon">
            {alert.type === 'success' ? '✅' : '⚠️'}
          </span>
          <span>{alert.message}</span>
        </div>
      )}

      <div className="scanner-card">
        <div id="reader" ref={scannerRef}></div>
        <div style={{ 
          textAlign: 'center', 
          padding: '20px', 
          color: 'var(--text-light)',
          fontSize: '14px'
        }}>
          <p>📷 El escáner se inicializará automáticamente</p>
          <p>Permite el acceso a la cámara cuando se solicite</p>
        </div>
      </div>

      <div className="bottom-buttons">
        <button
          className="btn btn-primary"
          disabled={!nextEnabled}
          onClick={handleNext}
          data-testid="next-button"
        >
          ➡️ Próximo
        </button>
        <button
          className="btn btn-danger"
          onClick={handleFinalize}
          data-testid="finalize-button"
        >
          ✓ Finalizar
        </button>
      </div>

      {showFinalizeModal && (
        <div className="modal-overlay" data-testid="finalize-modal">
          <div className="modal-content">
            <div className="modal-icon">⚠️</div>
            <h2 className="modal-title">¿Finalizar sesión?</h2>
            <p className="modal-message">
              Estás a punto de finalizar la sesión de escaneo.
              <br />
              <strong>Total de códigos: {counter}</strong>
              <br />
              <br />
              Se generará un archivo CSV con todos los códigos escaneados.
              ¿Deseas continuar?
            </p>
            <div className="modal-buttons">
              <button
                className="btn btn-primary"
                onClick={() => setShowFinalizeModal(false)}
                data-testid="cancel-finalize-button"
              >
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                onClick={confirmFinalize}
                data-testid="confirm-finalize-button"
              >
                Sí, finalizar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Scanner;
