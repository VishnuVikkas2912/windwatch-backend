"""
MODULE 2: Wind Turbine ML Model
=================================
Trains:
  1. Random Forest — Fault Classification (Normal/Warning/Critical)
  2. Gradient Boosting — Power Output Prediction
  3. Isolation Forest — Anomaly Detection

Saves all models to disk for use by the Flask API.
"""

import numpy as np
import pandas as pd
import sqlite3
import pickle
import os
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor, IsolationForest
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, mean_absolute_error, r2_score
import warnings
warnings.filterwarnings('ignore')

# ─────────────────────────────────────────
# FEATURE COLUMNS
# ─────────────────────────────────────────
CLASSIFICATION_FEATURES = [
    'wind_speed_mean', 'wind_speed_std', 'power_mean', 'power_std',
    'rpm_mean', 'rpm_std', 'pitch_mean',
    'vib_rms', 'vib_kurtosis', 'vib_crest', 'vib_fft_energy', 'vib_peak_freq',
    'gearbox_temp_mean', 'gearbox_temp_max',
    'generator_temp_mean', 'generator_temp_max',
    'nacelle_temp_mean', 'capacity_factor', 'power_per_wind'
]

POWER_FEATURES = ['wind_speed_mean', 'wind_speed_std', 'rpm_mean', 'pitch_mean', 'capacity_factor']

LABEL_MAP   = {0: 'Normal', 1: 'Warning', 2: 'Critical'}
MODEL_PATH  = 'fault_model.pkl'
POWER_PATH  = 'power_model.pkl'
SCALER_PATH = 'scaler.pkl'
ANOMALY_PATH= 'anomaly_model.pkl'


# ─────────────────────────────────────────
# LOAD DATA
# ─────────────────────────────────────────
def load_features(db_path='turbine_data.db') -> pd.DataFrame:
    conn = sqlite3.connect(db_path)
    df = pd.read_sql('SELECT * FROM features', conn)
    conn.close()
    print(f"[✓] Loaded {len(df)} feature rows")
    return df


# ─────────────────────────────────────────
# 1. FAULT CLASSIFICATION MODEL
# ─────────────────────────────────────────
def train_fault_classifier(df: pd.DataFrame):
    X = df[CLASSIFICATION_FEATURES].fillna(0).values
    y = df['label'].astype(int).values

    scaler  = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    X_train, X_test, y_train, y_test = train_test_split(
        X_scaled, y, test_size=0.2, random_state=42, stratify=y
    )

    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=15,
        min_samples_leaf=3,
        class_weight='balanced',
        random_state=42,
        n_jobs=-1
    )
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    acc    = accuracy_score(y_test, y_pred)

    print(f"\n[✓] Fault Classifier Accuracy: {acc * 100:.2f}%")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred, target_names=['Normal', 'Warning', 'Critical']))
    print("Confusion Matrix:")
    print(confusion_matrix(y_test, y_pred))

    # Feature importances
    imp = pd.Series(clf.feature_importances_, index=CLASSIFICATION_FEATURES).sort_values(ascending=False)
    print("\nTop 5 Features:")
    print(imp.head(5).to_string())

    with open(MODEL_PATH, 'wb') as f: pickle.dump(clf, f)
    with open(SCALER_PATH,'wb') as f: pickle.dump(scaler, f)
    print(f"\n[✓] Fault model saved to {MODEL_PATH}")

    return clf, scaler, acc


# ─────────────────────────────────────────
# 2. POWER PREDICTION MODEL
# ─────────────────────────────────────────
def train_power_predictor(df: pd.DataFrame):
    X = df[POWER_FEATURES].fillna(0).values
    y = df['power_mean'].values

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    reg = GradientBoostingRegressor(
        n_estimators=150,
        max_depth=5,
        learning_rate=0.1,
        random_state=42
    )
    reg.fit(X_train, y_train)

    y_pred = reg.predict(X_test)
    mae    = mean_absolute_error(y_test, y_pred)
    r2     = r2_score(y_test, y_pred)

    print(f"\n[✓] Power Predictor — MAE: {mae:.2f} kW | R²: {r2:.4f}")

    with open(POWER_PATH, 'wb') as f: pickle.dump(reg, f)
    print(f"[✓] Power model saved to {POWER_PATH}")

    return reg


