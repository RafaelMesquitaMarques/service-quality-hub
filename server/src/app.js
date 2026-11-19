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
// Nouvelle couche API : policy + service + repository, via Knex.
// Cohabite avec ticketRoutes, qui passe encore par la clé de service.
const occurrenceRoutes = require('./routes/occurrences')

const app = express()

// Security & parsing
app.use(helmet())
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: false }))
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
app.use('/api/occurrences',    occurrenceRoutes)

// Global error handler
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500
  // Un 4xx est une réponse attendue, pas un incident. Journaliser sa pile
  // remplirait les journaux de traces à chaque refus de permission
  // ordinaire — et noierait les vraies pannes dedans. Seuls les 5xx la méritent.
  if (status >= 500) console.error(err)
  else console.warn(`${status} ${req.method} ${req.originalUrl} — ${err.message}`)
  res.status(status).json({ error: err.message || 'Internal server error' })
})

// N'écoute que lancé directement, pas quand on l'importe. Sans ce garde,
// un require de ce module démarre un serveur : impossible de tester les
// routes en processus, et un script qui ne voulait que charger le module
// reste suspendu.
if (require.main === module) {
  const PORT = process.env.PORT || 3001
  app.listen(PORT, () => console.log(`SQH server running on port ${PORT}`))
}

module.exports = app
