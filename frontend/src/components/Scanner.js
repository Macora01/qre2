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
  const [isScannerReady, setIsScannerReady] = useState(false);
  const html5QrcodeRef = useRef(null);

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
    // Initialize barcode scanner with direct video stream
    const initScanner = async () => {
      if (html5QrcodeRef.current) {
        return; // Already initialized
      }

      try {
        const html5QrCode = new Html5Qrcode("reader");
        html5QrcodeRef.current = html5QrCode;

        // Configuration for continuous scanning
        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
          // Support all barcode formats
          formatsToSupport: [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
          ]
        };

        // Callback when barcode is detected
        const qrCodeSuccessCallback = async (decodedText, decodedResult) => {
          if (isScanning) return; // Prevent multiple scans
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
            setTimeout(() => setIsScanning(false), 1000);
          }
        };

        // Get available cameras first (this triggers permission request)
        const cameras = await Html5Qrcode.getCameras();
        
        if (cameras && cameras.length > 0) {
          // Try to find back camera (environment facing)
          let cameraId = cameras[0].id;
          
          // Look for back camera
          const backCamera = cameras.find(camera => 
            camera.label.toLowerCase().includes('back') ||
            camera.label.toLowerCase().includes('rear') ||
            camera.label.toLowerCase().includes('environment')
          );
          
          if (backCamera) {
            cameraId = backCamera.id;
          } else if (cameras.length > 1) {
            // If multiple cameras, usually the second one is the back camera on mobile
            cameraId = cameras[cameras.length - 1].id;
          }

          // Advanced configuration with autofocus for iOS
          const advancedConfig = {
            fps: 5, // Reduced FPS for better processing
            qrbox: function(viewfinderWidth, viewfinderHeight) {
              // For barcodes: wider rectangle (better for linear codes)
              let minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              let qrboxWidth = minEdge * 0.8; // 80% of width
              let qrboxHeight = minEdge * 0.4; // 40% of height (wider rectangle)
              return {
                width: qrboxWidth,
                height: qrboxHeight
              };
            },
            aspectRatio: 1.0,
            // Support all barcode formats
            formatsToSupport: [
              0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
            ],
            // Advanced camera settings for iOS
            videoConstraints: {
              facingMode: "environment",
              focusMode: "continuous", // Continuous autofocus
              advanced: [
                { focusMode: "continuous" },
                { focusDistance: 0.5 }
              ]
            },
            // Experimental features
            experimentalFeatures: {
              useBarCodeDetectorIfSupported: true
            }
          };

          // Start scanning with selected camera
          await html5QrCode.start(
            cameraId,
            advancedConfig,
            qrCodeSuccessCallback,
            (errorMessage) => {
              // Ignore continuous scanning errors
            }
          );

          setIsScannerReady(true);
          console.log("✅ Scanner started successfully with camera:", cameraId);
        } else {
          throw new Error('No cameras found');
        }

      } catch (error) {
        console.error('Error starting scanner:', error);
        
        let errorMsg = '❌ Error al iniciar la cámara.';
        
        if (error.name === 'NotAllowedError' || error.message.includes('Permission')) {
          errorMsg = '❌ Permiso de cámara denegado. Ve a Ajustes del navegador y permite el acceso.';
        } else if (error.name === 'NotFoundError') {
          errorMsg = '❌ No se encontró ninguna cámara en el dispositivo.';
        } else if (error.name === 'NotReadableError') {
          errorMsg = '❌ La cámara está siendo usada por otra aplicación.';
        }
        
        setAlert({
          type: 'warning',
          message: errorMsg
        });
      }
    };

    const timer = setTimeout(() => {
      initScanner();
    }, 500);

    return () => {
      clearTimeout(timer);
      if (html5QrcodeRef.current) {
        html5QrcodeRef.current.stop().then(() => {
          html5QrcodeRef.current.clear();
          html5QrcodeRef.current = null;
        }).catch(console.error);
      }
    };
  }, []);

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
        <div id="reader" style={{ width: '100%', maxWidth: '500px', margin: '0 auto' }}></div>
        {!isScannerReady && (
          <div style={{ 
            textAlign: 'center', 
            padding: '20px', 
            color: 'var(--text-light)',
            fontSize: '14px'
          }}>
            <p>📷 Inicializando escáner...</p>
            <p>Permite el acceso a la cámara cuando se solicite</p>
          </div>
        )}
        {isScannerReady && (
          <div style={{ 
            textAlign: 'center', 
            padding: '16px', 
            color: 'var(--text-color)',
            fontSize: '13px',
            backgroundColor: 'var(--accent-color)',
            borderRadius: '8px',
            marginTop: '12px'
          }}>
            <strong>💡 Para códigos de barras:</strong><br/>
            • Mantén a 15-20 cm de distancia<br/>
            • Alinea horizontalmente dentro del rectángulo<br/>
            • Espera 2-3 segundos para que enfoque<br/>
            • Buena iluminación es clave
          </div>
        )}
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