# ─────────────────────────────────────────
# 3. ANOMALY DETECTION
# ─────────────────────────────────────────
def train_anomaly_detector(df: pd.DataFrame, scaler):
    X = df[CLASSIFICATION_FEATURES].fillna(0).values
    X_scaled = scaler.transform(X)

    iso = IsolationForest(contamination=0.05, random_state=42, n_jobs=-1)
    iso.fit(X_scaled)

    with open(ANOMALY_PATH, 'wb') as f: pickle.dump(iso, f)
    print(f"[✓] Anomaly detector saved to {ANOMALY_PATH}")
    return iso


# ─────────────────────────────────────────
# INFERENCE FUNCTIONS (used by Flask API)
# ─────────────────────────────────────────
def load_models():
    with open(MODEL_PATH,  'rb') as f: clf    = pickle.load(f)
    with open(SCALER_PATH, 'rb') as f: scaler = pickle.load(f)
    with open(POWER_PATH,  'rb') as f: reg    = pickle.load(f)
    return clf, scaler, reg


def predict_fault(features: dict) -> dict:
    """Predict fault status from feature dict."""
    clf, scaler, _ = load_models()
    values   = [features.get(c, 0) for c in CLASSIFICATION_FEATURES]
    X_scaled = scaler.transform(np.array(values).reshape(1, -1))

    pred_class = clf.predict(X_scaled)[0]
    pred_proba = clf.predict_proba(X_scaled)[0]

    return {
        'status':      LABEL_MAP[pred_class],
        'status_code': int(pred_class),
        'confidence':  round(float(np.max(pred_proba)) * 100, 2),
        'probabilities': {
            'Normal':   round(float(pred_proba[0]) * 100, 2),
            'Warning':  round(float(pred_proba[1]) * 100, 2),
            'Critical': round(float(pred_proba[2]) * 100, 2),
        }
    }


def predict_power(wind_speed, rpm, pitch_angle, capacity_factor=0.5) -> float:
    """Predict expected power output from wind conditions."""
    _, _, reg = load_models()
    X = np.array([[wind_speed, 0.5, rpm, pitch_angle, capacity_factor]])
    return round(float(reg.predict(X)[0]), 2)


# ─────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 55)
    print("  WIND TURBINE MANAGEMENT — ML TRAINING")
    print("=" * 55)

    # Auto-run pipeline if DB missing
    if not os.path.exists('turbine_data.db'):
        print("[!] turbine_data.db not found. Running pipeline first...")
        import sys
        sys.path.append('../data_pipeline')
        from pipeline import generate_turbine_data, clean_data, extract_features, label_health, store_to_db
        raw = generate_turbine_data(20000, 5)
        clean = clean_data(raw)
        feats = extract_features(clean)
        labeled = label_health(feats)
        store_to_db(labeled)

    df = load_features('turbine_data.db')

    print("\n--- Training Fault Classifier ---")
    clf, scaler, acc = train_fault_classifier(df)

    print("\n--- Training Power Predictor ---")
    reg = train_power_predictor(df)

    print("\n--- Training Anomaly Detector ---")
    iso = train_anomaly_detector(df, scaler)

    print("\n--- Testing Inference ---")
    sample = {col: float(df[CLASSIFICATION_FEATURES].iloc[0][col]) for col in CLASSIFICATION_FEATURES}
    result = predict_fault(sample)
    print(f"Sample fault prediction: {result}")

    pwr = predict_power(wind_speed=10, rpm=18, pitch_angle=2)
    print(f"Expected power at 10 m/s wind: {pwr} kW")

    print("\n[✓] All models trained and saved!")
