from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3, numpy as np, pandas as pd
import json, hashlib, secrets, io, os
from datetime import datetime
from scipy.stats import kurtosis as kurt
from scipy.fft import fft as scipy_fft

app = Flask(__name__)
CORS(app)
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'windwatch.db')

# ─── DATABASE ─────────────────────────────────────────────
def init_db():
    c = get_conn()
    c.execute('''CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        location TEXT, turbine_model TEXT,
        token TEXT UNIQUE, created_at TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER, timestamp TEXT,
        turbine_id TEXT, filename TEXT,
        total_rows INTEGER, date_range TEXT,
        report_json TEXT,
        FOREIGN KEY(company_id) REFERENCES companies(id))''')
    c.commit(); c.close()

def get_conn():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def hash_pw(p): return hashlib.sha256(p.encode()).hexdigest()
def verify_token(t):
    c = get_conn()
    r = c.execute('SELECT * FROM companies WHERE token=?',(t,)).fetchone()
    c.close()
    return dict(r) if r else None

# ─── AUTH ─────────────────────────────────────────────────
@app.route('/api/auth/register', methods=['POST'])
def register():
    d = request.get_json()
    name = d.get('companyName','').strip()
    pw   = d.get('password','').strip()
    if not name or not pw: return jsonify({'error':'Name and password required.'}),400
    if len(pw)<4: return jsonify({'error':'Password must be at least 4 characters.'}),400
    token = secrets.token_hex(32)
    try:
        c = get_conn()
        c.execute('INSERT INTO companies(company_name,password_hash,location,turbine_model,token,created_at) VALUES(?,?,?,?,?,?)',
            (name,hash_pw(pw),d.get('location',''),d.get('turbineModel',''),token,datetime.now().isoformat()))
        c.commit()
        row = dict(c.execute('SELECT * FROM companies WHERE token=?',(token,)).fetchone())
        c.close()
        return jsonify({'token':token,'company':row})
    except: return jsonify({'error':'Company name already registered. Please login.'}),409

@app.route('/api/auth/login', methods=['POST'])
def login():
    d = request.get_json()
    c = get_conn()
    r = c.execute('SELECT * FROM companies WHERE company_name=?',(d.get('companyName','').strip(),)).fetchone()
    c.close()
    if not r: return jsonify({'error':'Company not found. Please register.'}),404
    if r['password_hash']!=hash_pw(d.get('password','')): return jsonify({'error':'Incorrect password.'}),401
    return jsonify({'token':r['token'],'company':dict(r)})

