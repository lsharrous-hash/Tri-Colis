import axios from 'axios'

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

export const api = axios.create({
  baseURL,
  timeout: 120000,
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      // Émettre un événement global pour que le contexte Auth se déconnecte
      try {
        window.dispatchEvent(new CustomEvent('tricoli:auth-logout'))
      } catch {}
    }
    return Promise.reject(error)
  },
)

export interface LoginPayload {
  login: string
  password: string
}

export interface LoginResponse {
  token: string
  user: {
    login: string
    role: 'ADMIN' | 'DISPATCHER' | 'TRIEUR'
    sousTraitantName: string | null
  }
}

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`
  } else {
    delete api.defaults.headers.common.Authorization
  }
}

export async function login(payload: LoginPayload) {
  const { data } = await api.post<LoginResponse>('/api/login', payload)
  return data
}

// Stats
export interface StatsResponse {
  date: string | null
  totalColis: number
  scannedColis: number
  remainingColis: number
}

export async function getStatsDate(date?: string) {
  const { data } = await api.get<StatsResponse>('/api/stats/date', {
    params: date ? { date } : {},
  })
  return data
}

// Users (ADMIN)
export interface UserDTO {
  login: string
  role: 'ADMIN' | 'DISPATCHER' | 'TRIEUR'
  sousTraitantName: string | null
}

export async function getUsers() {
  const { data } = await api.get<UserDTO[]>('/api/users')
  return data
}

export async function createUser(user: { login: string; password: string; role: UserDTO['role']; sousTraitantName?: string | null }) {
  const { data } = await api.post<UserDTO>('/api/users', user)
  return data
}

export async function deleteUser(login: string) {
  const { data } = await api.delete<UserDTO>(`/api/users/${encodeURIComponent(login)}`)
  return data
}

export async function updateUser(
  login: string,
  payload: { login?: string; role?: UserDTO['role']; sousTraitantName?: string | null; password?: string }
) {
  const { data } = await api.put<UserDTO>(`/api/users/${encodeURIComponent(login)}`, payload)
  return data
}

export async function getSousTraitants() {
  const { data } = await api.get<{ sousTraitants: string[] }>('/api/sous-traitants')
  return data
}

// Chauffeurs existants
export interface ExistingChauffeur {
  name: string
  sousTraitant: string
  source: 'users' | 'mapping'
}

export async function getExistingChauffeurs() {
  const { data } = await api.get<{ chauffeurs: ExistingChauffeur[]; sousTraitants: string[] }>('/api/chauffeurs/list')
  return data
}

// Tours
export interface Tour {
  id: number
  date: string
  chauffeurName: string
  sousTraitantName: string | null
  colisCount: number
  tourneeName?: string
  isCaniao?: boolean
  isDispatcherImport?: boolean
}

export interface ToursResponse {
  tours: Tour[]
  count: number
}

export async function getTours(params?: { date?: string; sousTraitant?: string; isCaniaoOnly?: boolean }) {
  const { data } = await api.get<ToursResponse>('/api/tours', { params })
  return data
}

export async function uploadTour(file: File, date: string, sousTraitantName: string) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('date', date)
  formData.append('sousTraitantName', sousTraitantName)
  const { data } = await api.post('/api/tours/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function uploadTourCaniao(file: File, date: string) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('date', date)
  const { data } = await api.post('/api/tours/caniao', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function deleteTour(tourId: number) {
  const { data } = await api.delete(`/api/tours/${tourId}`)
  return data
}

export function downloadTour(tourId: number) {
  try {
    const authData = localStorage.getItem('tricoli.auth')
    if (!authData) {
      alert('Vous devez être connecté pour télécharger une tournée')
      return
    }
    const { token } = JSON.parse(authData)
    if (!token) {
      alert('Token manquant, veuillez vous reconnecter')
      return
    }
    const url = `${api.defaults.baseURL}/api/dispatcher/tours/${tourId}/download?token=${encodeURIComponent(token)}`
    window.open(url, '_blank')
  } catch (e) {
    alert('Erreur lors de la récupération du token')
  }
}

// =====================
// Import Unifié API
// =====================

export interface UnknownChauffeur {
  name: string
  colisCount: number
  stats: { gofo: number; cainiao: number }
}

export interface ImportUnifiedResponse {
  success?: boolean
  message?: string
  format?: string
  tours?: Array<{
    tourId: number
    chauffeur: string
    sousTraitant: string
    type: 'gofo' | 'cainiao'
    colisCount: number
    plage?: string | null
  }>
  totalImported?: number
  totalDuplicates?: number
  gofoCount?: number
  caniaoCount?: number
  elapsed?: number
  // En cas de chauffeurs inconnus
  error?: string
  unknownChauffeurs?: UnknownChauffeur[]
  sousTraitants?: string[]
  existingChauffeurs?: Array<{ name: string; sousTraitant: string }>
  parseResult?: {
    format: string
    totalColis: number
    stats: { gofo: number; cainiao: number }
    chauffeurs: Array<{ name: string; colisCount: number; stats: { gofo: number; cainiao: number } }>
  }
  filename?: string
  tourDate?: string
}

export async function importUnified(
  file: File, 
  date: string, 
  chauffeurAssignments?: Record<string, string>
): Promise<ImportUnifiedResponse> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('date', date)
  if (chauffeurAssignments) {
    formData.append('chauffeurAssignments', JSON.stringify(chauffeurAssignments))
  }
  const { data } = await api.post<ImportUnifiedResponse>('/api/import/unified', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export interface ChauffeurSummary {
  chauffeur: string
  sousTraitant: string
  gofo: { count: number }
  cainiao: { count: number }
  total: number
}

export interface ChauffeursDateSummary {
  date: string
  chauffeurs: ChauffeurSummary[]
  totals: { gofo: number; cainiao: number; total: number }
}

export async function getChauffeursSummary(date: string): Promise<ChauffeursDateSummary> {
  const { data } = await api.get<ChauffeursDateSummary>(`/api/chauffeurs/summary/${date}`)
  return data
}

export function downloadExport(chauffeur: string, date: string, type: 'gofo' | 'cainiao' | 'mutualise') {
  try {
    const authData = localStorage.getItem('tricoli.auth')
    if (!authData) {
      alert('Vous devez être connecté pour télécharger')
      return
    }
    const { token } = JSON.parse(authData)
    if (!token) {
      alert('Token manquant, veuillez vous reconnecter')
      return
    }
    // Utiliser la route existante /api/mutualized/driver/:name/export
    // type 'mutualise' = pas de filtre source, 'gofo'/'cainiao' = filtre
    let url = `${api.defaults.baseURL}/api/mutualized/driver/${encodeURIComponent(chauffeur)}/export?date=${date}&token=${encodeURIComponent(token)}`
    if (type !== 'mutualise') {
      url += `&source=${type}`
    }
    window.open(url, '_blank')
  } catch (e) {
    alert('Erreur lors du téléchargement')
  }
}

export async function addChauffeur(name: string, sousTraitant: string) {
  const { data } = await api.post('/api/chauffeurs', { name, sousTraitant })
  return data
}

export async function addSousTraitant(name: string) {
  const { data } = await api.post('/api/sous-traitants', { name })
  return data
}


