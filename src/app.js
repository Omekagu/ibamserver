const dns = require('dns')
dns.setServers(['8.8.8.8', '8.8.4.4'])

const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const compression = require('compression')
const rateLimit = require('express-rate-limit')

const AppError = require('./utils/AppError')

// Routes
const authRoutes = require('./routes/auth.routes')
const usersRoutes = require('./routes/users.routes')
const triageRoutes = require('./routes/triage.routes')
const doctorsRoutes = require('./routes/doctors.routes')
const appointmentsRoutes = require('./routes/appointments.routes')
const consultationsRoutes = require('./routes/consultations.routes')
const prescriptionsRoutes = require('./routes/prescriptions.routes')
const pharmacyRoutes = require('./routes/pharmacy.routes')
const diagnosticsRoutes = require('./routes/diagnostics.routes')
const notificationsRoutes = require('./routes/notifications.routes')
const paymentsRoutes = require('./routes/payments.routes')
const subscriptionsRoutes = require('./routes/subscriptions.routes')
const facilitiesRoutes = require('./routes/facilities.routes')
const productSubscriptionsRoutes = require('./routes/productSubscriptions.routes')
const wellnessPackagesRoutes = require('./routes/wellnessPackages.routes')
const adminRoutes = require('./routes/admin.routes')
const reviewsRoutes = require('./routes/reviews.routes')
const kycRoutes = require('./routes/kyc.routes')

// Fail fast on weak secrets
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET must be at least 32 characters. Exiting.')
  process.exit(1)
}
if (!process.env.PAYSTACK_SECRET_KEY) {
  console.error('[FATAL] PAYSTACK_SECRET_KEY is not set. Exiting.')
  process.exit(1)
}

const app = express()

// Trust the first proxy hop (nginx, hosting platform, etc.)
// Required for express-rate-limit to read X-Forwarded-For correctly
app.set('trust proxy', 1)

// Request timeout — kills hanging requests after 15 s
app.use((req, res, next) => {
  res.setTimeout(15_000, () => {
    if (!res.headersSent)
      res.status(408).json({ status: 'fail', message: 'Request timed out.' })
  })
  next()
})

// Security & middleware
app.use(helmet())
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (native mobile apps, Postman, server-to-server)
      // and any browser origin — restrict per-env in production via CLIENT_URL allowlist
      if (!origin) return callback(null, true)
      const allowed = [process.env.CLIENT_URL].filter(Boolean)
      if (allowed.includes(origin) || process.env.NODE_ENV !== 'production') {
        return callback(null, true)
      }
      callback(new Error(`CORS: origin ${origin} not allowed`))
    },
    credentials: true
  })
)
app.use(compression())
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'))

// Paystack webhook needs raw body — must come before express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Global rate limit — raised to accommodate in-call polling (messages + prescriptions)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: {
    status: 'fail',
    message: 'Too many requests. Please try again later.'
  }
})
app.use('/api', limiter)

// Stricter rate limit for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    status: 'fail',
    message: 'Too many auth attempts. Try again in 15 minutes.'
  }
})
app.use('/api/auth', authLimiter)

// Health check
app.get('/health', (req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
)

// API routes
app.use('/api/auth', authRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/triage', triageRoutes)
app.use('/api/doctors', doctorsRoutes)
app.use('/api/appointments', appointmentsRoutes)
app.use('/api/consultations', consultationsRoutes)
app.use('/api/prescriptions', prescriptionsRoutes)
app.use('/api/pharmacy', pharmacyRoutes)
app.use('/api/diagnostics', diagnosticsRoutes)
app.use('/api/notifications', notificationsRoutes)
app.use('/api/payments', paymentsRoutes)
app.use('/api/subscriptions', subscriptionsRoutes)
app.use('/api/facilities', facilitiesRoutes)
app.use('/api/product-subscriptions', productSubscriptionsRoutes)
app.use('/api/wellness-packages', wellnessPackagesRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/reviews', reviewsRoutes)
app.use('/api/kyc', kycRoutes)

// 404 handler
app.all('/{*path}', (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found.`, 404))
})

// Global error handler
app.use((err, req, res, next) => {
  // Normalise known error types first (so dev mode also gets correct status codes)

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ status: 'fail', message: 'Invalid token. Please log in again.' })
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ status: 'fail', message: 'Token expired. Please log in again.' })
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field'
    return res.status(409).json({ status: 'fail', message: `${field} already in use.` })
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(e => e.message).join('. ')
    return res.status(400).json({ status: 'fail', message })
  }

  const statusCode = err.statusCode || 500
  const status = err.status || 'error'

  if (process.env.NODE_ENV === 'development') {
    return res.status(statusCode).json({ status, message: err.message, stack: err.stack })
  }

  if (err.isOperational) {
    return res.status(statusCode).json({ status, message: err.message })
  }

  console.error('Unexpected error:', err)
  res.status(500).json({ status: 'error', message: 'Something went wrong.' })
})

module.exports = app
