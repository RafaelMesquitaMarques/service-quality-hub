import axios from 'axios'

const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL}/api`,
  timeout: 30000,
})

// Response interceptor — redirect to login on 401
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
  console.log('401 error:', err.config?.url)
}
    return Promise.reject(err)
  }
)

export default api

// Ticket API helpers
export const ticketApi = {
  list:   (params) => api.get('/tickets', { params }),
  get:    (id)     => api.get(`/tickets/${id}`),
  create: (data)   => api.post('/tickets', data),
  update: (id, data) => api.patch(`/tickets/${id}`, data),
  remove: (id)     => api.delete(`/tickets/${id}`),
  export: (params) => api.get('/tickets/export/xlsx', { params, responseType: 'blob' }),
}

export const photoApi = {
  upload: (ticketId, files) => {
    const form = new FormData()
    files.forEach(f => form.append('photos', f))
    return api.post(`/tickets/${ticketId}/photos`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  getUrl: (ticketId, photoId) => api.get(`/tickets/${ticketId}/photos/${photoId}/url`),
  remove: (ticketId, photoId) => api.delete(`/tickets/${ticketId}/photos/${photoId}`),
}

export const meetingApi = {
  list:       ()     => api.get('/meetings'),
  getByDate:  (date) => api.get(`/meetings/${date}`),
  create:     (data) => api.post('/meetings', data),
  updateNotes:(date, notes) => api.patch(`/meetings/${date}/notes`, { notes }),
}

export const importApi = {
  preview: (file) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/import/preview', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  run: (file, skipDuplicates = false) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/import/excel?skipDuplicates=${skipDuplicates}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  }
}

export const adminApi = {
  users:        ()          => api.get('/admin/users'),
  createUser:   (data)      => api.post('/admin/users', data),
  updateUser:   (id, data)  => api.patch(`/admin/users/${id}`, data),
  deactivate:   (id)        => api.delete(`/admin/users/${id}`),
  stats:        ()          => api.get('/admin/stats'),
}
