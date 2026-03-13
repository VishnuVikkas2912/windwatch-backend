# 🌬️ WindWatch — Wind Turbine Management System
### Industry 4.0 | B.Tech Multidisciplinary Project

## 📁 Project Structure
```
wind_turbine/
├── data_pipeline/pipeline.py   ← Module 1: Data generation & feature extraction
├── ml_model/model.py           ← Module 2: Fault classifier + Power predictor
├── backend/app.py              ← Module 3: Flask REST API
├── frontend/App.jsx            ← Module 4: React Dashboard
├── requirements.txt
└── README.md
```

## 🚀 Run Order (Windows)

### Terminal 1 — Backend
```powershell
cd C:\Users\vikka\wind_turbine
pip install -r requirements.txt
python data_pipeline\pipeline.py
python ml_model\model.py
python backend\app.py
```

### Terminal 2 — Frontend
```powershell
cd C:\Users\vikka\dashboard
# Copy App.jsx content into src/App.js
npm install recharts
npm start
```

## 🌐 API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET  | /api/health           | API status |
| POST | /api/ingest           | Send turbine sensor data |
| GET  | /api/fleet            | All turbines status |
| GET  | /api/readings         | Historical readings |
| GET  | /api/stats            | Fleet statistics |
| GET  | /api/alerts           | Active alerts |
| POST | /api/alerts/<id>/acknowledge | Dismiss alert |
| GET  | /api/power/predict    | Predict power from wind speed |

## 🤖 ML Models
- Fault Classifier: Random Forest (200 trees) → Normal/Warning/Critical
- Power Predictor: Gradient Boosting → Expected kW output
- Anomaly Detector: Isolation Forest → Unusual readings

## 🌀 Turbines Monitored
T01, T02 → Healthy (Normal)
T03, T05 → Degrading (Warning/Critical)
T04      → Faulty (Critical)

## 👥 Team Roles
| Member | Task |
|--------|------|
| CSE #1 | backend/app.py |
| CSE #2 | frontend/App.jsx |
| Data Science | data_pipeline/pipeline.py + ml_model/model.py |
| Mechanical #1 | Turbine specs, blade/gearbox failure modes, sensor selection |
| Mechanical #2 | System diagrams, FMEA, technical report |
