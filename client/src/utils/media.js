// Shared helpers for the occurrence forms' media handling: HEIC→JPEG
// conversion (browsers can't render HEIC/HEIF), video detection, and the
// client-side video size limit.

const HEIC_RE  = /\.(heic|heif)$/i
const VIDEO_RE = /\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i

// Max video size accepted client-side. Keep in sync with the Supabase
// bucket `file_size_limit` (migration 2026-06-17) AND the project-wide
// upload limit in the Supabase dashboard (Storage → Settings).
export const MAX_VIDEO_MB    = 50
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024

export function isHeic(file) {
  return /image\/hei[cf]/i.test(file?.type || '') || HEIC_RE.test(file?.name || '')
}

export function isVideoFile(file) {
  return /^video\//i.test(file?.type || '') || VIDEO_RE.test(file?.name || '')
}

export function isVideoUrl(url = '') {
  return VIDEO_RE.test((url || '').split('?')[0])
}

// Browsers can't display HEIC/HEIF in <img> or draw it on a <canvas>, so the
// file never shows up in the request. Convert to JPEG on import. heic2any is
// imported lazily to keep its (large) wasm out of the main bundle.
export async function normalizeMediaFile(file) {
  if (!isHeic(file)) return file
  try {
    const heic2any = (await import('heic2any')).default
    const out  = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
    const blob = Array.isArray(out) ? out[0] : out
    const name = (file.name || 'photo').replace(HEIC_RE, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch (e) {
    console.warn('HEIC conversion failed, keeping original file:', e)
    return file
  }
}

// Turns a picked File into the photo object shape used by the occurrence forms.
export async function buildMediaItem(file) {
  const f     = await normalizeMediaFile(file)
  const video = isVideoFile(f)
  return {
    file: f,
    type: f.type || (video ? 'video/mp4' : 'image/jpeg'),
    name: f.name || (video ? 'video.mp4' : 'photo.jpg'),
    preview: URL.createObjectURL(f),
    dataUrl: null,
    annotated: false,
    isVideo: video,
    mediaType: video ? 'video' : 'image',
  }
}
