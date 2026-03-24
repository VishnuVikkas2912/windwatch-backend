import { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";

// Change this to your deployed backend URL if not running locally
const API = "http://localhost:5000/api";

const getToken  = () => sessionStorage.getItem('ww_token');
const setToken  = t  => sessionStorage.setItem('ww_token', t);
const clearToken= () => sessionStorage.removeItem('ww_token');
const authHdr   = () => ({ Authorization: `Bearer ${getToken()}` });

// ─── PDF ──────────────────────────────────────────────────
function downloadPDF(result, onDone) {
  const existing = document.getElementById('jspdf-script');
  const run = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W=210, M=15; let y=20;
    const ci=result.company_info, hs=result.health_summary,
          ps=result.power_stats,  fa=result.fault_analysis, am=result.analysis_meta,
          ss=result.sensor_summary;
    const now = new Date().toLocaleString();

    // Header
    doc.setFillColor(15,23,42); doc.rect(0,0,W,38,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(22); doc.setFont('helvetica','bold'); doc.text('WindWatch',M,15);
    doc.setFontSize(11); doc.setFont('helvetica','normal'); doc.text('Annual Wind Turbine Health Analysis Report',M,23);
    doc.setFontSize(8); doc.text(`${ci.companyName} | Turbine: ${ci.turbineId} | Generated: ${now}`,M,31);
    y=46;

    // Company box
    doc.setFillColor(241,245,249); doc.roundedRect(M,y,W-M*2,18,3,3,'F');
    doc.setTextColor(30,41,59); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text(`Company: ${ci.companyName}`,M+4,y+6); doc.text(`Location: ${ci.location||'—'}`,M+80,y+6); doc.text(`Model: ${ci.turbineModel||'—'}`,M+155,y+6);
    doc.text(`Period: ${am.date_range}`,M+4,y+13); doc.text(`Total readings: ${am.total_rows?.toLocaleString()}`,M+80,y+13);
    y+=25;

    // Health banner
    const hc=hs.health_score>=80?[34,197,94]:hs.health_score>=60?[245,158,11]:[239,68,68];
    doc.setFillColor(...hc); doc.roundedRect(M,y,W-M*2,20,3,3,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.text(`Health Score: ${hs.health_score}%`,M+6,y+9);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text(`Normal: ${hs.normal_pct}%   Warning: ${hs.warning_pct}%   Critical: ${hs.critical_pct}%`,M+6,y+16);
    y+=27;

    // Power stats
    doc.setTextColor(30,41,59); doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.text('Power Statistics',M,y); y+=7;
    doc.setFillColor(241,245,249); doc.roundedRect(M,y,W-M*2,20,3,3,'F');
    [['Avg Wind',`${ps.avg_wind_speed} m/s`],['Avg Power',`${ps.avg_power_kw} kW`],
     ['Peak Power',`${ps.max_power_kw} kW`],['Total Energy',`${ps.total_energy_mwh} MWh`],['Capacity',`${ps.capacity_factor}%`]
    ].forEach(([l,v],i)=>{
      const x=M+5+(i*37);
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139); doc.text(l,x,y+7);
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(30,41,59); doc.text(v,x,y+15);
    });
    y+=27;

    // Sensor summary
    doc.setTextColor(30,41,59); doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.text('Sensor Summary',M,y); y+=7;
    doc.setFillColor(241,245,249); doc.roundedRect(M,y,W-M*2,20,3,3,'F');
    [['Avg Gearbox Temp',`${ss?.avg_gearbox_temp}°C`],['Max Gearbox Temp',`${ss?.max_gearbox_temp}°C`],
     ['Avg Vibration',`${ss?.avg_blade_vibration} mm/s`],['Max Vibration',`${ss?.max_blade_vibration} mm/s`],['Avg RPM',`${ss?.avg_rotor_rpm}`]
    ].forEach(([l,v],i)=>{
      const x=M+5+(i*37);
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139); doc.text(l,x,y+7);
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(30,41,59); doc.text(v,x,y+15);
    });
    y+=27;

    // Faults
    doc.setTextColor(30,41,59); doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.text('Fault Analysis',M,y); y+=7;
    const faults=Object.entries(fa.fault_counts||{});
    if(!faults.length){
      doc.setFillColor(220,252,231); doc.roundedRect(M,y,W-M*2,10,2,2,'F');
      doc.setTextColor(21,128,61); doc.setFontSize(9); doc.text('✓ No faults detected.',M+4,y+7); y+=16;
    } else {
      faults.forEach(([f,cnt])=>{
        doc.setFillColor(254,243,199); doc.roundedRect(M,y,W-M*2,9,2,2,'F');
        doc.setTextColor(146,64,14); doc.setFontSize(9); doc.setFont('helvetica','normal');
        doc.text(`⚠ ${f}: ${cnt} analysis windows`,M+4,y+6); y+=11;
      }); y+=4;
    }

    // Monthly table
    if(result.monthly_breakdown?.length>0){
      if(y>215){doc.addPage();y=20;}
      doc.setTextColor(30,41,59); doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.text('Monthly Breakdown',M,y); y+=7;
      doc.setFillColor(15,23,42); doc.rect(M,y,W-M*2,8,'F');
      doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','bold');
      ['Month','Avg Power (kW)','Avg Wind (m/s)','Energy (MWh)','Gearbox Avg °C','Readings'].forEach((h,i)=>doc.text(h,M+3+i*((W-M*2)/6),y+5.5));
      y+=8;
      result.monthly_breakdown.forEach((m,idx)=>{
        if(y>270){doc.addPage();y=20;}
        doc.setFillColor(idx%2===0?248:241,idx%2===0?250:245,idx%2===0?252:249);
        doc.rect(M,y,W-M*2,8,'F');
        doc.setTextColor(30,41,59); doc.setFontSize(8); doc.setFont('helvetica','normal');
        [m.month,String(m.avg_power),String(m.avg_wind),String(m.energy_mwh),String(m.avg_gearbox_temp),String(m.readings)].forEach((v,i)=>doc.text(v,M+3+i*((W-M*2)/6),y+5.5));
        y+=8;
      }); y+=8;
    }

    // Recommendations
    if(y>230){doc.addPage();y=20;}
    doc.setTextColor(30,41,59); doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.text('Recommendations',M,y); y+=7;
    (result.recommendations||[]).forEach(r=>{
      if(y>272){doc.addPage();y=20;}
      doc.setFillColor(240,253,244); doc.roundedRect(M,y,W-M*2,10,2,2,'F');
      doc.setTextColor(21,128,61); doc.setFontSize(9); doc.setFont('helvetica','normal');
      doc.text(doc.splitTextToSize(r,W-M*2-8)[0],M+4,y+7); y+=12;
    });

    // Footer
    const pc=doc.internal.getNumberOfPages();
    for(let p=1;p<=pc;p++){
      doc.setPage(p); doc.setFillColor(15,23,42); doc.rect(0,287,W,10,'F');
      doc.setTextColor(148,163,184); doc.setFontSize(7);
      doc.text(`WindWatch | ${ci.companyName} | Turbine ${ci.turbineId} | Confidential`,M,293);
      doc.text(`Page ${p}/${pc}`,W-M-15,293);
    }
    doc.save(`WindWatch_${ci.companyName.replace(/\s/g,'_')}_${ci.turbineId}.pdf`);
    if(onDone) onDone();
  };

  if(window.jspdf){ run(); return; }
  if(existing){ existing.onload=run; return; }
  const s=document.createElement('script');
  s.id='jspdf-script';
  s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  s.onload=run; document.head.appendChild(s);
}

