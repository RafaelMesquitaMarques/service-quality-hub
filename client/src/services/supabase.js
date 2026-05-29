import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://kbunsdmpesivntujvuzi.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_DnzhWdbzaT8DuYOdZg5rgg_7G3_VxD7'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export default supabase
