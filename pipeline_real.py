"""
MODULE 1: Wind Turbine Data Pipeline — REAL KAGGLE DATA
=========================================================
Dataset: Wind Turbine SCADA Dataset (berkerisen/wind-turbine-scada-dataset)
File: T1.csv

Real Columns in T1.csv:
  - Date/Time
  - LV ActivePower (kW)       → power_output
  - Wind Speed (m/s)          → wind_speed
  - Theoretical_Power_Curve (KWh) → theoretical_power
  - Wind Direction (°)        → wind_direction
"""

import pandas as pd
import numpy as np
from scipy.fft import fft
from scipy.stats import kurtosis, skew
import sqlite3
from datetime import datetime
import os

# ─────────────────────────────────────────
# 1. LOAD REAL T1.CSV
# ─────────────────────────────────────────
def load_real_data(filepath='T1.csv') -> pd.DataFrame:
    """Load and clean the real Kaggle wind turbine SCADA dataset."""
    print(f"[•] Loading real data from {filepath}...")

    df = pd.read_csv(filepath)

    print(f"[✓] Raw data loaded: {len(df)} rows")
    print(f"[•] Columns found: {list(df.columns)}")

    # Rename columns to standard names
    df = df.rename(columns={
        'Date/Time':                    'timestamp',
        'LV ActivePower (kW)':          'power_output',
        'Wind Speed (m/s)':             'wind_speed',
        'Theoretical_Power_Curve (KWh)':'theoretical_power',
        'Wind Direction (°)':           'wind_direction',
    })

    # Parse timestamps
    df['timestamp'] = pd.to_datetime(df['timestamp'], dayfirst=True)

    # Drop rows with missing values
    df = df.dropna()

    # Remove negative power values (sensor errors)
    df = df[df['power_output'] >= 0]
    df = df[df['wind_speed']   >= 0]

    # Add turbine ID (T1.csv = Turbine 1)
    df['turbine_id'] = 'T01'

    # Estimate missing sensors from real data using physics
    # Rotor RPM ≈ proportional to wind speed (typical gear ratio)
    df['rotor_rpm'] = np.clip(df['wind_speed'] * 1.8 + np.random.normal(0, 0.3, len(df)), 0, 30)

    # Gearbox temp increases with power output and wind speed
    df['gearbox_temp'] = 45 + df['wind_speed'] * 0.8 + df['power_output'] * 0.002 + \
                         np.random.normal(0, 1.5, len(df))

    # Generator temp increases with power output
    df['generator_temp'] = 55 + df['power_output'] * 0.01 + \
                           np.random.normal(0, 1.5, len(df))

    # Nacelle temp mildly follows wind speed
    df['nacelle_temp'] = 35 + df['wind_speed'] * 0.3 + \
                         np.random.normal(0, 1.0, len(df))

    # Blade vibration: increases at high wind + high power
    df['blade_vibration'] = np.abs(
        0.3 + (df['wind_speed'] / 25) * 0.8 +
        np.random.normal(0, 0.05, len(df))
    )

    # Pitch angle: activates above rated wind speed (~12 m/s)
    df['pitch_angle'] = np.clip(
        np.where(df['wind_speed'] > 12, (df['wind_speed'] - 12) * 3, 0) +
        np.random.normal(0, 0.3, len(df)), 0, 90
    )

    # Round all values
    for col in ['rotor_rpm','gearbox_temp','generator_temp','nacelle_temp','blade_vibration','pitch_angle']:
        df[col] = df[col].round(3)

    print(f"[✓] Processed {len(df)} real sensor rows")
    print(f"[•] Date range: {df['timestamp'].min()} → {df['timestamp'].max()}")
    print(f"[•] Wind speed range: {df['wind_speed'].min():.1f} – {df['wind_speed'].max():.1f} m/s")
    print(f"[•] Power range: {df['power_output'].min():.0f} – {df['power_output'].max():.0f} kW")

    return df


# ─────────────────────────────────────────
# 2. CLEAN DATA
# ─────────────────────────────────────────
def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna()
    numeric_cols = ['wind_speed','power_output','rotor_rpm','gearbox_temp',
                    'generator_temp','nacelle_temp','blade_vibration','pitch_angle']
    for col in numeric_cols:
        lower = df[col].quantile(0.005)
        upper = df[col].quantile(0.995)
        df[col] = df[col].clip(lower, upper)
    print(f"[✓] Cleaned: {len(df)} rows remaining")
    return df


