"""
MODULE 1: Wind Turbine Data Pipeline
======================================
Handles data generation, cleaning, feature extraction,
and storage for wind turbine sensor data.

Sensors Simulated:
  - Wind Speed (m/s)
  - Rotor RPM
  - Power Output (kW)
  - Blade Vibration (mm/s)
  - Gearbox Temperature (°C)
  - Generator Temperature (°C)
  - Nacelle Temperature (°C)
  - Pitch Angle (degrees)
"""

import pandas as pd
import numpy as np
from scipy.fft import fft
from scipy.stats import kurtosis, skew
import sqlite3
from datetime import datetime, timedelta

# ─────────────────────────────────────────
# 1. GENERATE SYNTHETIC WIND TURBINE DATA
# ─────────────────────────────────────────
def generate_turbine_data(rows=20000, turbine_count=5):
    """
    Generate synthetic wind turbine sensor data.
    Simulates realistic degradation and fault conditions.
    """
    np.random.seed(42)
    all_data = []

    for turbine_id in range(1, turbine_count + 1):
        t = np.linspace(0, 100, rows)

        # Simulate degradation pattern for some turbines
        if turbine_id in [3, 5]:
            degradation = 1 + (t / 100) ** 2.5   # Faulty turbines
        else:
            degradation = 1 + (t / 100) * 0.1    # Healthy turbines

        # Wind speed follows Weibull distribution (realistic)
        wind_speed = np.random.weibull(2, rows) * 8 + np.random.normal(0, 0.5, rows)
        wind_speed = np.clip(wind_speed, 0, 25)

        # Rotor RPM proportional to wind speed
        rpm = wind_speed * 1.8 + np.random.normal(0, 0.3, rows) * degradation
        rpm = np.clip(rpm, 0, 30)

        # Power output (cubic relationship with wind speed)
        rated_power = 2000  # kW
        power = np.where(
            wind_speed < 3, 0,
            np.where(wind_speed > 12, rated_power,
                     rated_power * ((wind_speed - 3) / 9) ** 3)
        ) + np.random.normal(0, 20, rows)
        power = np.clip(power, 0, rated_power)

        # Blade vibration increases with degradation
        blade_vibration = (0.5 + np.sin(2 * np.pi * 0.1 * t) * 0.2) * degradation + \
                          np.random.normal(0, 0.1, rows)
        blade_vibration = np.abs(blade_vibration)

        # Temperatures
        gearbox_temp   = 45 + wind_speed * 0.8 + degradation * 5 + np.random.normal(0, 1.5, rows)
        generator_temp = 55 + power * 0.01 + degradation * 4 + np.random.normal(0, 1.5, rows)
        nacelle_temp   = 35 + wind_speed * 0.3 + np.random.normal(0, 1, rows)

        # Pitch angle (adjusts to wind speed)
        pitch_angle = np.where(wind_speed < 12, 0, (wind_speed - 12) * 3)
        pitch_angle = np.clip(pitch_angle + np.random.normal(0, 0.5, rows), 0, 90)

        timestamps = [datetime(2024, 1, 1) + timedelta(seconds=i * 10)
                      for i in range(rows)]

        df = pd.DataFrame({
            'turbine_id':       [f'T{turbine_id:02d}'] * rows,
            'timestamp':        timestamps,
            'wind_speed':       np.round(wind_speed, 3),
            'rotor_rpm':        np.round(rpm, 3),
            'power_output':     np.round(power, 2),
            'blade_vibration':  np.round(blade_vibration, 4),
            'gearbox_temp':     np.round(gearbox_temp, 2),
            'generator_temp':   np.round(generator_temp, 2),
            'nacelle_temp':     np.round(nacelle_temp, 2),
            'pitch_angle':      np.round(pitch_angle, 2),
        })
        all_data.append(df)

    full_df = pd.concat(all_data, ignore_index=True)
    print(f"[✓] Generated {len(full_df)} rows for {turbine_count} turbines")
    return full_df


# ─────────────────────────────────────────
# 2. CLEAN DATA
# ─────────────────────────────────────────
def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna()
    numeric_cols = ['wind_speed','rotor_rpm','power_output','blade_vibration',
                    'gearbox_temp','generator_temp','nacelle_temp','pitch_angle']
    for col in numeric_cols:
        lower = df[col].quantile(0.005)
        upper = df[col].quantile(0.995)
        df[col] = df[col].clip(lower, upper)
    print(f"[✓] Cleaned data: {len(df)} rows")
    return df


