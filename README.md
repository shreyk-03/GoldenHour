# 🚑 Golden-Hour Emergency Triage & Hospital Routing System

A production-grade backend for real-time emergency dispatch — predicts patient care needs from EMT vitals and routes ambulances to the **optimal hospital** based on live capacity, specialist availability, and transit time.

---

## Architecture Overview

```
EMT Reports Vitals
       │
       ▼
┌─────────────────────┐
│  Severity Predictor  │  NEWS2 clinical scoring → ICU / Ventilator / Specialist needs
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Routing Engine     │  Constraint optimization → scores every hospital (0-100)
│                     │  Weights: Care(35) + Beds(20) + Load(15) + Specialist(20) + Transit(10)
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Dispatch Service   │  Writes to Upstash Redis (lock + versioned CAS); each write bumps the collection's change counter
└─────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Framework | Express.js |
| Database | Upstash Redis (provisioned through Vercel) |
| Cache | Same document store (TTL collection) |
| Real-time | SSE change stream (versioned Redis counters); WebSocket for local simulation |
| Routing API | OpenRouteService (free) / Haversine fallback |
| Validation | Joi |

---

## Quick Start

### 1. Prerequisites
```bash
# Required
node >= 20.0.0
upstash redis (install through the Vercel marketplace)
```

### 2. Clone & Install
```bash
git clone <repo>
cd emergency-triage-backend
npm install
```

### 3. Configure Environment
```bash
cp .env.example .env
# Provision Upstash Redis via Vercel, then: vercel env pull .env.local
# Set JWT_SECRET (any long random string, e.g. `openssl rand -hex 48`)
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | ✅ | Signs session tokens; the server fails fast if missing |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | ✅ | Upstash Redis REST credentials (provisioned by the Vercel integration) |
| `FRONTEND_URL` | — | CORS origin; defaults to same-origin wildcard |
| `ORS_API_KEY` | — | Real road distances and ETAs; falls back to Haversine × 1.3 road factor |
| `GEMINI_API_KEY` | — | AI dispatcher chat; falls back to built-in local replies |

### 4. Setup Database
```bash
# Seed hospitals, specialists and the three demo users
npm run seed
```

### 5. Start Server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server starts at: `http://localhost:3000`  
WebSocket at: `ws://localhost:3000/ws`

### 6. Tests
```bash
npm test                                            # backend unit tests (node:test)
cd frontend && npm run lint && npm run build        # frontend typecheck + production build
```

CI (`.github/workflows/ci.yml`) runs the backend suite and the frontend typecheck/build on every push to `main` and every pull request.

---

## Authentication & Roles

All mutating endpoints and patient reads require a JWT. Send it as `Authorization: Bearer <token>`.

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dispatcher@goldenhour.dev","password":"Dispatch#2026"}'
```

### Demo accounts (created by `npm run seed`)

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@goldenhour.dev` | `GoldenHour#2026` |
| Dispatcher | `dispatcher@goldenhour.dev` | `Dispatch#2026` |
| Hospital ops | `hospital@goldenhour.dev` | `Hospital#2026` |

| Capability | Admin | Dispatcher | Hospital |
| --- | --- | --- | --- |
| Create / reroute / batch dispatches | ✅ | ✅ | ❌ |
| Change mission status | ✅ | ✅ | ❌ |
| Update capacity / specialists | ✅ | ❌ | own hospital only |
| Read hospitals, patients, analytics | ✅ | ✅ | own hospital only |

Hospital operators get a scoped view: the dashboard shows only their facility, the mission feed and patient list contain only missions routed to them, and the capacity panel replaces the triage form.

### Auth endpoints

#### `POST /api/auth/login`
Body: `{ "email", "password" }` → `{ success, data: { token, user } }`. Rate limited to 10 attempts/minute.

#### `GET /api/auth/me`
Validates the bearer token and returns `{ id, email, name, role, hospital_id }`.

Auth configuration lives in `JWT_SECRET` (required — the server fails fast if missing) and `JWT_EXPIRES_IN` (default `12h`). Passwords are stored as bcrypt hashes.

---

## API Reference

### 🔴 Dispatch Endpoints

#### `POST /api/dispatch`
Triage + route a patient in one call. Returns optimal hospital with full rationale.