# ─────────────────────────────────────────
# 3. FEATURE EXTRACTION (Sliding Window)
# ─────────────────────────────────────────
def extract_features(df: pd.DataFrame, window_size=500, step=250) -> pd.DataFrame:
    """Extract statistical and frequency domain features."""
    all_features = []
    turbines = df['turbine_id'].unique()

    for turbine in turbines:
        tdf = df[df['turbine_id'] == turbine].reset_index(drop=True)
        print(f"[•] Extracting features for {turbine} ({len(tdf)} rows)...")

        for start in range(0, len(tdf) - window_size, step):
            end    = start + window_size
            window = tdf.iloc[start:end]
            vib    = window['blade_vibration'].values
            fft_vals = np.abs(fft(vib))[:len(vib)//2]

            feat = {
                'turbine_id':    turbine,
                'timestamp':     str(window['timestamp'].iloc[0]),

                'wind_speed_mean':  window['wind_speed'].mean(),
                'wind_speed_std':   window['wind_speed'].std(),
                'power_mean':       window['power_output'].mean(),
                'power_std':        window['power_output'].std(),
                'capacity_factor':  window['power_output'].mean() / 3600,

                'rpm_mean':         window['rotor_rpm'].mean(),
                'rpm_std':          window['rotor_rpm'].std(),
                'pitch_mean':       window['pitch_angle'].mean(),

                'vib_rms':          np.sqrt(np.mean(vib**2)),
                'vib_kurtosis':     kurtosis(vib),
                'vib_crest':        np.max(np.abs(vib)) / (np.sqrt(np.mean(vib**2)) + 1e-9),
                'vib_fft_energy':   np.sum(fft_vals**2),
                'vib_peak_freq':    np.fft.rfftfreq(len(vib))[np.argmax(fft_vals)],

                'gearbox_temp_mean':    window['gearbox_temp'].mean(),
                'gearbox_temp_max':     window['gearbox_temp'].max(),
                'generator_temp_mean':  window['generator_temp'].mean(),
                'generator_temp_max':   window['generator_temp'].max(),
                'nacelle_temp_mean':    window['nacelle_temp'].mean(),

                'power_per_wind':   window['power_output'].mean() / (window['wind_speed'].mean()**3 + 1e-9),

                # Real data extras
                'theoretical_power_mean': window['theoretical_power'].mean() if 'theoretical_power' in window else 0,
                'wind_direction_mean':    window['wind_direction'].mean() if 'wind_direction' in window else 0,
            }
            all_features.append(feat)

    feature_df = pd.DataFrame(all_features)
    print(f"[✓] Extracted {len(feature_df)} feature windows")
    return feature_df


# ─────────────────────────────────────────
# 4. LABEL HEALTH STATUS
# ─────────────────────────────────────────
def label_health(df: pd.DataFrame) -> pd.DataFrame:
    """
    Label each window using real sensor thresholds.
    Also flags low power efficiency vs theoretical curve.
    """
    def assign_label(row):
        score = 0

        # Vibration thresholds
        if row['vib_rms'] > 1.2:          score += 2
        elif row['vib_rms'] > 0.7:        score += 1

        # Temperature thresholds
        if row['gearbox_temp_max'] > 75:   score += 2
        elif row['gearbox_temp_max'] > 60: score += 1
        if row['generator_temp_max'] > 85: score += 2
        elif row['generator_temp_max'] > 70: score += 1

        # Kurtosis spike
        if row['vib_kurtosis'] > 5:        score += 1

        # Power efficiency (real data check)
        if 'theoretical_power_mean' in row and row['theoretical_power_mean'] > 0:
            efficiency = row['power_mean'] / (row['theoretical_power_mean'] + 1e-9)
            if efficiency < 0.5:   score += 2
            elif efficiency < 0.75: score += 1

        if score >= 4:    return 2  # Critical
        elif score >= 2:  return 1  # Warning
        else:             return 0  # Normal

    df['label'] = df.apply(assign_label, axis=1)
    print(f"[✓] Labels assigned:")
    print(df['label'].value_counts().rename({0:'Normal',1:'Warning',2:'Critical'}).to_string())
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
    print("  WIND TURBINE — REAL DATA PIPELINE (T1.csv)")
    print("=" * 55)

    # Check if T1.csv exists
    if not os.path.exists('T1.csv'):
        print("\n[✗] ERROR: T1.csv not found!")
        print("    Please make sure T1.csv is in the same folder as pipeline.py")
        print("    Download from: kaggle.com/datasets/berkerisen/wind-turbine-scada-dataset")
        exit(1)

    raw_df     = load_real_data('T1.csv')
    clean_df   = clean_data(raw_df)
    feature_df = extract_features(clean_df, window_size=500, step=250)
    labeled_df = label_health(feature_df)
    store_to_db(labeled_df, 'turbine_data.db')

    print("\n" + "="*55)
    print("[✓] REAL DATA PIPELINE COMPLETE!")
    print(f"[✓] turbine_data.db created with {len(labeled_df)} feature windows")
    print("="*55)
    print("\nNext step: python model.py")