# ─────────────────────────────────────────
# 3. FEATURE EXTRACTION
# ─────────────────────────────────────────
def extract_features(df: pd.DataFrame, window_size=500, step=250) -> pd.DataFrame:
    """Extract statistical and frequency features using sliding windows."""
    all_features = []
    turbines = df['turbine_id'].unique()

    for turbine in turbines:
        tdf = df[df['turbine_id'] == turbine].reset_index(drop=True)

        for start in range(0, len(tdf) - window_size, step):
            end = start + window_size
            window = tdf.iloc[start:end]

            vib = window['blade_vibration'].values
            fft_vals = np.abs(fft(vib))[:len(vib)//2]

            feat = {
                'turbine_id':    turbine,
                'timestamp':     str(window['timestamp'].iloc[0]),

                # Wind & power
                'wind_speed_mean':  window['wind_speed'].mean(),
                'wind_speed_std':   window['wind_speed'].std(),
                'power_mean':       window['power_output'].mean(),
                'power_std':        window['power_output'].std(),
                'capacity_factor':  window['power_output'].mean() / 2000,

                # Mechanical
                'rpm_mean':         window['rotor_rpm'].mean(),
                'rpm_std':          window['rotor_rpm'].std(),
                'pitch_mean':       window['pitch_angle'].mean(),

                # Vibration features
                'vib_rms':          np.sqrt(np.mean(vib**2)),
                'vib_kurtosis':     kurtosis(vib),
                'vib_crest':        np.max(np.abs(vib)) / (np.sqrt(np.mean(vib**2)) + 1e-9),
                'vib_fft_energy':   np.sum(fft_vals**2),
                'vib_peak_freq':    np.fft.rfftfreq(len(vib))[np.argmax(fft_vals)],

                # Temperatures
                'gearbox_temp_mean':   window['gearbox_temp'].mean(),
                'gearbox_temp_max':    window['gearbox_temp'].max(),
                'generator_temp_mean': window['generator_temp'].mean(),
                'generator_temp_max':  window['generator_temp'].max(),
                'nacelle_temp_mean':   window['nacelle_temp'].mean(),

                # Derived
                'power_per_wind':   window['power_output'].mean() / (window['wind_speed'].mean()**3 + 1e-9),
            }
            all_features.append(feat)

    feature_df = pd.DataFrame(all_features)
    print(f"[✓] Extracted {len(feature_df)} feature windows across {len(turbines)} turbines")
    return feature_df


# ─────────────────────────────────────────
# 4. LABEL HEALTH STATUS
# ─────────────────────────────────────────
def label_health(df: pd.DataFrame) -> pd.DataFrame:
    """
    Label each window with health status based on multiple sensor thresholds.
    0 = Normal, 1 = Warning, 2 = Critical
    """
    def assign_label(row):
        score = 0
        if row['vib_rms'] > 1.5:          score += 2
        elif row['vib_rms'] > 0.8:        score += 1
        if row['gearbox_temp_max'] > 80:   score += 2
        elif row['gearbox_temp_max'] > 65: score += 1
        if row['generator_temp_max'] > 90: score += 2
        elif row['generator_temp_max'] > 75: score += 1
        if row['vib_kurtosis'] > 5:        score += 1
        if row['rpm_std'] > 3:             score += 1

        if score >= 4:   return 2   # Critical
        elif score >= 2: return 1   # Warning
        else:            return 0   # Normal

    df['label'] = df.apply(assign_label, axis=1)
    print(f"[✓] Label distribution:\n{df['label'].value_counts().to_string()}")
    return df


# ─────────────────────────────────────────
# 5. STORE TO DATABASE
# ─────────────────────────────────────────
def store_to_db(df: pd.DataFrame, db_path='turbine_data.db'):
    conn = sqlite3.connect(db_path)
    df.to_sql('features', conn, if_exists='replace', index=False)
    conn.close()
    print(f"[✓] Stored {len(df)} records to {db_path}")


# ─────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 55)
    print("  WIND TURBINE MANAGEMENT — DATA PIPELINE")
    print("=" * 55)

    raw_df     = generate_turbine_data(rows=20000, turbine_count=5)
    clean_df   = clean_data(raw_df)
    feature_df = extract_features(clean_df, window_size=500, step=250)
    labeled_df = label_health(feature_df)
    store_to_db(labeled_df, 'turbine_data.db')

    print("\n[✓] Pipeline complete! turbine_data.db created.")
    print(labeled_df.head(3).to_string())