// ─── TINY COMPONENTS ──────────────────────────────────────
const SC = { Normal:'#22c55e', Warning:'#f59e0b', Critical:'#ef4444' };
function Badge({s}){const c=SC[s]||'#6b7280';return<span style={{background:c+'22',color:c,border:`1px solid ${c}55`,padding:'2px 10px',borderRadius:999,fontWeight:700,fontSize:12}}>{s}</span>;}
function KPI({icon,label,value,sub,color='#f1f5f9',warn=false}){
  return (
    <div style={{background:'#1e293b',border:`1px solid ${warn?'#f59e0b33':'#334155'}`,borderRadius:12,padding:'14px 18px',flex:1,minWidth:130}}>
      <div style={{color:'#64748b',fontSize:11,marginBottom:4}}>{icon} {label}</div>
      <div style={{color:color,fontSize:20,fontWeight:800}}>{value}</div>
      {sub&&<div style={{color:'#475569',fontSize:11,marginTop:3}}>{sub}</div>}
      {warn&&<div style={{color:'#f59e0b',fontSize:10,marginTop:3}}>⚠ Above threshold</div>}
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode,setMode]   = useState('login');
  const [form,setForm]   = useState({companyName:'',password:'',location:'',turbineModel:''});
  const [err,setErr]     = useState('');
  const [busy,setBusy]   = useState(false);
  const h = e => setForm(p=>({...p,[e.target.name]:e.target.value}));

  const submit = async () => {
    if(!form.companyName||!form.password){setErr('Company name and password are required.');return;}
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API}/auth/${mode}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form)});
      const d = await r.json();
      if(!r.ok) throw new Error(d.error);
      setToken(d.token); onLogin(d.company);
    } catch(e){setErr(e.message);}
    setBusy(false);
  };

  return (
    <div style={{minHeight:'100vh',background:'#0f172a',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
      <div style={{width:420,background:'#1e293b',borderRadius:16,padding:36,boxShadow:'0 20px 60px #00000060'}}>
        <div style={{textAlign:'center',marginBottom:28}}>
          <div style={{fontSize:42,marginBottom:8}}>🌬️</div>
          <div style={{fontWeight:800,fontSize:22,color:'#f1f5f9'}}>WindWatch</div>
          <div style={{color:'#64748b',fontSize:13,marginTop:4}}>Wind Turbine Management System</div>
        </div>

        <div style={{display:'flex',background:'#0f172a',borderRadius:8,padding:3,marginBottom:22}}>
          {['login','register'].map(m=>(
            <button key={m} onClick={()=>{setMode(m);setErr('');}}
              style={{flex:1,background:mode===m?'#3b82f6':'transparent',border:'none',color:mode===m?'#fff':'#64748b',borderRadius:6,padding:'9px',cursor:'pointer',fontWeight:mode===m?700:400,fontSize:13}}>
              {m==='login'?'Login':'Register'}
            </button>
          ))}
        </div>

        {[
          {n:'companyName',l:'Company Name *',p:'e.g. Suzlon Energy Ltd'},
          {n:'password',   l:'Password *',    p:'Min 4 characters', t:'password'},
          ...(mode==='register'?[
            {n:'location',     l:'Location',      p:'e.g. Gujarat, India'},
            {n:'turbineModel', l:'Turbine Model',  p:'e.g. S111 2.1 MW'},
          ]:[])
        ].map(f=>(
          <div key={f.n} style={{marginBottom:12}}>
            <label style={{color:'#94a3b8',fontSize:12,display:'block',marginBottom:5}}>{f.l}</label>
            <input name={f.n} type={f.t||'text'} value={form[f.n]} onChange={h} placeholder={f.p}
              onKeyDown={e=>e.key==='Enter'&&submit()}
              style={{width:'100%',background:'#0f172a',border:'1px solid #334155',color:'#f1f5f9',borderRadius:8,padding:'11px 14px',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
          </div>
        ))}

        {err&&<div style={{background:'#ef444411',border:'1px solid #ef444433',borderRadius:8,padding:'10px 14px',color:'#f87171',fontSize:13,marginBottom:14}}>{err}</div>}

        <button onClick={submit} disabled={busy}
          style={{width:'100%',background:busy?'#334155':'linear-gradient(135deg,#3b82f6,#1d4ed8)',border:'none',color:busy?'#64748b':'#fff',borderRadius:8,padding:'13px',cursor:busy?'not-allowed':'pointer',fontWeight:700,fontSize:15,marginTop:6}}>
          {busy?'Please wait...':(mode==='login'?'Login →':'Create Account →')}
        </button>

        <div style={{textAlign:'center',marginTop:14,color:'#475569',fontSize:12}}>
          {mode==='login'?'New? ':'Have an account? '}
          <span onClick={()=>{setMode(mode==='login'?'register':'login');setErr('');}} style={{color:'#3b82f6',cursor:'pointer',fontWeight:600}}>
            {mode==='login'?'Register here':'Login here'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── UPLOAD PANEL ─────────────────────────────────────────
function UploadPanel({ company, onResult }) {
  const [turbineId,setTurbineId] = useState('');
  const [file,setFile]           = useState(null);
  const [busy,setBusy]           = useState(false);
  const [progress,setProgress]   = useState('');
  const [err,setErr]             = useState('');
  const fileRef = useRef();

  const run = async () => {
    if(!turbineId.trim()){setErr('Please enter a Turbine ID.');return;}
    if(!file){setErr('Please select a CSV file.');return;}
    setBusy(true); setErr('');
    const msgs=['Reading CSV...','Detecting columns...','Extracting features...','Running fault classifier...','Building report...'];
    let mi=0; setProgress(msgs[0]);
    const iv=setInterval(()=>{mi=(mi+1)%msgs.length;setProgress(msgs[mi]);},1000);
    try {
      const fd=new FormData(); fd.append('file',file); fd.append('turbineId',turbineId);
      const r=await fetch(`${API}/company/upload`,{method:'POST',headers:authHdr(),body:fd});
      const d=await r.json();
      clearInterval(iv);
      if(!r.ok) throw new Error(d.error);
      onResult(d);
    } catch(e){clearInterval(iv);setErr(e.message);}
    setBusy(false); setProgress('');
  };

  return (
    <div style={{maxWidth:640,margin:'0 auto'}}>
      <div style={{background:'#1e293b',borderRadius:14,padding:28,marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:15,color:'#94a3b8',marginBottom:16,letterSpacing:1}}>TURBINE DETAILS</div>
        <label style={{color:'#94a3b8',fontSize:12,display:'block',marginBottom:6}}>Turbine ID *</label>
        <input value={turbineId} onChange={e=>setTurbineId(e.target.value)} placeholder="e.g. T-001 or WTG-42"
          style={{width:'100%',background:'#0f172a',border:'1px solid #334155',color:'#f1f5f9',borderRadius:8,padding:'11px 14px',fontSize:13,outline:'none',boxSizing:'border-box'}}/>
      </div>

      <div style={{background:'#1e293b',borderRadius:14,padding:28}}>
        <div style={{fontWeight:700,fontSize:15,color:'#94a3b8',marginBottom:14,letterSpacing:1}}>UPLOAD SCADA DATA CSV</div>

        <div style={{background:'#0f172a',borderRadius:10,padding:14,marginBottom:18,fontSize:12}}>
          <div style={{color:'#3b82f6',fontWeight:700,marginBottom:6}}>📋 Expected Format (Kaggle T1.csv format)</div>
          <div style={{fontFamily:'monospace',color:'#64748b',fontSize:11,marginBottom:10}}>
            Date/Time, LV ActivePower (kW), Wind Speed (m/s), Theoretical_Power_Curve (KWh), Wind Direction (°)
          </div>
          <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
            {[['Min rows','100+'],['Recommended','52,560+ (1 year, 10-min data)'],['Type','CSV only']].map(([k,v])=>(
              <span key={k}><span style={{color:'#475569'}}>{k}: </span><span style={{color:'#22c55e',fontWeight:600}}>{v}</span></span>
            ))}
          </div>
          <div style={{color:'#475569',fontSize:11,marginTop:8}}>
            Missing sensor columns (gearbox temp, vibration, RPM) are estimated from wind speed and power using physics equations.
          </div>
        </div>

        <div onClick={()=>fileRef.current.click()}
          style={{border:`2px dashed ${file?'#22c55e':'#334155'}`,borderRadius:12,padding:44,textAlign:'center',cursor:'pointer',background:file?'#22c55e08':'#0f172a',marginBottom:16,transition:'all 0.2s'}}>
          <div style={{fontSize:38,marginBottom:10}}>{file?'✅':'📁'}</div>
          <div style={{color:file?'#22c55e':'#64748b',fontWeight:700,fontSize:14}}>{file?file.name:'Click to select your CSV file'}</div>
          {file&&<div style={{color:'#475569',fontSize:12,marginTop:4}}>{(file.size/1024/1024).toFixed(2)} MB</div>}
          {!file&&<div style={{color:'#334155',fontSize:12,marginTop:4}}>Supports Kaggle T1.csv and similar SCADA data formats</div>}
          <input ref={fileRef} type="file" accept=".csv" onChange={e=>{setFile(e.target.files[0]);setErr('');}} style={{display:'none'}}/>
        </div>

        {busy&&(
          <div style={{background:'#0f172a',borderRadius:10,padding:16,marginBottom:14,textAlign:'center'}}>
            <div style={{fontSize:26,marginBottom:6}}>⚙️</div>
            <div style={{color:'#3b82f6',fontWeight:700,fontSize:13,marginBottom:10}}>{progress}</div>
            <div style={{height:5,background:'#1e293b',borderRadius:3}}>
              <div style={{height:5,background:'linear-gradient(90deg,#3b82f6,#22c55e)',borderRadius:3,width:'70%',transition:'width 0.5s'}}/>
            </div>
          </div>
        )}

        {err&&<div style={{background:'#ef444411',border:'1px solid #ef444433',borderRadius:8,padding:'12px 14px',color:'#f87171',fontSize:13,marginBottom:14}}>{err}</div>}

        <button onClick={run} disabled={busy||!file||!turbineId}
          style={{width:'100%',background:busy||!file||!turbineId?'#334155':'linear-gradient(135deg,#3b82f6,#1d4ed8)',border:'none',color:busy||!file||!turbineId?'#64748b':'#fff',borderRadius:8,padding:'13px',cursor:busy||!file||!turbineId?'not-allowed':'pointer',fontWeight:700,fontSize:15}}>
          {busy?'⚙️ Analysing your data...':'🔍 Run Annual ML Analysis'}
        </button>
      </div>
    </div>
  );
}

// ─── FULL REPORT VIEW ─────────────────────────────────────
function ReportView({ result, onNewUpload }) {
  const [pdfBusy,setPdfBusy] = useState(false);
  const hs=result.health_summary, ps=result.power_stats,
        fa=result.fault_analysis, am=result.analysis_meta,
        ss=result.sensor_summary,  ci=result.company_info;

  const hsC = hs.health_score>=80?'#22c55e':hs.health_score>=60?'#f59e0b':'#ef4444';

  const PIE = [
    {name:'Normal',  value:hs.normal_count,  color:'#22c55e'},
    {name:'Warning', value:hs.warning_count, color:'#f59e0b'},
    {name:'Critical',value:hs.critical_count,color:'#ef4444'},
  ];

  const monthChart = (result.monthly_breakdown||[]).map(m=>({
    month: m.month?.slice(-7)||m.month,
    power: m.avg_power, wind: m.avg_wind, energy: m.energy_mwh,
    gearbox: m.avg_gearbox_temp,
  }));

  const tsData  = result.time_series||[];
  const windDist = result.wind_distribution||[];
  const pcData   = result.power_curve||[];

  const CHART_STYLE = {background:'#0f172a',border:'1px solid #334155'};
  const GRID_STROKE = '#1e3a5f';
  const TICK = {fill:'#64748b',fontSize:10};

  return (
    <div>
      {/* REPORT HEADER */}
      <div style={{background:'#1e293b',borderRadius:12,padding:18,marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{fontWeight:800,fontSize:16,color:'#f1f5f9'}}>📊 Annual Report — {ci.companyName} · Turbine {ci.turbineId}</div>
          <div style={{color:'#64748b',fontSize:12,marginTop:3}}>
            {am.date_range} &nbsp;·&nbsp; {am.total_rows?.toLocaleString()} readings &nbsp;·&nbsp; {am.windows_analyzed} analysis windows
          </div>
        </div>
        <div style={{display:'flex',gap:10}}>
          <button onClick={onNewUpload} style={{background:'#334155',border:'none',color:'#94a3b8',borderRadius:8,padding:'9px 16px',cursor:'pointer',fontSize:13}}>+ New Upload</button>
          <button onClick={()=>{setPdfBusy(true);downloadPDF(result,()=>setPdfBusy(false));}} disabled={pdfBusy}
            style={{background:pdfBusy?'#334155':'linear-gradient(135deg,#3b82f6,#1d4ed8)',border:'none',color:pdfBusy?'#64748b':'#fff',borderRadius:8,padding:'9px 20px',cursor:pdfBusy?'not-allowed':'pointer',fontWeight:700,fontSize:13}}>
            {pdfBusy?'⏳ Generating...':'📥 Download PDF Report'}
          </button>
        </div>
      </div>

      {/* ── ROW 1: HEALTH + POWER KPIs ── */}
      <div style={{display:'flex',gap:12,marginBottom:14,flexWrap:'wrap'}}>
        <div style={{background:'#1e293b',border:`2px solid ${hsC}44`,borderRadius:12,padding:'16px 20px',flex:1,minWidth:140,textAlign:'center'}}>
          <div style={{color:'#64748b',fontSize:11,marginBottom:4}}>HEALTH SCORE</div>
          <div style={{color:hsC,fontWeight:800,fontSize:32}}>{hs.health_score}%</div>
          <div style={{height:5,background:'#0f172a',borderRadius:3,marginTop:8}}><div style={{height:5,width:`${hs.health_score}%`,background:hsC,borderRadius:3,transition:'width 1s'}}/></div>
        </div>
        <KPI icon="⚡" label="Total Energy"    value={`${ps.total_energy_mwh} MWh`} color="#3b82f6" sub="Annual generation"/>
        <KPI icon="💨" label="Avg Wind Speed"  value={`${ps.avg_wind_speed} m/s`}   color="#a78bfa" sub={`Max: ${ss?.max_wind_speed} m/s`}/>
        <KPI icon="🔋" label="Avg Power"       value={`${ps.avg_power_kw} kW`}      color="#22c55e" sub={`Peak: ${ps.max_power_kw} kW`}/>
        <KPI icon="📊" label="Capacity Factor" value={`${ps.capacity_factor}%`}     color="#f59e0b" sub="Industry avg: 25–40%"/>
      </div>

      {/* ── ROW 2: SENSOR KPIs ── */}
      <div style={{display:'flex',gap:12,marginBottom:14,flexWrap:'wrap'}}>
        <KPI icon="🌡" label="Avg Gearbox Temp"   value={`${ss?.avg_gearbox_temp}°C`}    color={ss?.max_gearbox_temp>65?'#f59e0b':'#94a3b8'} sub={`Max: ${ss?.max_gearbox_temp}°C`} warn={ss?.max_gearbox_temp>65}/>
        <KPI icon="🔥" label="Avg Generator Temp" value={`${ss?.avg_generator_temp}°C`}  color={ss?.max_generator_temp>75?'#ef4444':'#94a3b8'} sub={`Max: ${ss?.max_generator_temp}°C`} warn={ss?.max_generator_temp>75}/>
        <KPI icon="〰" label="Avg Vibration"      value={`${ss?.avg_blade_vibration}`}   color={ss?.max_blade_vibration>0.8?'#f59e0b':'#94a3b8'} sub={`Max: ${ss?.max_blade_vibration} mm/s`} warn={ss?.max_blade_vibration>0.8}/>
        <KPI icon="🔄" label="Avg Rotor RPM"      value={`${ss?.avg_rotor_rpm}`}         color={ss?.max_rotor_rpm>25?'#f59e0b':'#94a3b8'} sub={`Max: ${ss?.max_rotor_rpm} rpm`}/>
        <KPI icon="⚠️" label="Top Fault"          value={fa.top_fault}                   color="#f59e0b"/>
      </div>

      {/* ── ROW 3: PIE + HEALTH DISTRIBUTION BAR ── */}
      <div style={{display:'flex',gap:14,marginBottom:14,flexWrap:'wrap'}}>
        <div style={{background:'#1e293b',borderRadius:12,padding:20,flex:1,minWidth:220}}>
          <div style={{fontWeight:700,marginBottom:10}}>📊 Health Distribution</div>
          <ResponsiveContainer width="100%" height={190}>
            <PieChart>
              <Pie data={PIE} cx="50%" cy="50%" innerRadius={52} outerRadius={82} paddingAngle={3} dataKey="value">
                {PIE.map((e,i)=><Cell key={i} fill={e.color}/>)}
              </Pie>
              <Tooltip contentStyle={CHART_STYLE}/><Legend/>
            </PieChart>
          </ResponsiveContainer>
          <div style={{display:'flex',justifyContent:'space-around',marginTop:6}}>
            {[['Normal',hs.normal_pct,'#22c55e'],['Warning',hs.warning_pct,'#f59e0b'],['Critical',hs.critical_pct,'#ef4444']].map(([l,v,c])=>(
              <div key={l} style={{textAlign:'center'}}><div style={{color:c,fontWeight:800,fontSize:15}}>{v}%</div><div style={{color:'#64748b',fontSize:10}}>{l}</div></div>
            ))}
          </div>
        </div>

        {/* Wind Speed Distribution */}
        {windDist.length>0&&(
          <div style={{background:'#1e293b',borderRadius:12,padding:20,flex:2,minWidth:280}}>
            <div style={{fontWeight:700,marginBottom:10}}>💨 Wind Speed Distribution</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={windDist}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE}/>
                <XAxis dataKey="range" tick={TICK}/>
                <YAxis tick={TICK}/>
                <Tooltip contentStyle={CHART_STYLE} formatter={v=>[v.toLocaleString(),'Count']}/>
                <Bar dataKey="count" fill="#3b82f6" name="Readings" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ── ROW 4: TIME SERIES — Power & Wind ── */}
      {tsData.length>0&&(
        <div style={{background:'#1e293b',borderRadius:12,padding:20,marginBottom:14}}>
          <div style={{fontWeight:700,marginBottom:10}}>⚡ Power Output vs Wind Speed (sampled)</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={tsData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE}/>
              <XAxis dataKey="time" tick={TICK} interval={Math.floor(tsData.length/8)}/>
              <YAxis yAxisId="l" tick={TICK}/>
              <YAxis yAxisId="r" orientation="right" tick={TICK}/>
              <Tooltip contentStyle={CHART_STYLE}/>
              <Legend/>
              <Line yAxisId="l" type="monotone" dataKey="power_output" stroke="#3b82f6" dot={false} strokeWidth={2} name="Power (kW)"/>
              <Line yAxisId="r" type="monotone" dataKey="wind_speed"   stroke="#22c55e" dot={false} strokeWidth={2} name="Wind (m/s)"/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── ROW 5: MONTHLY POWER + ENERGY ── */}
      {monthChart.length>0&&(
        <div style={{display:'flex',gap:14,marginBottom:14,flexWrap:'wrap'}}>
          <div style={{background:'#1e293b',borderRadius:12,padding:20,flex:1,minWidth:280}}>
            <div style={{fontWeight:700,marginBottom:10}}>📅 Monthly Avg Power (kW)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthChart}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE}/>
                <XAxis dataKey="month" tick={TICK} interval={0} angle={-30} textAnchor="end" height={40}/>
                <YAxis tick={TICK}/>
                <Tooltip contentStyle={CHART_STYLE}/>
                <Bar dataKey="power" fill="#3b82f6" name="Avg Power (kW)" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{background:'#1e293b',borderRadius:12,padding:20,flex:1,minWidth:280}}>
            <div style={{fontWeight:700,marginBottom:10}}>⚡ Monthly Energy (MWh)</div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthChart}>
                <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/><stop offset="95%" stopColor="#22c55e" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE}/>
                <XAxis dataKey="month" tick={TICK} interval={0} angle={-30} textAnchor="end" height={40}/>
                <YAxis tick={TICK}/>
                <Tooltip contentStyle={CHART_STYLE}/>
                <Area type="monotone" dataKey="energy" stroke="#22c55e" fill="url(#eg)" strokeWidth={2} name="Energy (MWh)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── ROW 6: GEARBOX TEMP TREND + VIBRATION ── */}
      {tsData.length>0&&(
        <div style={{display:'flex',gap:14,marginBottom:14,flexWrap:'wrap'}}>
          <div style={{background:'#1e293b',borderRadius:12,padding:20,flex:1,minWidth:280}}>
            <div style={{fontWeight:700,marginBottom:10}}>🌡 Gearbox Temperature Trend</div>
            <ResponsiveContainer width="100%" height={190}>
              <AreaChart data={tsData}>
                <defs><linearGradient id="gt" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE}/>
                <XAxis dataKey="time" tick={TICK} interval={Math.floor(tsData.length/8)}/>
                <YAxis tick={TICK}/>
                <Tooltip contentStyle={CHART_STYLE}/>
                <Area type="monotone" dataKey="gearbox_temp" stroke="#f59e0b" fill="url(#gt)" strokeWidth={2} name="Gearbox (°C)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{background:'#1e293b',borderRadius:12,padding:20,flex:1,minWidth:280}}>
            <div style={{fontWeight:700,marginBottom:10}}>〰 Blade Vibration Trend</div>
            <ResponsiveContainer width="100%" height={190}>
              <AreaChart data={tsData}>
                <defs><linearGradient id="vib" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3}/><stop offset="95%" stopColor="#a78bfa" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE}/>
                <XAxis dataKey="time" tick={TICK} interval={Math.floor(tsData.length/8)}/>
                <YAxis tick={TICK}/>
                <Tooltip contentStyle={CHART_STYLE}/>
                <Area type="monotone" dataKey="blade_vibration" stroke="#a78bfa" fill="url(#vib)" strokeWidth={2} name="Vibration (mm/s)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── ROW 7: POWER CURVE ── */}
      {pcData.length>0&&(
        <div style={{background:'#1e293b',borderRadius:12,padding:20,marginBottom:14}}>
          <div style={{fontWeight:700,marginBottom:10}}>📈 Power Curve — Actual vs Theoretical</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={pcData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE}/>
              <XAxis dataKey="wind_range" tick={TICK}/>
              <YAxis tick={TICK}/>
              <Tooltip contentStyle={CHART_STYLE}/>
              <Legend/>
              <Bar dataKey="actual_power"  fill="#3b82f6" name="Actual Power (kW)"      radius={[3,3,0,0]}/>
              {pcData[0]?.theoretical&&<Bar dataKey="theoretical" fill="#22c55e" name="Theoretical (kW)" radius={[3,3,0,0]} fillOpacity={0.6}/>}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── ROW 8: MONTHLY GEARBOX HEAT ── */}
      {monthChart.length>0&&(
        <div style={{background:'#1e293b',borderRadius:12,padding:20,marginBottom:14}}>
          <div style={{fontWeight:700,marginBottom:10}}>🌡 Monthly Gearbox Temperature</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={monthChart}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE}/>
              <XAxis dataKey="month" tick={TICK} interval={0} angle={-30} textAnchor="end" height={40}/>
              <YAxis tick={TICK} domain={['auto','auto']}/>
              <Tooltip contentStyle={CHART_STYLE}/>
              <Bar dataKey="gearbox" name="Avg Gearbox Temp (°C)" radius={[3,3,0,0]}
                fill="#f59e0b"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── ROW 9: FAULT CARDS + RECOMMENDATIONS ── */}
      <div style={{display:'flex',gap:14,flexWrap:'wrap'}}>
        {Object.keys(fa.fault_counts||{}).length>0&&(
          <div style={{background:'#1e293b',borderRadius:12,padding:20,flex:1,minWidth:200}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>⚠️ Fault Summary</div>
            {Object.entries(fa.fault_counts).map(([f,c])=>(
              <div key={f} style={{background:'#f59e0b11',border:'1px solid #f59e0b33',borderRadius:8,padding:'12px 16px',marginBottom:8}}>
                <div style={{color:'#f59e0b',fontWeight:800,fontSize:22}}>{c}</div>
                <div style={{color:'#94a3b8',fontSize:13}}>{f}</div>
                <div style={{color:'#475569',fontSize:11}}>analysis windows</div>
              </div>
            ))}
          </div>
        )}
        <div style={{background:'#1e293b',borderRadius:12,padding:20,flex:2,minWidth:260}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>🔧 Recommendations</div>
          {(result.recommendations||[]).map((r,i)=>(
            <div key={i} style={{background:'#22c55e0a',border:'1px solid #22c55e22',borderRadius:8,padding:'10px 14px',marginBottom:8,color:'#86efac',fontSize:13,lineHeight:1.5}}>{r}</div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ─── MAIN APP ─────────────────────────────────────────────
export default function App() {
  const [company,   setCompany]   = useState(null);
  const [result,    setResult]    = useState(null);  // persists across everything
  const [showHistory, setShowHistory] = useState(false);
  const [reports,   setReports]   = useState([]);

  const logout = () => { clearToken(); setCompany(null); setResult(null); setReports([]); };

  const loadHistory = async () => {
    try {
      const r=await fetch(`${API}/company/reports`,{headers:authHdr()});
      const d=await r.json();
      if(Array.isArray(d)) setReports(d);
    } catch{}
  };

  const deleteReport = async (id) => {
    if(!window.confirm('Delete this report? This cannot be undone.')) return;
    try {
      const r = await fetch(`${API}/company/reports/${id}`, {
        method:'DELETE', headers: authHdr()
      });
      if(r.ok) setReports(prev => prev.filter(rep => rep.id !== id));
    } catch(e){ alert('Failed to delete report.'); }
  };

  const onLogin = c => { setCompany(c); loadHistory(); };
  const onResult = d => { setResult(d); loadHistory(); };
  const onNewUpload = () => setResult(null);

  if(!company) return <AuthScreen onLogin={onLogin}/>;

  return (
    <div style={{background:'#0f172a',minHeight:'100vh',color:'#f1f5f9',fontFamily:'Inter,system-ui,sans-serif'}}>

      {/* TOPBAR */}
      <div style={{background:'#1e293b',borderBottom:'1px solid #334155',padding:'12px 28px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{fontSize:26}}>🌬️</div>
          <div><div style={{fontWeight:800,fontSize:18,color:'#f1f5f9'}}>WindWatch</div><div style={{fontSize:10,color:'#64748b'}}>Wind Turbine Management System</div></div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          {reports.length>0&&(
            <button onClick={()=>setShowHistory(!showHistory)}
              style={{background:showHistory?'#3b82f622':'#334155',border:showHistory?'1px solid #3b82f6':'none',color:showHistory?'#3b82f6':'#94a3b8',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontSize:12}}>
              📋 History ({reports.length})
            </button>
          )}
          <div style={{textAlign:'right'}}>
            <div style={{color:'#f1f5f9',fontSize:13,fontWeight:600}}>{company.company_name}</div>
            <div style={{color:'#64748b',fontSize:11}}>{company.location||'No location set'}</div>
          </div>
          <button onClick={logout} style={{background:'#334155',border:'none',color:'#94a3b8',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontSize:12}}>Logout</button>
        </div>
      </div>

      <div style={{padding:'24px 28px'}}>

        {/* HISTORY PANEL */}
        {showHistory&&reports.length>0&&(
          <div style={{background:'#1e293b',borderRadius:12,padding:20,marginBottom:20}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>📋 Past Reports</div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {reports.map(r=>(
                <div key={r.id} style={{background:'#0f172a',borderRadius:8,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                  <div>
                    <div style={{fontWeight:600,color:'#f1f5f9',fontSize:13}}>Turbine {r.turbine_id} — {r.date_range} — {r.filename}</div>
                    <div style={{color:'#64748b',fontSize:11,marginTop:2}}>{new Date(r.timestamp).toLocaleString()} · {Number(r.total_rows).toLocaleString()} rows</div>
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <span style={{color:r.report?.health_summary?.health_score>=80?'#22c55e':r.report?.health_summary?.health_score>=60?'#f59e0b':'#ef4444',fontWeight:700,fontSize:13}}>
                      {r.report?.health_summary?.health_score}% health
                    </span>
                    <button onClick={()=>{setResult(r.report);setShowHistory(false);}}
                      style={{background:'#3b82f6',border:'none',color:'#fff',borderRadius:6,padding:'5px 12px',cursor:'pointer',fontSize:12,fontWeight:600}}>
                      View
                    </button>
                    <button onClick={()=>downloadPDF(r.report,null)}
                      style={{background:'#334155',border:'none',color:'#94a3b8',borderRadius:6,padding:'5px 12px',cursor:'pointer',fontSize:12}}>
                      PDF
                    </button>
                    <button onClick={()=>deleteReport(r.id)}
                      style={{background:'#ef444422',border:'1px solid #ef444444',color:'#f87171',borderRadius:6,padding:'5px 12px',cursor:'pointer',fontSize:12,fontWeight:600}}>
                      🗑 Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MAIN CONTENT */}
        {!result
          ? <UploadPanel company={company} onResult={onResult}/>
          : <ReportView  result={result}   onNewUpload={onNewUpload}/>
        }
      </div>
    </div>
  );
}
