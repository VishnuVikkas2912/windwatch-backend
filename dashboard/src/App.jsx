import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";

const API_BASE = "http://localhost:5000/api";
const POLL_MS  = 4000;

const STATUS_COLOR = { Normal: "#22c55e", Warning: "#f59e0b", Critical: "#ef4444", Offline: "#6b7280" };
const TURBINE_IDS  = ["T01","T02","T03","T04","T05"];

// ─── MOCK DATA ───────────────────────────────────────────
function mockFleet() {
  const statuses = ["Normal","Normal","Warning","Critical","Warning"];
  return TURBINE_IDS.map((id,i) => ({
    turbine_id: id, status: statuses[i],
    status_code: [0,0,1,2,1][i],
    confidence: (80+Math.random()*18).toFixed(1),
    wind_speed: (6+Math.random()*10).toFixed(1),
    power_output: (400+Math.random()*1400).toFixed(0),
    rotor_rpm: (10+Math.random()*12).toFixed(1),
    gearbox_temp: (44+Math.random()*35).toFixed(1),
    generator_temp: (55+Math.random()*40).toFixed(1),
    blade_vibration: (0.3+Math.random()*1.5).toFixed(3),
    timestamp: new Date().toISOString(),
  }));
}
function mockHistory(n=40) {
  return Array.from({length:n},(_,i)=>({
    time: new Date(Date.now()-(n-i)*4000).toLocaleTimeString(),
    power_output:   parseFloat((400+Math.sin(i*0.3)*600+i*8).toFixed(0)),
    wind_speed:     parseFloat((7+Math.sin(i*0.2)*3).toFixed(1)),
    gearbox_temp:   parseFloat((52+Math.cos(i*0.15)*8+i*0.1).toFixed(1)),
    blade_vibration:parseFloat((0.5+Math.sin(i*0.4)*0.3+i*0.005).toFixed(3)),
  }));
}
function mockStats() {
  return { total_readings:2841, normal:1820, warning:780, critical:241,
           unack_alerts:7, health_score:64.1, total_energy_kwh:18340,
           avg_wind_speed:9.2, fleet_capacity:64.1 };
}
function mockAlerts() {
  return [
    { id:1, turbine_id:"T04", severity:"Critical", fault_type:"Gearbox Overheating",
      message:"T04: Gearbox temperature exceeding safe limits.", timestamp:new Date().toISOString() },
    { id:2, turbine_id:"T03", severity:"Warning", fault_type:"Blade Imbalance",
      message:"T03: Abnormal blade vibration detected.", timestamp:new Date(Date.now()-45000).toISOString() },
  ];
}

