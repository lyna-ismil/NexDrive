# NexDrive — AIoT Car Rental Microservices Backend

A production-grade Node.js + Express + Mongoose microservices architecture for an AIoT-enabled car rental platform. Features 8 independent services behind an API Gateway with JWT authentication, role-based access control, IoT device management, and real-time vehicle telemetry.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    API Gateway :5000                     │
│  • JWT auth  • Correlation ID  • Rate limiting          │
│  • Identity header forwarding  • Service proxy          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌───────────┐  │
│  │  Admin   │ │   User    │ │   Car   │ │  Booking  │  │
│  │  :6000   │ │   :6004   │ │  :6002  │ │   :6003   │  │
│  └──────────┘ └───────────┘ └─────────┘ └───────────┘  │
│                                                         │
│  ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌───────────┐  │
│  │Reclamat. │ │ Telemetry │ │ Device  │ │Notificat. │  │
│  │  :6001   │ │   :6005   │ │  :6006  │ │   :6007   │  │
│  └──────────┘ └───────────┘ └─────────┘ └───────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Port Mapping

| Service      | Port | Database       | Description                 |
| ------------ | ---- | -------------- | --------------------------- |
| Gateway      | 5000 | —              | API Gateway + Auth          |
| Admin        | 6000 | admindb        | Admin CRUD + bcrypt         |
| Reclamation  | 6001 | reclamationdb  | Complaint/ticket management |
| Car          | 6002 | cardb          | Fleet registry + health     |
| Booking      | 6003 | bookingdb      | Reservation lifecycle       |
| User         | 6004 | userdb         | User profiles + KYC         |
| Telemetry    | 6005 | telemetrydb    | OBD/GPS IoT data ingestion  |
| Device       | 6006 | devicedb       | Device provisioning + auth  |
| Notification | 6007 | notificationdb | Multi-channel notifications |

## Prerequisites

- **Node.js** ≥ 18
- **MongoDB** running on `localhost:27017`

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — change JWT_SECRET, GATEWAY_SECRET, etc.

# 3. Start everything (gateway + all services)
npm start
# or with auto-reload:
npm run dev
```

The gateway automatically spawns all microservices and verifies health.

## Authentication

### Login (get JWT token)

```bash
# Admin login
curl -X POST http://localhost:5000/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}'

# User login
curl -X POST http://localhost:5000/auth/user/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@test.com","password":"password123"}'
```

Response: `{ "accessToken": "<jwt>", "role": "ADMIN" }`

### Using tokens

```bash
# Pass token in Authorization header
curl http://localhost:5000/cars \
  -H "Authorization: Bearer <accessToken>"
```

## Curl Test Plan

### Admin Service

```bash
# Create admin
curl -X POST http://localhost:5000/admins \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nexdrive.com","password":"SecurePass123","phone":"12345678","name":"Admin One"}'

# Get all admins
curl http://localhost:5000/admins

# Get admin by ID
curl http://localhost:5000/admins/<id>
```

### User Service

```bash
# Signup (multipart — CIN + license images required)
curl -X POST http://localhost:5000/users/signup \
  -F "email=user@test.com" \
  -F "password=password123" \
  -F "fullName=John Doe" \
  -F "phone=98765432" \
  -F "cin=@/path/to/cin.jpg" \
  -F "permis=@/path/to/license.jpg"

# Get all users
curl http://localhost:5000/users

# Get user by ID
curl http://localhost:5000/users/<id>
```

### Car Service

```bash
# Create car
curl -X POST http://localhost:5000/cars \
  -H "Content-Type: application/json" \
  -d '{"matricule":"123TU4567","marque":"Peugeot 208","location":"Tunis","visite_technique":"2026-06-01","date_assurance":"2026-12-01","vignette":"2026-03-01"}'

# Get all cars
curl http://localhost:5000/cars

# Patch car health (from telemetry)
curl -X PATCH http://localhost:5000/cars/<id>/health \
  -H "Content-Type: application/json" \
  -d '{"healthStatus":"WARN","lastKnownLocation":{"lat":36.8,"lng":10.18},"lastKnownOdometer":45000}'
```

### Booking Service

```bash
# Create booking
curl -X POST http://localhost:5000/bookings \
  -H "Content-Type: application/json" \
  -d '{"userId":"<userId>","carId":"<carId>","startDate":"2026-03-01T10:00:00Z","endDate":"2026-03-05T10:00:00Z","pickupLocation":"Tunis"}'

