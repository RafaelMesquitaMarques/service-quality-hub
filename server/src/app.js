require('dotenv').config()
require('express-async-errors')

const express = require('express')
const cors    = require('cors')
const helmet  = require('helmet')

const authRoutes    = require('./routes/auth')
const ticketRoutes  = require('./routes/tickets')
const photoRoutes   = require('./routes/photos')
const meetingRoutes = require('./routes/meetings')
const importRoutes  = require('./routes/import')
const adminRoutes   = require('./routes/admin')

const app = express()

// Security & parsing
app.use(helmet())
app.use(cors({ origin: '*', credentials: false }))
app.use(express.json({ limit: '10mb' }))

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', env: process.env.NODE_ENV }))

// Routes
app.use('/api/auth',           authRoutes)
app.use('/api/tickets',        ticketRoutes)
app.use('/api/tickets/:ticketId/photos', photoRoutes)
app.use('/api/meetings',       meetingRoutes)
app.use('/api/import',         importRoutes)
app.use('/api/admin',          adminRoutes)

// Global error handler
app.use((err, req, res, next) => {
  console.error(err)
  const status = err.status || err.statusCode || 500
  res.status(status).json({ error: err.message || 'Internal server error' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`SQH server running on port ${PORT}`))

module.exports = app
