# SmartWatt — IoT AC Energy Meter Monitoring

A full-stack engineering project for monitoring AC electrical measurements from an ESP32, with a React dashboard, REST API, SQLite persistence, Socket.IO live updates, historical records, energy/cost analytics, alerts, configurable thresholds, and clearly labelled simulation mode.

## Technology
- Frontend: React + TypeScript + Vite, Recharts, Lucide, Socket.IO Client
- Backend: Node.js + Express, Socket.IO, Zod validation, rate limiting
- Database: SQLite (`better-sqlite3`) with indexes
- Device: ESP32 over Wi-Fi using HTTP POST; API is structured to add MQTT later

## Requirements
- Node.js 20 LTS or newer (recommended)
- npm
- No MySQL Workbench or separate database server is needed. SQLite database is created automatically.

## Quick start (Windows)
1. Extract this project ZIP.
2. Open the extracted `smartwatt-energy-monitor` folder in VS Code.
3. Copy `.env.example` to `.env` in the project root. For a local demo, keep `SIMULATION_ENABLED=true`.
4. Open Terminal in the project root and run:

   ```bash
   npm install
   npm run dev
   ```

5. Open **http://localhost:5173**. The API runs on **http://localhost:4000**.
6. The first simulated readings arrive within a couple of seconds. The dashboard labels them `SIMULATED DATA` / `Demo` so they cannot be mistaken for physical sensor data.

If native dependency installation fails on Windows, install the current Node.js LTS release, close/reopen the terminal, then retry `npm install`.

## Run frontend/backend separately
From the project root, run `npm install` once.
- Backend: `npm run dev:backend`
- Frontend: `npm run dev:frontend`

## Enable real ESP32 data
1. In root `.env`, set `SIMULATION_ENABLED=false`.
2. Set `API_KEY` to a long, unique value and restart the backend.
3. Find the computer's LAN IPv4 address with `ipconfig` (Windows). The ESP32 and computer must be on the same Wi-Fi/LAN.
4. Set the ESP32 endpoint to `http://COMPUTER_LAN_IP:4000/api/readings`, not `localhost`.
5. Include the `x-api-key` HTTP header with the same key configured in `.env`.
6. Send JSON fields: `deviceId`, `voltage`, `current`, `power`, `energy`, `powerFactor`, `frequency`, `temperature`. Timestamp is optional; backend assigns one if omitted.
7. Open the dashboard. If readings stop, status changes to offline after the configured timeout.

Example request:
```bash
curl -X POST http://localhost:4000/api/readings ^
  -H "Content-Type: application/json" ^
  -H "x-api-key: change-this-device-api-key" ^
  -d "{\"deviceId\":\"ESP32_AC_METER_01\",\"voltage\":231.5,\"current\":4.82,\"power\":1024.7,\"energy\":12.48,\"powerFactor\":0.92,\"frequency\":50.02,\"temperature\":34.6}"
```
For PowerShell, curl aliases can differ; use `curl.exe` or an HTTP client of your choice.

## API reference
- `GET /api/health` — service status
- `POST /api/readings` — validate, store, broadcast a measurement (requires `x-api-key` if `API_KEY` is configured)
- `GET /api/readings/latest?deviceId=ESP32_AC_METER_01`
- `GET /api/readings/history?deviceId=ESP32_AC_METER_01&limit=100&page=1`
- `GET /api/readings/daily?days=7`
- `GET /api/analytics`
- `GET /api/devices`
- `GET /api/alerts`
- `POST /api/alerts/:id/acknowledge`
- `GET /api/settings`, `PUT /api/settings`
- `GET /api/export?format=csv` — CSV download; JSON is the default

Socket.IO events:
- `reading` — emitted after a reading has been persisted
- `alert` — emitted when a threshold is crossed
- `alert-acknowledged` — emitted when an alert is acknowledged

## ESP32 Arduino example
See [`esp32/energy_meter.ino`](esp32/energy_meter.ino). The example shows the HTTP transport and placeholder measurement variables. Replace those values with calibrated measurements from your chosen, properly isolated AC energy sensor/meter module.

## Database
SQLite file is created at `backend/data/energy.db` by default. The backend creates tables and indexes on startup. The cumulative `energy` field is expected to be a monotonically increasing meter value in kWh; period consumption is estimated from max minus min recorded cumulative values within that period.

## Important measurement notes
- Simulation mode is for development/demo only.
- Cost estimates use the configured ₹/kWh rate and are estimates, not utility bills; taxes, slab tariffs, fixed charges, and time-of-use rates are not modelled.
- Daily summaries depend on timestamps and on the meter's cumulative energy counter. Ensure the sensor's energy counter and timezone semantics are consistent.
- For production, add user authentication/authorization, TLS/HTTPS, secret rotation, MQTT broker integration, backups, monitoring, and automated retention cleanup. The included `retentionDays` setting is currently a saved configuration value; automated deletion/retention scheduling is not enabled yet.
- **AC electricity can be lethal.** Do not connect an ESP32 directly to mains. Use certified isolated sensing equipment, correct fusing/enclosures, and qualified supervision.

## Production build
```bash
npm run build -w frontend
npm start -w backend
```
Serve the generated frontend `frontend/dist` with a production web server or static hosting and configure `VITE_API_URL` to your deployed API base URL (including `/api`). Configure CORS and secrets for your actual deployment.
