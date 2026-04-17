import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./App.css";
import LoginPage from "./components/LoginPage";
import Scanner from "./components/Scanner";
import Downloads from "./components/Downloads";
import ProtectedRoute from "./components/ProtectedRoute";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/scanner"
            element={
              <ProtectedRoute>
                <Scanner />
              </ProtectedRoute>
            }
          />
          <Route
            path="/downloads"
            element={
              <ProtectedRoute>
                <Downloads />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