**Request Body:**
```json
{
  "incident_id": "INC-2024-001",
  "age": 34,
  "gender": "male",
  "heart_rate": 135,
  "systolic_bp": 78,
  "diastolic_bp": 50,
  "respiratory_rate": 32,
  "spo2": 86,
  "temperature": 35.1,
  "gcs_score": 8,
  "symptoms": ["major_trauma", "hemorrhage", "shock"],
  "mechanism_of_injury": "mva_high_speed",
  "chief_complaint": "Unresponsive after high-speed MVA",
  "incident_latitude": 40.7128,
  "incident_longitude": -74.0060,
  "incident_address": "I-95 Northbound, Mile 42"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "patientId": "uuid",
    "incidentId": "INC-2024-001",
    "prediction": {
      "news2Score": 16,
      "severityLevel": "critical",
      "predictedCareNeeds": {
        "icu": true,
        "ventilator": true,
        "specialist": "trauma_surgeon",
        "specialistUrgency": "immediate",
        "equipment": ["trauma_bay", "ct_scanner"]
      },
      "vitalBreakdown": [...]
    },
    "routing": {
      "optimal": {
        "hospital": { "name": "Metro General Trauma Center", ... },
        "totalScore": 74,
        "transitMinutes": 7,
        "breakdown": { "care": 35, "beds": 4, "load": 6, "specialist": 20, "transit": 9 }
      },
      "alternatives": [...]
    },
    "rationale": "ROUTING DECISION: Metro General Trauma Center\n..."
  }
}
```

---

#### `POST /api/dispatch/triage-only`
Run severity prediction only — no routing, no DB write.

**Request:** Same vitals fields as above  
**Response:** Returns `news2Score`, `severityLevel`, `predictedCareNeeds`, `vitalBreakdown`

---

#### `POST /api/dispatch/batch`
Mass Casualty Event — route up to 100 patients simultaneously with load balancing.

```json
{
  "mce_id": "MCE-2024-001",
  "description": "Highway pile-up, I-95 Mile 42",
  "patients": [
    { "incident_latitude": 40.71, "incident_longitude": -74.00, "heart_rate": 140, ... },
    { "incident_latitude": 40.71, "incident_longitude": -74.00, "heart_rate": 88, ... }
  ]
}
```

---

#### `POST /api/dispatch/:patientId/reroute`
Recalculate mid-journey (hospital reached capacity, road closure, etc.)

```json
{
  "reason": "Assigned hospital reached ICU capacity",
  "current_latitude": 40.7300,
  "current_longitude": -74.0100
}
```

---

#### `PATCH /api/dispatch/:patientId/status`
Update patient status as journey progresses.

```json
{ "status": "arrived" }
```
Valid statuses: `en_route` → `arrived` → `treated` | `cancelled`

Missions are persisted with their `incident_id` and status, so the dashboard restores active work after a page reload (`GET /api/patients` hydration) and `arrived` / `treated` updates survive refreshes. Status changes from any client arrive on other dashboards through the change stream (typically within ~2.5s), with a 60s safety reconcile and a refresh when the tab regains focus.

---

### 🏥 Hospital Endpoints

#### `GET /api/hospitals`
Returns all hospitals with live capacity and on-duty specialists.

#### `GET /api/hospitals/:id`
Single hospital with full details.

#### `PATCH /api/hospitals/:id/capacity`
Update live capacity — called by hospital management systems. Invalidates Redis cache; connected dashboards pick the change up through the SSE change stream.

```json
{
  "icu_beds_available": 10,
  "ventilators_available": 6,
  "current_load_percent": 82,
  "is_on_diversion": false
}
```

#### `PATCH /api/hospitals/:id/specialists/:specialistId`
Toggle specialist on-duty status.

```json
{ "is_on_duty": false, "on_call": true }
```

---

### 📊 Analytics Endpoints

#### `GET /api/patients/analytics/summary`
Dashboard summary — patient counts by severity, system-wide capacity, avg transit time. Dispatchers and admins see the whole network; hospital accounts see only their facility's missions and capacity. The dashboard renders these numbers as a six-stat KPI strip above the hospital grid.

#### `GET /api/hospitals/:id/capacity/history?hours=24`
Capacity trend data for a hospital over the last N hours.

---

### 📡 Change Stream

#### `GET /api/events`
Server-Sent Events stream of per-collection version counters. Every write to a collection bumps its counter, so a counter change means that collection's data moved. The payload is counters only — no patient data — which is why the stream needs no auth (`EventSource` cannot send an `Authorization` header); records still come from the authenticated JSON routes.

```text
retry: 3000

event: change
data: {"patients":"9","dispatches":"5","hospitals":"5"}
```