# Get bookings by user
curl http://localhost:5000/bookings/user/<userId>

# Confirm booking
curl -X PUT http://localhost:5000/bookings/<id>/confirm

# Cancel booking
curl -X PUT http://localhost:5000/bookings/<id>/cancel
```

### Reclamation Service

```bash
# Create reclamation
curl -X POST http://localhost:5000/reclamations \
  -H "Content-Type: application/json" \
  -d '{"userId":"<userId>","message":"Car had engine issues during rental"}'

# Assign to admin
curl -X PUT http://localhost:5000/reclamations/<id>/assign \
  -H "Content-Type: application/json" \
  -d '{"assignedAdminId":"<adminId>"}'

# Resolve
curl -X PUT http://localhost:5000/reclamations/<id>/resolve \
  -H "Content-Type: application/json" \
  -d '{"status":"RESOLVED"}'
```

### Device Service

```bash
# Register device (admin JWT required)
curl -X POST http://localhost:5000/devices \
  -H "Authorization: Bearer <adminToken>" \
  -H "Content-Type: application/json" \
  -d '{"serialNumber":"SN-001-ABC","sharedSecret":"mySecretKeyAtLeast16Chars","firmwareVersion":"1.2.0"}'

# Pair device with car
curl -X POST http://localhost:5000/devices/<id>/pair \
  -H "Authorization: Bearer <adminToken>" \
  -H "Content-Type: application/json" \
  -d '{"carId":"<carId>"}'

# Authenticate device (get device JWT)
curl -X POST http://localhost:5000/devices/authenticate \
  -H "Content-Type: application/json" \
  -d '{"serialNumber":"SN-001-ABC","sharedSecret":"mySecretKeyAtLeast16Chars"}'
```

### Telemetry Service

```bash
# Ingest telemetry (device JWT required)
curl -X POST http://localhost:5000/telemetry \
  -H "Authorization: Bearer <deviceToken>" \
  -H "Content-Type: application/json" \
  -d '{"ts":"2026-02-20T12:00:00Z","payload":{"speed":60,"rpm":2500,"fuelLevel":75,"gps":{"lat":36.8,"lng":10.18},"engineRunning":true}}'

# Get latest telemetry for a car (admin JWT required)
curl http://localhost:5000/telemetry/cars/<carId>/latest \
  -H "Authorization: Bearer <adminToken>"

# Get telemetry range
curl "http://localhost:5000/telemetry/cars/<carId>/range?from=2026-02-01T00:00:00Z&to=2026-02-28T23:59:59Z" \
  -H "Authorization: Bearer <adminToken>"
```

### Notification Service

```bash
# Send notification (admin JWT required)
curl -X POST http://localhost:5000/notifications/send \
  -H "Authorization: Bearer <adminToken>" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: unique-key-123" \
  -d '{"userId":"<userId>","type":"BOOKING_CONFIRMED","title":"Booking Confirmed","body":"Your booking has been confirmed","channel":"IN_APP"}'

# Process notification queue
curl -X POST http://localhost:5000/notifications/process \
  -H "Authorization: Bearer <adminToken>" \
  -H "Content-Type: application/json" \
  -d '{"batchSize":10}'

# Get user notifications
curl http://localhost:5000/notifications/user/<userId>

# Test idempotency (send same key again — expect 409)
curl -X POST http://localhost:5000/notifications/send \
  -H "Authorization: Bearer <adminToken>" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: unique-key-123" \
  -d '{"userId":"<userId>","type":"SYSTEM","title":"Test","body":"Duplicate test"}'
```

### Health Checks

```bash
# Gateway health
curl http://localhost:5000/health

# All service health checks
for port in 6000 6001 6002 6003 6004 6005 6006 6007; do
  echo "Port $port:"; curl -s http://localhost:$port/health; echo
done

# List available services
curl http://localhost:5000/debug/services
```

## Key Design Decisions

- **No cross-service ObjectId refs** — all cross-service IDs are stored as opaque strings
- **Gateway is the single entry point** — validates JWT, attaches identity headers, generates correlation IDs
- **Defense-in-depth** — services can verify requests came through the gateway via `x-internal-gateway-key`
- **Device auth is separate** — IoT devices use their own JWT (via shared secret auth), not user JWTs
- **Circuit breaker** — telemetry→device service client includes retry + circuit breaker logic
- **Idempotency** — notification service supports `X-Idempotency-Key` to prevent duplicate sends
