import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";

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
  const [scannerPaused, setScannerPaused] = useState(false);
  const html5QrcodeRef = useRef(null);
  const lastScannedCodeRef = useRef(null);
  const lastScanTimeRef = useRef(0);
  const beepRef = useRef(null);

  // Create beep sound on mount
  useEffect(() => {
    const sr = 8000, dur = 0.15, freq = 1200;
    const n = sr * dur;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0,'RIFF'); v.setUint32(4,36+n*2,true); ws(8,'WAVE'); ws(12,'fmt ');
    v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
    v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true);
    v.setUint16(34,16,true); ws(36,'data'); v.setUint32(40,n*2,true);
    for (let i = 0; i < n; i++) {
      v.setInt16(44+i*2, Math.sin(2*Math.PI*freq*i/sr)*0.4*32767, true);
    }
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    beepRef.current = new Audio(url);
    beepRef.current.volume = 1.0;
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("qre_token");
    const authHeaders = { "Authorization": `Bearer ${token}` };

    // Get current user
    const fetchUser = async () => {
      try {
        const response = await fetch(`${API}/auth/me`, { headers: authHeaders });
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
        const response = await fetch(`${API}/session-stats`, { headers: authHeaders });
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
          // Prevent multiple scans of same code
          const now = Date.now();
          const timeSinceLastScan = now - lastScanTimeRef.current;
          
          // Ignore if already scanning or same code within 2 seconds
          if (isScanning || scannerPaused) return;
          if (lastScannedCodeRef.current === decodedText && timeSinceLastScan < 2000) return;
          
          setIsScanning(true);
          lastScannedCodeRef.current = decodedText;
          lastScanTimeRef.current = now;

          // PAUSE scanner immediately after successful scan
          setScannerPaused(true);
          if (html5QrcodeRef.current) {
            try {
              await html5QrcodeRef.current.pause();
            } catch (e) {
              console.log("Scanner already paused");
            }
          }

          try {
            // Save barcode to backend
            const token = localStorage.getItem("qre_token");
            const response = await fetch(`${API}/barcode`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ barcode: decodedText })
            });

            if (response.ok) {
              const data = await response.json();
              setCounter(data.barcode_count);
              setLastScannedCode(decodedText);
              setNextEnabled(true);

              // Vibración + sonido al escanear correctamente
              if (navigator.vibrate) navigator.vibrate(200);
              if (beepRef.current) {
                beepRef.current.currentTime = 0;
                beepRef.current.play().catch(() => {});
              }

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
            setIsScanning(false);
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
              // For VERTICAL labels: taller rectangle
              let minEdge = Math.min(viewfinderWidth, viewfinderHeight);
              let qrboxWidth = minEdge * 0.5; // 50% of width (narrower)
              let qrboxHeight = minEdge * 0.8; // 80% of height (taller)
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

  const handleNext = async () => {
    setNextEnabled(false);
    setLastScannedCode(null);
    setAlert(null);
    lastScannedCodeRef.current = null;

    // Unlock audio on user gesture (required by mobile browsers)
    if (beepRef.current) {
      beepRef.current.play().then(() => {
        beepRef.current.pause();
        beepRef.current.currentTime = 0;
      }).catch(() => {});
    }
    
    // RESUME scanner for next code
    setScannerPaused(false);
    if (html5QrcodeRef.current) {
      try {
        await html5QrcodeRef.current.resume();
        console.log("✅ Scanner resumed - ready for next code");
      } catch (e) {
        console.log("Scanner already active");
      }
    }
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
      const token = localStorage.getItem("qre_token");
      const response = await fetch(`${API}/finalize-session`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
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
      const token = localStorage.getItem("qre_token");
      await fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (error) {
      console.error('Error logging out:', error);
    }
    localStorage.removeItem("qre_token");
    localStorage.removeItem("qre_email");
    navigate('/login');
  };

  return (
    <div className="scanner-container">
      <div className="scanner-header">
        <h1>Escáner de Códigos QR</h1>
        {user && (
          <div className="user-info">
            <span className="user-name">{user.email}</span>
            <button
              className="logout-button"
              onClick={handleLogout}
              data-testid="logout-button"
            >
              Salir
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
            backgroundColor: scannerPaused ? '#f5e6d3' : 'var(--accent-color)',
            borderRadius: '8px',
            marginTop: '12px',
            border: scannerPaused ? '2px solid var(--error-color)' : 'none'
          }}>
            {scannerPaused ? (
              <>
                <strong>⏸️ Escáner PAUSADO</strong><br/>
                Presiona "Próximo" para continuar
              </>
            ) : (
              <>
                <strong>📱 Para códigos QR verticales:</strong><br/>
                • Mantén a 15-20 cm de distancia<br/>
                • Alinea dentro del rectángulo vertical<br/>
                • Espera 1-2 segundos para que enfoque
              </>
            )}
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