// ─── PDF GENERATOR ───────────────────────────────────────
function generatePDF(fleet, stats, alerts) {
  // Dynamically load jsPDF from CDN
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  script.onload = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const now    = new Date().toLocaleString();
    const pageW  = 210;
    const margin = 15;
    const col2   = pageW / 2;
    let y = 20;

    // ── HEADER ──────────────────────────────
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 35, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('🌬 WindWatch', margin, 16);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Wind Turbine Management System — Fleet Report', margin, 24);
    doc.text(`Generated: ${now}`, margin, 30);

    y = 45;

    // ── FLEET HEALTH SUMMARY ─────────────────
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Fleet Health Summary', margin, y);
    y += 8;

    doc.setFillColor(241, 245, 249);
    doc.roundedRect(margin, y, pageW - margin*2, 28, 3, 3, 'F');

    const summaryItems = [
      ['Health Score',   `${stats?.health_score || 0}%`],
      ['Total Energy',   `${((stats?.total_energy_kwh||0)/1000).toFixed(1)} MWh`],
      ['Avg Wind Speed', `${stats?.avg_wind_speed || 0} m/s`],
      ['Active Alerts',  `${stats?.unack_alerts || 0}`],
    ];

    summaryItems.forEach(([label, value], i) => {
      const x = margin + 8 + (i * 44);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(label, x, y + 8);
      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(value, x, y + 18);
    });

    const statusCounts = [
      ['Normal',   stats?.normal   || 0, [34, 197, 94]],
      ['Warning',  stats?.warning  || 0, [245, 158, 11]],
      ['Critical', stats?.critical || 0, [239, 68, 68]],
    ];
    statusCounts.forEach(([label, count, rgb], i) => {
      const x = margin + 8 + (i * 44);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...rgb);
      doc.text(`● ${label}: ${count}`, x, y + 26);
    });

    y += 36;

    // ── TURBINE STATUS TABLE ──────────────────
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Turbine Status', margin, y);
    y += 8;

    // Table header
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y, pageW - margin*2, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const headers = ['Turbine', 'Status', 'Wind (m/s)', 'Power (kW)', 'RPM', 'Gearbox °C', 'Vibration', 'Confidence'];
    const colW = (pageW - margin*2) / headers.length;
    headers.forEach((h, i) => doc.text(h, margin + 2 + i * colW, y + 5.5));
    y += 8;

    // Table rows
    fleet.forEach((t, idx) => {
      const isEven = idx % 2 === 0;
      doc.setFillColor(isEven ? 248 : 241, isEven ? 250 : 245, isEven ? 252 : 249);
      doc.rect(margin, y, pageW - margin*2, 9, 'F');

      const statusRgb =
        t.status === 'Normal'   ? [34, 197, 94]  :
        t.status === 'Warning'  ? [245, 158, 11] :
        t.status === 'Critical' ? [239, 68, 68]  : [107, 114, 128];

      const rowData = [
        t.turbine_id,
        t.status,
        `${t.wind_speed}`,
        `${t.power_output}`,
        `${t.rotor_rpm}`,
        `${t.gearbox_temp}`,
        `${t.blade_vibration}`,
        `${t.confidence}%`,
      ];

      rowData.forEach((val, i) => {
        if (i === 1) doc.setTextColor(...statusRgb);
        else doc.setTextColor(30, 41, 59);
        doc.setFontSize(8);
        doc.setFont('helvetica', i === 1 ? 'bold' : 'normal');
        doc.text(val, margin + 2 + i * colW, y + 6);
      });
      y += 9;
    });

    y += 10;

    // ── ACTIVE ALERTS ────────────────────────
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Active Alerts', margin, y);
    y += 8;

    if (alerts.length === 0) {
      doc.setFillColor(220, 252, 231);
      doc.roundedRect(margin, y, pageW - margin*2, 12, 3, 3, 'F');
      doc.setTextColor(21, 128, 61);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('✓ No active alerts. All turbines operating normally.', margin + 5, y + 8);
      y += 18;
    } else {
      alerts.slice(0, 10).forEach((a) => {
        const bgRgb = a.severity === 'Critical' ? [254, 226, 226] : [254, 243, 199];
        const txtRgb = a.severity === 'Critical' ? [185, 28, 28] : [146, 64, 14];
        doc.setFillColor(...bgRgb);
        doc.roundedRect(margin, y, pageW - margin*2, 14, 2, 2, 'F');
        doc.setTextColor(...txtRgb);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text(`[${a.severity}] ${a.turbine_id} — ${a.fault_type}`, margin + 4, y + 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        const msgLines = doc.splitTextToSize(a.message, pageW - margin*2 - 8);
        doc.text(msgLines[0], margin + 4, y + 11);
        y += 16;
      });
    }

    y += 6;

    // ── RECOMMENDATIONS ──────────────────────
    if (y > 240) { doc.addPage(); y = 20; }

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Maintenance Recommendations', margin, y);
    y += 8;

    const recommendations = [];
    fleet.forEach(t => {
      if (t.status === 'Critical')
        recommendations.push(`• ${t.turbine_id}: URGENT — Immediate inspection required. Fault detected with ${t.confidence}% confidence.`);
      else if (t.status === 'Warning')
        recommendations.push(`• ${t.turbine_id}: Schedule maintenance within 48 hours. Monitor sensor readings closely.`);
    });
    if (recommendations.length === 0)
      recommendations.push('• All turbines are operating within normal parameters. Continue routine monitoring.');

    recommendations.push('• Perform lubrication check on gearboxes showing elevated temperatures.');
    recommendations.push('• Review blade pitch control systems monthly for optimal power generation.');

    doc.setFillColor(241, 245, 249);
    doc.roundedRect(margin, y, pageW - margin*2, recommendations.length * 8 + 8, 3, 3, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    recommendations.forEach((r, i) => {
      doc.text(r, margin + 4, y + 7 + i * 8);
    });
    y += recommendations.length * 8 + 14;

    // ── FOOTER ───────────────────────────────
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 287, pageW, 10, 'F');
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(7);
      doc.text('WindWatch — Wind Turbine Management System | Confidential', margin, 293);
      doc.text(`Page ${p} of ${pageCount}`, pageW - margin - 15, 293);
    }

    // ── SAVE ─────────────────────────────────
    const filename = `WindWatch_Report_${new Date().toISOString().slice(0,10)}.pdf`;
    doc.save(filename);
  };
  document.head.appendChild(script);
}

