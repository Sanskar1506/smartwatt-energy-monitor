import express from "express";
import http from "node:http";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import { z } from "zod";
import { db } from "./db.js";

dotenv.config();
const app = express();
const server = http.createServer(app);
const origin = process.env.CORS_ORIGIN || "http://localhost:5173";
const io = new Server(server, { cors: { origin: origin.split(","), methods: ["GET","POST","PUT"] } });
app.use(cors({ origin: origin.split(",") }));
app.use(express.json({ limit: "64kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "0.0.0.0";
const readingSchema = z.object({
  deviceId: z.string().min(1).max(100).default("ESP32_AC_METER_01"),
  timestamp: z.string().datetime({ offset: true }).optional(),
  voltage: z.number().finite().min(0).max(500),
  current: z.number().finite().min(0).max(200),
  power: z.number().finite().min(0).max(100000),
  energy: z.number().finite().min(0).max(1e9),
  powerFactor: z.number().finite().min(0).max(1),
  frequency: z.number().finite().gt(0).max(100),
  temperature: z.number().finite().min(-40).max(150),
  wifiRssi: z.number().int().min(-120).max(0).optional(),
  ipAddress: z.string().max(100).optional(),
  uptimeSeconds: z.number().int().min(0).optional(),
  firmwareVersion: z.string().max(40).optional(),
  source: z.enum(["esp32","simulation"]).optional()
});
const nowIso = () => new Date().toISOString();
const rowToReading = r => r && ({...r, powerFactor:r.power_factor, deviceId:r.device_id, timestamp:r.timestamp, source:r.source, powerFactorAlias:undefined, power_factor:undefined, device_id:undefined});
function saveReading(data, source = data.source || "esp32") {
  const timestamp = data.timestamp || nowIso();
  const insert = db.prepare(`INSERT INTO readings(device_id,timestamp,voltage,current,power,energy,power_factor,frequency,temperature,source)
    VALUES(@deviceId,@timestamp,@voltage,@current,@power,@energy,@powerFactor,@frequency,@temperature,@source)`);
  const result = insert.run({...data, timestamp, source});
  const reading = { id:Number(result.lastInsertRowid), deviceId:data.deviceId, timestamp, voltage:data.voltage,
    current:data.current, power:data.power, energy:data.energy, powerFactor:data.powerFactor,
    frequency:data.frequency, temperature:data.temperature, source };
  db.prepare(`INSERT INTO devices(device_id,name,last_seen,source,wifi_rssi,ip_address,uptime_seconds,firmware_version)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET last_seen=excluded.last_seen, source=excluded.source,
    wifi_rssi=COALESCE(excluded.wifi_rssi,devices.wifi_rssi), ip_address=COALESCE(excluded.ip_address,devices.ip_address),
    uptime_seconds=COALESCE(excluded.uptime_seconds,devices.uptime_seconds), firmware_version=COALESCE(excluded.firmware_version,devices.firmware_version)`)
    .run(data.deviceId, data.deviceId.replaceAll("_"," "), timestamp, source, data.wifiRssi ?? null, data.ipAddress ?? null, data.uptimeSeconds ?? null, data.firmwareVersion ?? null);
  io.emit("reading", reading);
  checkAlerts(reading);
  return reading;
}
function getSettings() {
  return Object.fromEntries(db.prepare("SELECT key,value FROM settings").all().map(x => [x.key, Number.isNaN(Number(x.value)) ? x.value : Number(x.value)]));
}
function checkAlerts(r) {
  const s = getSettings(), checks = [
    ["HIGH_VOLTAGE",r.voltage > s.maxVoltage,"warning",`High voltage detected: ${r.voltage.toFixed(1)} V`,r.voltage],
    ["LOW_VOLTAGE",r.voltage < s.minVoltage,"warning",`Low voltage detected: ${r.voltage.toFixed(1)} V`,r.voltage],
    ["HIGH_CURRENT",r.current > s.maxCurrent,"critical",`High current detected: ${r.current.toFixed(2)} A`,r.current],
    ["HIGH_POWER",r.power > s.maxPower,"critical",`High power detected: ${(r.power/1000).toFixed(2)} kW`,r.power],
    ["LOW_POWER_FACTOR",r.powerFactor < s.minPowerFactor,"warning",`Low power factor: ${r.powerFactor.toFixed(2)}`,r.powerFactor],
    ["HIGH_TEMPERATURE",r.temperature > s.maxTemperature,"critical",`High temperature: ${r.temperature.toFixed(1)} °C`,r.temperature]
  ];
  const ins = db.prepare("INSERT INTO alerts(device_id,timestamp,severity,code,message,value) VALUES(?,?,?,?,?,?)");
  for (const [code,hit,severity,message,value] of checks) if (hit) {
    const recent = db.prepare("SELECT id FROM alerts WHERE device_id=? AND code=? AND timestamp > datetime('now','-60 seconds') LIMIT 1").get(r.deviceId,code);
    if (!recent) { const a={id:Number(ins.run(r.deviceId,nowIso(),severity,code,message,value).lastInsertRowid),deviceId:r.deviceId,timestamp:nowIso(),severity,code,message,value,acknowledged:false}; io.emit("alert",a); }
  }
}
app.get("/api/health", (_req,res)=>res.json({ok:true,service:"SmartWatt API",time:nowIso(),simulationEnabled:process.env.SIMULATION_ENABLED === "true"}));
app.post("/api/readings", (req,res) => {
  const key = process.env.API_KEY;
  if (key && req.get("x-api-key") !== key) return res.status(401).json({error:"Invalid or missing device API key"});
  const parsed = readingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({error:"Invalid reading payload",details:parsed.error.issues.map(i=>({field:i.path.join("."),message:i.message}))});
  try { const reading=saveReading(parsed.data); res.status(201).json({ok:true,reading}); }
  catch (e) { console.error(e); res.status(500).json({error:"Could not store reading"}); }
});
app.get("/api/readings/latest", (req,res) => {
  const deviceId=req.query.deviceId || "ESP32_AC_METER_01";
  const r=db.prepare("SELECT * FROM readings WHERE device_id=? ORDER BY timestamp DESC,id DESC LIMIT 1").get(deviceId);
  res.json({reading:rowToReading(r),settings:getSettings()});
});
app.get("/api/readings/history", (req,res) => {
  const limit=Math.min(1000,Math.max(1,Number(req.query.limit)||100));
  const page=Math.max(1,Number(req.query.page)||1);
  const deviceId=String(req.query.deviceId||"ESP32_AC_METER_01");
  const from=req.query.from ? new Date(String(req.query.from)).toISOString() : "1970-01-01T00:00:00.000Z";
  const to=req.query.to ? new Date(String(req.query.to)).toISOString() : "2999-01-01T00:00:00.000Z";
  const count=db.prepare("SELECT COUNT(*) n FROM readings WHERE device_id=? AND timestamp BETWEEN ? AND ?").get(deviceId,from,to).n;
  const rows=db.prepare("SELECT * FROM readings WHERE device_id=? AND timestamp BETWEEN ? AND ? ORDER BY timestamp DESC,id DESC LIMIT ? OFFSET ?").all(deviceId,from,to,limit,(page-1)*limit).map(rowToReading);
  res.json({rows,total:count,page,limit,pages:Math.ceil(count/limit)});
});
app.get("/api/readings/daily", (req,res) => {
  const days=Math.min(366,Math.max(1,Number(req.query.days)||7));
  const rows=db.prepare(`SELECT date(timestamp) day, MAX(energy)-MIN(energy) energyDelta, AVG(power) avgPower, MAX(power) peakPower
    FROM readings WHERE device_id=? AND timestamp >= datetime('now', ?) GROUP BY date(timestamp) ORDER BY day`)
    .all(String(req.query.deviceId||"ESP32_AC_METER_01"),`-${days} days`);
  res.json(rows.map(r=>({day:r.day,energyKwh:Math.max(0,r.energyDelta||0),averagePowerKw:(r.avgPower||0)/1000,peakPowerKw:(r.peakPower||0)/1000})));
});
app.get("/api/analytics", (req,res) => {
  const deviceId=String(req.query.deviceId||"ESP32_AC_METER_01");
  const s=getSettings();
  const latest=db.prepare("SELECT * FROM readings WHERE device_id=? ORDER BY timestamp DESC,id DESC LIMIT 1").get(deviceId);
  const today=db.prepare("SELECT MIN(energy) minE,MAX(energy) maxE,AVG(power) avgP,MAX(power) peakP,COUNT(*) count FROM readings WHERE device_id=? AND date(timestamp)=date('now','localtime')").get(deviceId);
  const week=db.prepare("SELECT MIN(energy) minE,MAX(energy) maxE FROM readings WHERE device_id=? AND timestamp >= datetime('now','-7 days')").get(deviceId);
  const month=db.prepare("SELECT MIN(energy) minE,MAX(energy) maxE FROM readings WHERE device_id=? AND timestamp >= datetime('now','start of month')").get(deviceId);
  const delta=x=>Math.max(0,(x.maxE||0)-(x.minE||0));
  res.json({latest:rowToReading(latest),today:{energyKwh:delta(today),cost:delta(today)*s.tariff,averagePowerKw:(today.avgP||0)/1000,peakPowerKw:(today.peakP||0)/1000,readings:today.count},week:{energyKwh:delta(week),cost:delta(week)*s.tariff},month:{energyKwh:delta(month),cost:delta(month)*s.tariff},settings:s});
});
app.get("/api/devices", (_req,res)=>res.json(db.prepare("SELECT * FROM devices ORDER BY device_id").all()));
app.get("/api/alerts", (req,res)=> {
  const limit=Math.min(200,Math.max(1,Number(req.query.limit)||50));
  res.json(db.prepare("SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ?").all(limit).map(a=>({...a,acknowledged:!!a.acknowledged})));
});
app.post("/api/alerts/:id/acknowledge", (req,res)=> {
  const result=db.prepare("UPDATE alerts SET acknowledged=1 WHERE id=?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({error:"Alert not found"});
  io.emit("alert-acknowledged",{id:Number(req.params.id)}); res.json({ok:true});
});
app.get("/api/settings", (_req,res)=>res.json(getSettings()));
app.put("/api/settings", (req,res)=> {
  const allowed=["tariff","minVoltage","maxVoltage","maxCurrent","maxPower","minPowerFactor","maxTemperature","offlineSeconds","retentionDays"];
  const updates=Object.entries(req.body||{}).filter(([k,v])=>allowed.includes(k)&&Number.isFinite(Number(v))&&Number(v)>=0);
  const put=db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const tx=db.transaction(()=>updates.forEach(([k,v])=>put.run(k,String(v))));
  tx(); res.json(getSettings());
});
app.get("/api/export", (req,res)=> {
  const format=String(req.query.format||"json");
  const rows=db.prepare("SELECT timestamp,device_id,voltage,current,power,energy,power_factor,frequency,temperature,source FROM readings WHERE device_id=? ORDER BY timestamp DESC LIMIT 50000").all(String(req.query.deviceId||"ESP32_AC_METER_01"));
  if(format==="csv"){res.type("text/csv");res.setHeader("Content-Disposition",'attachment; filename="energy-readings.csv"');const keys=Object.keys(rows[0]||{timestamp:"",device_id:"",voltage:"",current:"",power:"",energy:"",power_factor:"",frequency:"",temperature:"",source:""});return res.send([keys.join(","),...rows.map(r=>keys.map(k=>JSON.stringify(r[k]??"")).join(","))].join("\n"));}
  res.json(rows);
});
io.on("connection", socket=>{socket.emit("connected",{time:nowIso()});});
const simulationOn = process.env.SIMULATION_ENABLED === "true";
if (simulationOn) {
  let energy=12.48, tick=0;
  setInterval(()=>{
    tick++;
    const hour=new Date().getHours();
    const base=hour>=18&&hour<=22?1350:hour>=7&&hour<=10?850:450;
    const power=Math.max(80,base+Math.sin(tick/5)*240+(Math.random()-.5)*180);
    const voltage=230+Math.sin(tick/9)*2.5+(Math.random()-.5)*1.8;
    const current=power/(voltage*(0.88+Math.random()*.08));
    energy+=power/1000*(Number(process.env.SIMULATION_INTERVAL_MS||2000)/3600000);
    try { saveReading({deviceId:"ESP32_AC_METER_01",timestamp:nowIso(),voltage,current,power,energy,powerFactor:Math.min(0.99,Math.max(.75,.91+(Math.random()-.5)*.12)),frequency:50+(Math.random()-.5)*.08,temperature:33+Math.sin(tick/30)*2+Math.random(),wifiRssi:-48-Math.round(Math.random()*18),ipAddress:"192.168.1.120",uptimeSeconds:tick*2,firmwareVersion:"1.0.0",source:"simulation"},"simulation"); } catch(e) { console.error("Simulation error",e); }
  },Math.max(1000,Number(process.env.SIMULATION_INTERVAL_MS)||2000));
}
server.listen(port,host,()=>console.log(`SmartWatt API listening at http://${host}:${port} | simulation=${simulationOn}`));