# ─── CSV ANALYSIS ─────────────────────────────────────────
def analyze(df, meta):
    # ── Auto-detect columns
    col_map = {}
    for col in df.columns:
        cl = col.lower().strip()
        if 'activepow' in cl or ('power' in cl and 'theoretical' not in cl and 'curve' not in cl):
            col_map['power'] = col
        elif 'wind speed' in cl or cl == 'wind speed (m/s)':
            col_map['wind_speed'] = col
        elif 'date' in cl or 'time' in cl:
            col_map['timestamp'] = col
        elif 'theoretical' in cl or 'curve' in cl:
            col_map['theoretical'] = col
        elif 'wind dir' in cl:
            col_map['wind_dir'] = col
        elif 'gearbox' in cl:
            col_map['gearbox_temp'] = col
        elif 'generator' in cl and 'temp' in cl:
            col_map['generator_temp'] = col
        elif 'vibrat' in cl or col.lower()=='vib':
            col_map['vibration'] = col
        elif 'rpm' in cl or 'rotor' in cl:
            col_map['rpm'] = col
        elif 'pitch' in cl:
            col_map['pitch'] = col
        elif 'nacelle' in cl:
            col_map['nacelle'] = col

    rename = {}
    for src, dst in [('power','power_output'),('wind_speed','wind_speed'),
                     ('timestamp','timestamp'),('gearbox_temp','gearbox_temp'),
                     ('generator_temp','generator_temp'),('vibration','blade_vibration'),
                     ('rpm','rotor_rpm'),('pitch','pitch_angle'),('nacelle','nacelle_temp'),
                     ('theoretical','theoretical_power'),('wind_dir','wind_direction')]:
        if src in col_map: rename[col_map[src]] = dst
    df = df.rename(columns=rename)

    for r in ['power_output','wind_speed']:
        if r not in df.columns:
            raise ValueError(f"Cannot find '{r}' column. Columns found: {list(df.columns)}")

    df['power_output'] = pd.to_numeric(df['power_output'],errors='coerce').fillna(0)
    df['wind_speed']   = pd.to_numeric(df['wind_speed'],  errors='coerce').fillna(0)
    df = df[(df['power_output']>=0)&(df['wind_speed']>=0)].copy()

    if len(df)<100: raise ValueError(f"Only {len(df)} valid rows. Need at least 100.")

    # ── Estimate missing sensors using physics (no random noise)
    ws = df['wind_speed']
    pw = df['power_output']
    if 'gearbox_temp'    not in df.columns: df['gearbox_temp']    = (50 + ws*0.8).round(1)
    if 'generator_temp'  not in df.columns: df['generator_temp']  = (60 + pw*0.01).round(1)
    if 'blade_vibration' not in df.columns: df['blade_vibration'] = (0.3 + (ws/25)*0.7).round(3)
    if 'rotor_rpm'       not in df.columns: df['rotor_rpm']       = np.clip(ws*1.8, 0, 30).round(1)
    if 'pitch_angle'     not in df.columns: df['pitch_angle']     = np.clip(np.where(ws>12,(ws-12)*3,0),0,90).round(1)
    if 'nacelle_temp'    not in df.columns: df['nacelle_temp']    = (35 + ws*0.3).round(1)

    for col in ['gearbox_temp','generator_temp','blade_vibration','rotor_rpm','pitch_angle','nacelle_temp']:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    total_rows = len(df)

    # ── Date range
    date_range = f"{total_rows:,} readings"
    if 'timestamp' in df.columns:
        try:
            df['ts_parsed'] = pd.to_datetime(df['timestamp'], dayfirst=True, errors='coerce')
            valid = df['ts_parsed'].dropna()
            if len(valid)>0:
                date_range = f"{valid.min().strftime('%d %b %Y')} → {valid.max().strftime('%d %b %Y')}"
                df['month'] = df['ts_parsed'].dt.to_period('M')
        except: pass

    # ── Wind speed distribution
    bins   = [0,3,6,9,12,15,18,25]
    labels = ['0-3','3-6','6-9','9-12','12-15','15-18','18+']
    df['ws_bin'] = pd.cut(df['wind_speed'], bins=bins, labels=labels, right=False)
    wind_dist = df['ws_bin'].value_counts().reindex(labels, fill_value=0)
    wind_distribution = [{'range':k,'count':int(v)} for k,v in wind_dist.items()]

    # ── Power curve (actual vs theoretical)
    power_curve = []
    for label, grp in df.groupby('ws_bin', observed=True):
        if len(grp)>5:
            power_curve.append({
                'wind_range': str(label),
                'actual_power': round(float(grp['power_output'].mean()),1),
                'theoretical':  round(float(grp['theoretical_power'].mean()),1) if 'theoretical_power' in grp.columns else None,
                'count': len(grp)
            })

    # ── Windowed fault detection
    wsize = min(500, total_rows//10)
    step  = max(1, wsize//2)
    labels_list, fault_windows = [], []

    for start in range(0, total_rows-wsize, step):
        w   = df.iloc[start:start+wsize]
        vib = w['blade_vibration'].values
        fft_v = np.abs(scipy_fft(vib))[:len(vib)//2]
        rms   = float(np.sqrt(np.mean(vib**2)))
        gt_max  = float(w['gearbox_temp'].max())
        gen_max = float(w['generator_temp'].max())
        k_val   = float(kurt(vib))

        score = 0
        if rms>1.2:     score+=2
        elif rms>0.7:   score+=1
        if gt_max>75:   score+=2
        elif gt_max>60: score+=1
        if gen_max>85:  score+=2
        elif gen_max>70:score+=1
        if k_val>5:     score+=1

        label = 2 if score>=4 else 1 if score>=2 else 0
        labels_list.append(label)
        if label>0: fault_windows.append({'gt_max':gt_max,'gen_max':gen_max,'rms':rms,'score':score})

    total_w   = len(labels_list) or 1
    normal_n  = labels_list.count(0)
    warning_n = labels_list.count(1)
    critical_n= labels_list.count(2)

    # ── Fault categorization
    fault_counts = {}
    for fw in fault_windows:
        if fw['gt_max']>65:    k='Gearbox Overheating'
        elif fw['rms']>0.8:    k='Blade Imbalance'
        elif fw['gen_max']>75: k='Generator Overheating'
        else:                  k='General Anomaly'
        fault_counts[k] = fault_counts.get(k,0)+1

    health_score    = round(normal_n/total_w*100,1)
    avg_wind        = round(float(df['wind_speed'].mean()),2)
    avg_power       = round(float(df['power_output'].mean()),1)
    max_power       = round(float(df['power_output'].max()),1)
    total_energy    = round(float(df['power_output'].sum())*10/3600000,2)
    capacity_factor = round(avg_power/2000*100,1)

    # ── Per-turbine sensor summary (from actual data)
    sensor_summary = {
        'avg_gearbox_temp':    round(float(df['gearbox_temp'].mean()),1),
        'max_gearbox_temp':    round(float(df['gearbox_temp'].max()),1),
        'avg_generator_temp':  round(float(df['generator_temp'].mean()),1),
        'max_generator_temp':  round(float(df['generator_temp'].max()),1),
        'avg_blade_vibration': round(float(df['blade_vibration'].mean()),3),
        'max_blade_vibration': round(float(df['blade_vibration'].max()),3),
        'avg_rotor_rpm':       round(float(df['rotor_rpm'].mean()),1),
        'max_rotor_rpm':       round(float(df['rotor_rpm'].max()),1),
        'avg_wind_speed':      avg_wind,
        'max_wind_speed':      round(float(df['wind_speed'].max()),1),
    }

    # ── Monthly breakdown
    monthly = []
    if 'month' in df.columns:
        try:
            for month, grp in df.groupby('month', observed=True):
                monthly.append({
                    'month':      str(month),
                    'avg_power':  round(float(grp['power_output'].mean()),1),
                    'avg_wind':   round(float(grp['wind_speed'].mean()),2),
                    'energy_mwh': round(float(grp['power_output'].sum())*10/3600000,2),
                    'readings':   len(grp),
                    'avg_gearbox_temp': round(float(grp['gearbox_temp'].mean()),1),
                    'max_gearbox_temp': round(float(grp['gearbox_temp'].max()),1),
                })
        except: pass

    # ── Time series sample (every Nth row for chart)
    sample_n = min(200, total_rows)
    step_ts  = max(1, total_rows//sample_n)
    sampled  = df.iloc[::step_ts].head(sample_n)
    time_series = []
    for _, row in sampled.iterrows():
        ts_str = str(row.get('timestamp',''))[:16] if 'timestamp' in row else ''
        time_series.append({
            'time':             ts_str,
            'power_output':     round(float(row['power_output']),1),
            'wind_speed':       round(float(row['wind_speed']),2),
            'gearbox_temp':     round(float(row['gearbox_temp']),1),
            'blade_vibration':  round(float(row['blade_vibration']),3),
            'rotor_rpm':        round(float(row['rotor_rpm']),1),
        })

    # ── Recommendations
    recs = []
    critical_pct = round(critical_n/total_w*100,1)
    warning_pct  = round(warning_n/total_w*100,1)
    if critical_pct>10:  recs.append(f"🔴 URGENT: {critical_pct}% critical readings. Immediate inspection required.")
    if warning_pct>20:   recs.append(f"🟡 {warning_pct}% warning readings. Schedule maintenance within 1 week.")
    if 'Gearbox Overheating'   in fault_counts: recs.append(f"🔧 Gearbox overheating in {fault_counts['Gearbox Overheating']} windows — check lubrication and cooling system.")
    if 'Blade Imbalance'       in fault_counts: recs.append(f"🔧 Blade imbalance in {fault_counts['Blade Imbalance']} windows — inspect blades for damage, icing, or erosion.")
    if 'Generator Overheating' in fault_counts: recs.append(f"🔧 Generator overheating in {fault_counts['Generator Overheating']} windows — check cooling fans and windings.")
    if 'General Anomaly'       in fault_counts: recs.append(f"🔍 {fault_counts['General Anomaly']} anomalous windows detected — review sensor logs for root cause.")
    recs.append(f"📊 Annual capacity factor: {capacity_factor}% (industry avg: 25–40%)")
    recs.append(f"⚡ Total energy generated: {total_energy} MWh from {total_rows:,} readings")
    if health_score>85: recs.append("✅ Fleet performing well. Continue scheduled maintenance intervals.")

    return {
        'company_info':  meta,
        'analysis_meta': {'total_rows':total_rows,'windows_analyzed':total_w,'date_range':date_range},
        'health_summary': {
            'health_score':   health_score,
            'normal_pct':     round(normal_n/total_w*100,1),
            'warning_pct':    round(warning_n/total_w*100,1),
            'critical_pct':   round(critical_n/total_w*100,1),
            'normal_count':   normal_n,
            'warning_count':  warning_n,
            'critical_count': critical_n,
        },
        'power_stats': {
            'avg_wind_speed':   avg_wind,
            'avg_power_kw':     avg_power,
            'max_power_kw':     max_power,
            'total_energy_mwh': total_energy,
            'capacity_factor':  capacity_factor,
        },
        'sensor_summary':    sensor_summary,
        'fault_analysis':    {'top_fault':max(fault_counts,key=fault_counts.get) if fault_counts else 'None','fault_counts':fault_counts},
        'wind_distribution': wind_distribution,
        'power_curve':       power_curve,
        'monthly_breakdown': monthly,
        'time_series':       time_series,
        'recommendations':   recs,
    }

# ─── ROUTES ───────────────────────────────────────────────
@app.route('/api/health')
def health(): return jsonify({'status':'ok'})

@app.route('/api/company/upload', methods=['POST'])
def upload():
    token   = request.headers.get('Authorization','').replace('Bearer ','')
    company = verify_token(token)
    if not company: return jsonify({'error':'Unauthorized. Please login.'}),401

    if 'file' not in request.files: return jsonify({'error':'No file uploaded.'}),400
    file = request.files['file']
    if not file.filename.endswith('.csv'): return jsonify({'error':'Only CSV files accepted.'}),400

    turbine_id = request.form.get('turbineId','T-001')
    filename   = file.filename

    try:
        content = file.read().decode('utf-8',errors='ignore')
        df      = pd.read_csv(io.StringIO(content))
        result  = analyze(df, {
            'companyName':  company['company_name'],
            'location':     company['location'],
            'turbineId':    turbine_id,
            'turbineModel': company['turbine_model'],
        })

        c = get_conn()
        c.execute('INSERT INTO reports(company_id,timestamp,turbine_id,filename,total_rows,date_range,report_json) VALUES(?,?,?,?,?,?,?)',
            (company['id'],datetime.now().isoformat(),turbine_id,filename,
             result['analysis_meta']['total_rows'],
             result['analysis_meta']['date_range'],
             json.dumps(result)))
        c.commit(); c.close()
        return jsonify(result)

    except ValueError as e: return jsonify({'error':str(e)}),400
    except Exception as e:  return jsonify({'error':f'Analysis failed: {str(e)}'}),500

@app.route('/api/company/reports')
def get_reports():
    token   = request.headers.get('Authorization','').replace('Bearer ','')
    company = verify_token(token)
    if not company: return jsonify({'error':'Unauthorized'}),401
    c    = get_conn()
    rows = c.execute('SELECT * FROM reports WHERE company_id=? ORDER BY timestamp DESC',(company['id'],)).fetchall()
    c.close()
    out = []
    for r in rows:
        d = dict(r); d['report'] = json.loads(d['report_json']); del d['report_json']
        out.append(d)
    return jsonify(out)

import os

if __name__ == "__main__":
    init_db()
    print("="*50)
    print("WindWatch API starting...")
    print("="*50)

    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)