// ─── COMPONENTS ──────────────────────────────────────────
function Badge({ status }) {
  const c = STATUS_COLOR[status]||"#6b7280";
  return <span style={{background:c+"22",color:c,border:`1px solid ${c}55`,padding:"2px 10px",borderRadius:999,fontWeight:700,fontSize:12}}>{status}</span>;
}

function MetricPill({ label, value, unit, color="#94a3b8" }) {
  return (
    <div style={{background:"#0f172a",borderRadius:8,padding:"8px 12px",flex:1,minWidth:80}}>
      <div style={{color:"#475569",fontSize:10,marginBottom:2}}>{label}</div>
      <div style={{color:color,fontWeight:700,fontSize:16}}>{value}<span style={{fontSize:11,color:"#64748b",marginLeft:3}}>{unit}</span></div>
    </div>
  );
}

function TurbineCard({ data, selected, onClick }) {
  const c = STATUS_COLOR[data.status]||"#6b7280";
  const pct = Math.min(100, (data.power_output/2000)*100);
  return (
    <div onClick={onClick} style={{background:"#1e293b",border:`2px solid ${selected?c:"#334155"}`,borderRadius:14,padding:18,cursor:"pointer",transition:"all 0.2s",flex:1,minWidth:180}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div>
          <div style={{fontWeight:800,fontSize:16,color:"#f1f5f9"}}>🌀 {data.turbine_id}</div>
          <div style={{color:"#64748b",fontSize:11}}>Wind Turbine</div>
        </div>
        <Badge status={data.status} />
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <MetricPill label="Wind" value={data.wind_speed} unit="m/s" color="#3b82f6"/>
        <MetricPill label="Power" value={data.power_output} unit="kW" color="#22c55e"/>
        <MetricPill label="RPM" value={data.rotor_rpm} unit="" color="#a78bfa"/>
      </div>
      <div style={{marginBottom:6,fontSize:11,color:"#64748b",display:"flex",justifyContent:"space-between"}}>
        <span>Power Output</span><span style={{color:c}}>{pct.toFixed(0)}%</span>
      </div>
      <div style={{height:5,background:"#0f172a",borderRadius:3}}>
        <div style={{height:5,width:`${pct}%`,background:`linear-gradient(90deg,#3b82f6,${c})`,borderRadius:3,transition:"width 0.6s"}}/>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div style={{background:"#1e293b",borderRadius:12,padding:"16px 20px",flex:1,minWidth:130}}>
      <div style={{color:"#64748b",fontSize:12,marginBottom:4}}>{icon} {label}</div>
      <div style={{color:color||"#f1f5f9",fontSize:24,fontWeight:800}}>{value}</div>
      {sub && <div style={{color:"#475569",fontSize:11,marginTop:2}}>{sub}</div>}
    </div>
  );
}

function AlertCard({ alert, onAck }) {
  const c = alert.severity==="Critical"?"#ef4444":"#f59e0b";
  return (
    <div style={{background:c+"0d",border:`1px solid ${c}33`,borderLeft:`3px solid ${c}`,borderRadius:8,padding:"12px 16px",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      <div>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
          <Badge status={alert.severity}/>
          <span style={{color:"#94a3b8",fontWeight:600,fontSize:13}}>{alert.turbine_id} — {alert.fault_type}</span>
        </div>
        <div style={{color:"#94a3b8",fontSize:12}}>{alert.message}</div>
        <div style={{color:"#475569",fontSize:11,marginTop:4}}>{new Date(alert.timestamp).toLocaleTimeString()}</div>
      </div>
      <button onClick={()=>onAck(alert.id)} style={{background:"#334155",border:"none",color:"#94a3b8",borderRadius:6,padding:"5px 12px",cursor:"pointer",fontSize:12,marginLeft:12,whiteSpace:"nowrap"}}>
        ✓ Dismiss
      </button>
    </div>
  );
}

function WindGauge({ value }) {
  const max = 25;
  const pct = Math.min(100, (value/max)*100);
  const color = value<5?"#6b7280":value<10?"#22c55e":value<18?"#f59e0b":"#ef4444";
  return (
    <div style={{textAlign:"center",padding:"10px 0"}}>
      <div style={{fontSize:36,fontWeight:800,color}}>{value}</div>
      <div style={{color:"#64748b",fontSize:13}}>m/s Wind Speed</div>
      <div style={{height:8,background:"#0f172a",borderRadius:4,margin:"8px 0"}}>
        <div style={{height:8,width:`${pct}%`,background:`linear-gradient(90deg,#22c55e,${color})`,borderRadius:4,transition:"width 0.5s"}}/>
      </div>
      <div style={{color:"#475569",fontSize:11}}>{pct.toFixed(0)}% of max rated</div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────
export default function App() {
  const [fleet,    setFleet]    = useState([]);
  const [history,  setHistory]  = useState([]);
  const [stats,    setStats]    = useState(null);
  const [alerts,   setAlerts]   = useState([]);
  const [selected, setSelected] = useState("T01");
  const [tab,      setTab]      = useState("dashboard");
  const [useMock,  setUseMock]  = useState(false);
  const [updated,  setUpdated]  = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [fRes,sRes,aRes] = await Promise.all([
        fetch(`${API_BASE}/fleet`), fetch(`${API_BASE}/stats`), fetch(`${API_BASE}/alerts`)
      ]);
      if(!fRes.ok) throw new Error();
      setFleet(await fRes.json());
      setStats(await sRes.json());
      setAlerts(await aRes.json());
      setUseMock(false);
      const hRes  = await fetch(`${API_BASE}/readings?turbine=${selected}&limit=50`);
      const hData = await hRes.json();
      setHistory(hData.map(r=>({
        time:            new Date(r.timestamp).toLocaleTimeString(),
        power_output:    parseFloat(r.power_output||0),
        wind_speed:      parseFloat(r.wind_speed||0),
        gearbox_temp:    parseFloat(r.gearbox_temp||0),
        blade_vibration: parseFloat(r.blade_vibration||0),
      })));
    } catch {
      setUseMock(true);
      setFleet(mockFleet());
      setStats(mockStats());
      setAlerts(mockAlerts());
      setHistory(mockHistory());
    }
    setUpdated(new Date().toLocaleTimeString());
  }, [selected]);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, POLL_MS);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const ackAlert = async (id) => {
    setAlerts(p=>p.filter(a=>a.id!==id));
    if(!useMock) await fetch(`${API_BASE}/alerts/${id}/acknowledge`,{method:"POST"});
  };

  const handleDownloadPDF = () => {
    setPdfLoading(true);
    setTimeout(() => {
      generatePDF(fleet, stats, alerts);
      setPdfLoading(false);
    }, 300);
  };

  const selectedData = fleet.find(f=>f.turbine_id===selected)||{};
  const criticalCount = fleet.filter(f=>f.status==="Critical").length;
  const warningCount  = fleet.filter(f=>f.status==="Warning").length;
  const overallStatus = criticalCount>0?"Critical":warningCount>0?"Warning":"Normal";

  const PIE = stats?[
    {name:"Normal",  value:stats.normal,   color:"#22c55e"},
    {name:"Warning", value:stats.warning,  color:"#f59e0b"},
    {name:"Critical",value:stats.critical, color:"#ef4444"},
  ]:[];

  const sensorCards = selectedData.turbine_id ? [
    {icon:"🌡",label:"Gearbox Temp",   value:`${selectedData.gearbox_temp}°C`,   warn:selectedData.gearbox_temp>65},
    {icon:"⚡",label:"Generator Temp", value:`${selectedData.generator_temp}°C`, warn:selectedData.generator_temp>75},
    {icon:"〰",label:"Blade Vibration", value:`${selectedData.blade_vibration} mm/s`, warn:selectedData.blade_vibration>0.8},
    {icon:"📐",label:"Pitch Angle",    value:`${selectedData.pitch_angle||0}°`,  warn:false},
  ]:[];

  return (
    <div style={{background:"#0f172a",minHeight:"100vh",color:"#f1f5f9",fontFamily:"Inter,system-ui,sans-serif"}}>

      {/* TOPBAR */}
      <div style={{background:"#1e293b",borderBottom:"1px solid #334155",padding:"14px 28px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:28}}>🌬️</div>
          <div>
            <div style={{fontWeight:800,fontSize:19,color:"#f1f5f9"}}>WindWatch</div>
            <div style={{fontSize:11,color:"#64748b"}}>Wind Turbine Management System</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          {useMock&&<span style={{background:"#f59e0b22",color:"#f59e0b",border:"1px solid #f59e0b44",padding:"3px 10px",borderRadius:99,fontSize:12}}>Demo Mode</span>}
          <Badge status={overallStatus}/>
          <span style={{color:"#475569",fontSize:12}}>Updated: {updated}</span>

          {/* ── PDF DOWNLOAD BUTTON ── */}
          <button
            onClick={handleDownloadPDF}
            disabled={pdfLoading}
            style={{
              background: pdfLoading ? "#334155" : "linear-gradient(135deg,#3b82f6,#1d4ed8)",
              border:"none", color:"#fff", borderRadius:8,
              padding:"8px 16px", cursor: pdfLoading ? "not-allowed" : "pointer",
              fontWeight:700, fontSize:13, display:"flex", alignItems:"center", gap:6,
              boxShadow: pdfLoading ? "none" : "0 2px 8px #3b82f644",
              transition:"all 0.2s"
            }}>
            {pdfLoading ? "⏳ Generating..." : "📥 Download Report"}
          </button>

          <button onClick={fetchAll} style={{background:"#334155",border:"none",color:"#94a3b8",borderRadius:8,padding:"6px 14px",cursor:"pointer"}}>↻</button>
        </div>
      </div>

      {/* TABS */}
      <div style={{background:"#0f172a",borderBottom:"1px solid #1e293b",padding:"0 28px",display:"flex",gap:4}}>
        {[["dashboard","🏠 Dashboard"],["turbines","🌀 Turbines"],["analytics","📊 Analytics"],["alerts","🔔 Alerts"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{background:tab===k?"#1e293b":"transparent",border:"none",borderBottom:tab===k?"2px solid #3b82f6":"2px solid transparent",color:tab===k?"#f1f5f9":"#64748b",padding:"12px 18px",cursor:"pointer",fontWeight:tab===k?700:400,fontSize:13}}>
            {l}{k==="alerts"&&alerts.length>0?` (${alerts.length})`:""}
          </button>
        ))}
      </div>

      <div style={{padding:"24px 28px"}}>

        {/* ── DASHBOARD ── */}
        {tab==="dashboard" && <>
          {stats&&<div style={{display:"flex",gap:12,marginBottom:22,flexWrap:"wrap"}}>
            <StatCard icon="💚" label="Fleet Health"   value={`${stats.health_score}%`}    color={stats.health_score>70?"#22c55e":"#ef4444"} sub="Overall fleet status"/>
            <StatCard icon="⚡" label="Total Energy"   value={`${(stats.total_energy_kwh/1000).toFixed(1)} MWh`} color="#3b82f6" sub="Generated today"/>
            <StatCard icon="💨" label="Avg Wind Speed" value={`${stats.avg_wind_speed} m/s`} color="#a78bfa"/>
            <StatCard icon="✅" label="Normal"         value={stats.normal}   color="#22c55e"/>
            <StatCard icon="⚠️" label="Warning"        value={stats.warning}  color="#f59e0b"/>
            <StatCard icon="🔴" label="Critical"       value={stats.critical} color="#ef4444"/>
            <StatCard icon="🔔" label="Active Alerts"  value={stats.unack_alerts} color="#f97316" sub="Unacknowledged"/>
          </div>}

          <div style={{marginBottom:8,fontWeight:600,color:"#64748b",fontSize:13}}>FLEET OVERVIEW — CLICK A TURBINE TO INSPECT</div>
          <div style={{display:"flex",gap:12,marginBottom:22,flexWrap:"wrap"}}>
            {fleet.map(t=><TurbineCard key={t.turbine_id} data={t} selected={selected===t.turbine_id} onClick={()=>setSelected(t.turbine_id)}/>)}
          </div>

          {selectedData.turbine_id&&<>
            <div style={{marginBottom:8,fontWeight:600,color:"#64748b",fontSize:13}}>TURBINE {selected} — LIVE SENSORS</div>
            <div style={{display:"flex",gap:12,marginBottom:22,flexWrap:"wrap"}}>
              <div style={{background:"#1e293b",borderRadius:12,padding:20,flex:1,minWidth:160}}>
                <WindGauge value={parseFloat(selectedData.wind_speed||0)}/>
              </div>
              {sensorCards.map(s=>(
                <div key={s.label} style={{background:"#1e293b",border:`1px solid ${s.warn?"#f59e0b33":"#334155"}`,borderRadius:12,padding:20,flex:1,minWidth:130,textAlign:"center"}}>
                  <div style={{fontSize:24,marginBottom:4}}>{s.icon}</div>
                  <div style={{color:s.warn?"#f59e0b":"#f1f5f9",fontWeight:800,fontSize:20}}>{s.value}</div>
                  <div style={{color:"#64748b",fontSize:12}}>{s.label}</div>
                  {s.warn&&<div style={{color:"#f59e0b",fontSize:11,marginTop:4}}>⚠ Above threshold</div>}
                </div>
              ))}
            </div>
          </>}

          <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
            <div style={{background:"#1e293b",borderRadius:12,padding:20,flex:2,minWidth:340}}>
              <div style={{fontWeight:700,marginBottom:14}}>⚡ Power Output — {selected}</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f"/>
                  <XAxis dataKey="time" tick={{fill:"#64748b",fontSize:10}} interval="preserveStartEnd"/>
                  <YAxis tick={{fill:"#64748b",fontSize:10}}/>
                  <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155"}}/>
                  <Area type="monotone" dataKey="power_output" stroke="#3b82f6" fill="url(#pg)" strokeWidth={2} name="Power (kW)"/>
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={{background:"#1e293b",borderRadius:12,padding:20,flex:1,minWidth:240}}>
              <div style={{fontWeight:700,marginBottom:14}}>📊 Fleet Health</div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={PIE} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                    {PIE.map((e,i)=><Cell key={i} fill={e.color}/>)}
                  </Pie>
                  <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155"}}/>
                  <Legend/>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>}

        {/* ── TURBINES TAB ── */}
        {tab==="turbines"&&<>
          <div style={{marginBottom:16,fontWeight:700,fontSize:16}}>All Turbines — Detailed Status</div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {fleet.map(t=>{
              const c = STATUS_COLOR[t.status]||"#6b7280";
              return (
                <div key={t.turbine_id} style={{background:"#1e293b",border:`1px solid ${c}33`,borderLeft:`4px solid ${c}`,borderRadius:12,padding:20}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <span style={{fontSize:24}}>🌀</span>
                      <div>
                        <div style={{fontWeight:800,fontSize:17}}>Turbine {t.turbine_id}</div>
                        <div style={{color:"#64748b",fontSize:12}}>{new Date(t.timestamp).toLocaleString()}</div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <Badge status={t.status}/>
                      <span style={{color:c,fontSize:13}}>{t.confidence}% confidence</span>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                    {[
                      ["💨","Wind Speed",`${t.wind_speed} m/s`,"#3b82f6"],
                      ["⚡","Power Output",`${t.power_output} kW`,"#22c55e"],
                      ["🔄","Rotor RPM",`${t.rotor_rpm} rpm`,"#a78bfa"],
                      ["🌡","Gearbox Temp",`${t.gearbox_temp}°C`,t.gearbox_temp>65?"#f59e0b":"#94a3b8"],
                      ["🔥","Generator Temp",`${t.generator_temp}°C`,t.generator_temp>75?"#ef4444":"#94a3b8"],
                      ["〰","Blade Vibration",`${t.blade_vibration} mm/s`,t.blade_vibration>0.8?"#f59e0b":"#94a3b8"],
                    ].map(([icon,label,val,col])=>(
                      <div key={label} style={{background:"#0f172a",borderRadius:8,padding:"10px 14px",flex:1,minWidth:120}}>
                        <div style={{color:"#64748b",fontSize:11}}>{icon} {label}</div>
                        <div style={{color:col,fontWeight:700,fontSize:17,marginTop:2}}>{val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>}

        {/* ── ANALYTICS TAB ── */}
        {tab==="analytics"&&<>
          <div style={{marginBottom:16,fontWeight:700,fontSize:16}}>Fleet Analytics</div>
          <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
            <div style={{background:"#1e293b",borderRadius:12,padding:20,flex:2,minWidth:340}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontWeight:700}}>📈 Wind Speed vs Power</div>
                <select value={selected} onChange={e=>setSelected(e.target.value)} style={{background:"#0f172a",border:"1px solid #334155",color:"#f1f5f9",borderRadius:6,padding:"4px 8px",fontSize:12}}>
                  {TURBINE_IDS.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f"/>
                  <XAxis dataKey="time" tick={{fill:"#64748b",fontSize:10}} interval="preserveStartEnd"/>
                  <YAxis yAxisId="left"  tick={{fill:"#64748b",fontSize:10}}/>
                  <YAxis yAxisId="right" orientation="right" tick={{fill:"#64748b",fontSize:10}}/>
                  <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155"}}/>
                  <Legend/>
                  <Line yAxisId="left"  type="monotone" dataKey="power_output" stroke="#3b82f6" dot={false} strokeWidth={2} name="Power (kW)"/>
                  <Line yAxisId="right" type="monotone" dataKey="wind_speed"   stroke="#22c55e" dot={false} strokeWidth={2} name="Wind (m/s)"/>
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{background:"#1e293b",borderRadius:12,padding:20,flex:1,minWidth:280}}>
              <div style={{fontWeight:700,marginBottom:14}}>🌡 Temperature Trend</div>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f"/>
                  <XAxis dataKey="time" tick={{fill:"#64748b",fontSize:10}} interval="preserveStartEnd"/>
                  <YAxis tick={{fill:"#64748b",fontSize:10}}/>
                  <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155"}}/>
                  <Legend/>
                  <Line type="monotone" dataKey="gearbox_temp" stroke="#f59e0b" dot={false} strokeWidth={2} name="Gearbox (°C)"/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{background:"#1e293b",borderRadius:12,padding:20,marginTop:18}}>
            <div style={{fontWeight:700,marginBottom:14}}>〰 Blade Vibration History</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={history.slice(-20)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5f"/>
                <XAxis dataKey="time" tick={{fill:"#64748b",fontSize:10}} interval="preserveStartEnd"/>
                <YAxis tick={{fill:"#64748b",fontSize:10}}/>
                <Tooltip contentStyle={{background:"#0f172a",border:"1px solid #334155"}}/>
                <Bar dataKey="blade_vibration" fill="#a78bfa" name="Vibration (mm/s)" radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>}

        {/* ── ALERTS TAB ── */}
        {tab==="alerts"&&<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontWeight:700,fontSize:16}}>🔔 Active Alerts ({alerts.length})</div>
            <button onClick={handleDownloadPDF} disabled={pdfLoading}
              style={{background:"linear-gradient(135deg,#3b82f6,#1d4ed8)",border:"none",color:"#fff",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontWeight:700,fontSize:13}}>
              {pdfLoading?"⏳ Generating...":"📥 Download PDF Report"}
            </button>
          </div>
          {alerts.length===0
            ?<div style={{background:"#1e293b",borderRadius:12,padding:48,textAlign:"center",color:"#64748b"}}>
               ✅ All turbines operating normally. No active alerts.
             </div>
            :alerts.map(a=><AlertCard key={a.id} alert={a} onAck={ackAlert}/>)
          }
        </>}

      </div>
    </div>
  );
}