Each connection reads the counters with a single `MGET` every 2.5s, emits `change` when they differ, writes a keep-alive comment otherwise, and closes after 25s. `EventSource` reconnects automatically, so no serverless invocation outlives the platform limit.

The dashboard subscribes to this stream and refetches only the collections whose counter moved. A 60s reconcile and a refetch on tab refocus cover dropped streams.

---

## WebSocket Events (local simulation)

Running the server directly also starts the capacity simulator and exposes `ws://localhost:3000/ws`. Vercel functions are isolated per request, so this socket is a local development aid — deployed dashboards use the change stream above.

Connect to `ws://localhost:3000/ws`

**Events received by dashboard:**

| Event | Trigger |
|---|---|
| `DISPATCH_PROGRESS` | Triage/routing in progress |
| `DISPATCH_COMPLETE` | Patient routed, hospital assigned |
| `PATIENT_REROUTED` | Mid-journey hospital change |
| `HOSPITAL_CAPACITY_UPDATED` | Any hospital capacity change |
| `MCE_BATCH_STARTED` | Batch routing started |
| `MCE_BATCH_COMPLETE` | Batch routing finished |

**Example WebSocket payload:**
```json
{
  "type": "DISPATCH_COMPLETE",
  "patientId": "uuid",
  "severity": "critical",
  "news2Score": 16,
  "assignedHospital": {
    "name": "Metro General Trauma Center",
    "latitude": 40.7589,
    "longitude": -73.9851
  },
  "transitMinutes": 7,
  "score": 74,
  "rationale": "ROUTING DECISION: ...",
  "timestamp": "2024-01-15T14:32:00.000Z"
}
```

---

## Symptom Keywords (for `symptoms` array)

| Category | Supported Values |
|---|---|
| Neurological | `head_injury`, `stroke_symptoms`, `seizure`, `altered_consciousness`, `paralysis` |
| Cardiac | `chest_pain`, `cardiac_arrest`, `palpitations`, `stemi` |
| Respiratory | `respiratory_distress`, `shortness_of_breath`, `pneumonia` |
| Trauma | `major_trauma`, `penetrating_trauma`, `burns`, `amputation`, `hemorrhage` |
| General | `unconscious`, `shock`, `hypoglycemia`, `allergic_reaction` |

## Mechanism of Injury Keywords

`mva_high_speed`, `mva`, `fall_from_height`, `fall`, `penetrating`, `burn`, `drowning`, `electrocution`

---

## Scoring Engine Weights

| Constraint | Weight | Description |
|---|---|---|
| Care needs match | 35 pts | Equipment and capability match. Hard disqualify if ICU/ventilator unavailable |
| Bed availability | 20 pts | ICU bed ratio or general capacity percentage |
| Hospital load | 15 pts | Current occupancy %. Diversion = 0 pts |
| Specialist availability | 20 pts | On-duty = 100%, On-call = 70% (40% if immediate urgency) |
| Transit time | 10 pts | Degrades sharply beyond 20 minutes |
| MCE penalty | -8 pts/patient | Applied per assignment during mass casualty events |

---

## Project Structure

```
src/
├── server.js              # Entry point, HTTP + WebSocket init
├── app.js                 # Express app, middleware, routes
├── db/
│   ├── store.js           # Upstash-backed document store + ObjectId
│   ├── redis.js           # Cache helpers (hospital + MCE state)
│   └── seed.js            # Seed hospitals and specialists
├── services/
│   ├── severityPredictor.js  # NEWS2 triage scoring engine
│   ├── routingEngine.js      # Constraint-based hospital optimizer
│   ├── routingService.js     # Transit time (ORS API + Haversine)
│   └── dispatchService.js    # Pipeline orchestrator
├── routes/
│   ├── dispatch.js           # Dispatch + triage endpoints
│   ├── hospitals.js          # Hospital CRUD + capacity updates
│   └── patients.js           # Patient list + analytics
├── middleware/
│   ├── validation.js         # Joi schemas + validate() factory
│   └── errorHandler.js       # Global error + 404 handlers
└── websocket/
    └── broadcaster.js        # WebSocket server + event emitter

test/
├── severityPredictor.test.js  # NEWS2 scoring cases
├── routingService.test.js     # Haversine + transit fallback
└── auth.test.js               # JWT, roles, hospital scope

.github/workflows/ci.yml      # Backend tests + frontend typecheck/build
```
