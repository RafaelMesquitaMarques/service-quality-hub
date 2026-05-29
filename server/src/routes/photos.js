const router = require('express').Router({ mergeParams: true })
const multer = require('multer')
const supabase = require('../db/client')
const { requireAuth, requireRole } = require('../middleware/auth')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per photo
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  }
})

// POST /api/tickets/:ticketId/photos
router.post('/', requireAuth, upload.array('photos', 10), async (req, res) => {
  const { ticketId } = req.params
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' })
  }

  const results = []

  for (const file of req.files) {
    const ext = file.originalname.split('.').pop()
    const key = `${ticketId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    // Upload to Supabase Storage
    const { error: storageErr } = await supabase.storage
      .from('ticket-photos')
      .upload(key, file.buffer, { contentType: file.mimetype })

    if (storageErr) {
      console.error('Storage error:', storageErr)
      continue
    }

    // Save metadata to DB
    const { data: photo } = await supabase
      .from('ticket_photos')
      .insert({
        ticket_id: ticketId,
        storage_key: key,
        filename: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        uploaded_by: req.user.id
      })
      .select()
      .single()

    results.push(photo)
  }

  res.status(201).json(results)
})

// GET /api/tickets/:ticketId/photos/:photoId/url
// Returns a signed URL (valid 60 minutes)
router.get('/:photoId/url', requireAuth, async (req, res) => {
  const { data: photo, error } = await supabase
    .from('ticket_photos')
    .select('storage_key')
    .eq('id', req.params.photoId)
    .eq('ticket_id', req.params.ticketId)
    .single()

  if (error) return res.status(404).json({ error: 'Photo not found' })

  const { data: signed } = await supabase.storage
    .from('ticket-photos')
    .createSignedUrl(photo.storage_key, 3600)

  res.json({ url: signed.signedUrl })
})

// DELETE /api/tickets/:ticketId/photos/:photoId
router.delete('/:photoId', requireAuth, async (req, res) => {
  const { data: photo, error } = await supabase
    .from('ticket_photos')
    .select('*')
    .eq('id', req.params.photoId)
    .eq('ticket_id', req.params.ticketId)
    .single()

  if (error) return res.status(404).json({ error: 'Photo not found' })

  // Only uploader or admin can delete
  if (photo.uploaded_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized to delete this photo' })
  }

  await supabase.storage.from('ticket-photos').remove([photo.storage_key])
  await supabase.from('ticket_photos').delete().eq('id', req.params.photoId)

  res.json({ message: 'Photo deleted' })
})

module.exports = router
