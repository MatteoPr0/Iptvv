import Hls from 'hls.js'
import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Tv, LogOut, Search, AlertCircle, Loader2, Film, Clapperboard, Heart, ChevronLeft, Calendar, Info, Trash2, Plus, X, Subtitles, AudioLines, Cast, ExternalLink, LogIn } from 'lucide-react'
import { auth, db } from '../firebase'
import { signInWithRedirect, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth'
import { collection, doc, setDoc, deleteDoc, onSnapshot, query } from 'firebase/firestore'

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || '',
      email: auth?.currentUser?.email || '',
      emailVerified: auth?.currentUser?.emailVerified || false,
      isAnonymous: auth?.currentUser?.isAnonymous || false,
      tenantId: auth?.currentUser?.tenantId || '',
      providerInfo: auth?.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName || '',
        email: provider.email || '',
        photoUrl: provider.photoURL || ''
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

type Credentials = {
  server: string
  username: string
  password: string
  proxyUrl: string
}

type Playlist = {
  id: string
  name: string
  credentials: Credentials
  userId?: string
  createdAt?: number
}

type XtreamUser = {
  auth: number
  status: string
}

type XtreamCategory = {
  category_id: string
  category_name: string
}

type XtreamStream = {
  stream_id: number | string
  name: string
  stream_icon?: string
  container_extension?: string
  stream_type?: 'live' | 'vod' | 'series' | 'episode'
  series_id?: number
}

type XtreamEpisode = {
  id: string
  episode_num: number
  title: string
  container_extension: string
  info: { duration_secs: number; image: string }
}

type EpgProgram = {
  id: string
  epg_id: string
  title: string
  lang: string
  start: string
  end: string
  description: string
  start_timestamp: number
  stop_timestamp: number
}

type Favorite = {
  id: string | number
  name: string
  icon?: string
  type: 'live' | 'vod' | 'series'
}

type AppState = 'login' | 'dashboard'

const initialCredentials: Credentials = {
  server: '',
  username: '',
  password: '',
  proxyUrl: '/proxy',
}

function normalizeUrl(value: string) {
  return value.trim().replace(/\/$/, '')
}

function buildProxyUrl(proxyUrl: string, targetUrl: string) {
  const proxy = normalizeUrl(proxyUrl)
  if (!proxy) {
    return targetUrl
  }
  return `${proxy}?url=${encodeURIComponent(targetUrl)}`
}

function buildApiUrl(credentials: Credentials, params: Record<string, string>) {
  const server = normalizeUrl(credentials.server)
  const baseApi = `${server}/player_api.php`
  const search = new URLSearchParams({
    username: credentials.username,
    password: credentials.password,
    ...params,
  })
  return buildProxyUrl(credentials.proxyUrl, `${baseApi}?${search.toString()}`)
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return (await response.json()) as T
}

function decodeBase64(str: string) {
  if (!str) return ''
  try {
    return decodeURIComponent(escape(window.atob(str)))
  } catch {
    try {
      return window.atob(str)
    } catch {
      return str
    }
  }
}

function toFriendlyError(error: unknown, context: 'login' | 'data') {
  if (error instanceof TypeError) {
    return 'Errore di rete o CORS. Assicurati che il Proxy URL sia corretto (es. /proxy).'
  }
  if (error instanceof Error && error.message.startsWith('HTTP 4')) {
    return context === 'login' ? 'Credenziali non valide.' : 'Richiesta rifiutata dal provider.'
  }
  return 'Errore di connessione. Controlla la rete o il proxy.'
}

type TrackInfo = { id: number; name: string; lang?: string }

function useHlsPlayer(source: string | null) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [audioTracks, setAudioTracks] = useState<TrackInfo[]>([])
  const [subtitleTracks, setSubtitleTracks] = useState<TrackInfo[]>([])
  const [currentAudio, setCurrentAudio] = useState<number>(-1)
  const [currentSubtitle, setCurrentSubtitle] = useState<number>(-1)
  const hlsRef = useRef<Hls | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !source) return

    let hls: Hls | null = null
    const isM3u8 = source.includes('.m3u8')

    if (isM3u8 && Hls.isSupported() && !video.canPlayType('application/vnd.apple.mpegurl')) {
      hls = new Hls()
      hlsRef.current = hls
      hls.loadSource(source)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const aTracks = hls!.audioTracks.map(t => ({ id: t.id, name: t.name, lang: t.lang }))
        setAudioTracks(aTracks)
        setCurrentAudio(hls!.audioTrack)

        const sTracks = hls!.subtitleTracks.map(t => ({ id: t.id, name: t.name, lang: t.lang }))
        setSubtitleTracks(sTracks)
        setCurrentSubtitle(hls!.subtitleTrack)
      })

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (e, data) => {
        setCurrentAudio(data.id)
      })

      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (e, data) => {
        setCurrentSubtitle(data.id)
      })

    } else {
      video.src = source
    }

    return () => {
      if (hls) hls.destroy()
      hlsRef.current = null
      video.removeAttribute('src')
      video.load()
      setAudioTracks([])
      setSubtitleTracks([])
      setCurrentAudio(-1)
      setCurrentSubtitle(-1)
    }
  }, [source])

  const setAudioTrack = (id: number) => {
    if (hlsRef.current) hlsRef.current.audioTrack = id
  }

  const setSubtitleTrack = (id: number) => {
    if (hlsRef.current) hlsRef.current.subtitleTrack = id
  }

  return { videoRef, audioTracks, subtitleTracks, currentAudio, currentSubtitle, setAudioTrack, setSubtitleTrack }
}

export default function Home() {
  const [credentials, setCredentials] = useState<Credentials>(initialCredentials)
  const [appState, setAppState] = useState<AppState>('login')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'live' | 'vod' | 'series' | 'favorites'>('live')
  const [categories, setCategories] = useState<XtreamCategory[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('')
  
  const [streams, setStreams] = useState<XtreamStream[]>([])
  const [allStreamsCache, setAllStreamsCache] = useState<Record<string, XtreamStream[]>>({})
  const [selectedStream, setSelectedStream] = useState<XtreamStream | null>(null)
  const [isPlayerExpanded, setIsPlayerExpanded] = useState(false)
  const [isDataLoading, setIsDataLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Series State
  const [selectedSeries, setSelectedSeries] = useState<XtreamStream | null>(null)
  const [seriesEpisodes, setSeriesEpisodes] = useState<Record<string, XtreamEpisode[]>>({})
  const [selectedSeason, setSelectedSeason] = useState<string>('')

  // EPG State
  const [epg, setEpg] = useState<EpgProgram[]>([])
  const [isEpgLoading, setIsEpgLoading] = useState(false)

  // Favorites State
  const [favorites, setFavorites] = useState<Favorite[]>(() => {
    try {
      const saved = localStorage.getItem('iptv_favorites')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // Playlists State
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [playlistName, setPlaylistName] = useState('')
  const [savePlaylist, setSavePlaylist] = useState(true)

  // Auth Listener
  useEffect(() => {
    if (!auth) {
      setIsAuthReady(true)
      setError("Errore di configurazione Firebase. Controlla le impostazioni.")
      return
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setIsAuthReady(true)
    })
    return () => unsubscribe()
  }, [])

  // Sync Playlists from Firestore
  useEffect(() => {
    if (!isAuthReady) return
    if (!user || !db) {
      setPlaylists([])
      return
    }

    const q = query(collection(db, `users/${user.uid}/playlists`))
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedPlaylists: Playlist[] = []
      snapshot.forEach((doc) => {
        fetchedPlaylists.push(doc.data() as Playlist)
      })
      setPlaylists(fetchedPlaylists)
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/playlists`)
    })

    return () => unsubscribe()
  }, [user, isAuthReady])

  const handleGoogleLogin = async () => {
    if (!auth) {
      setError("Autenticazione non disponibile.")
      return
    }
    try {
      const provider = new GoogleAuthProvider()
      await signInWithPopup(auth, provider)
    } catch (error) {
      console.error("Google Login Error:", error)
      setError("Errore durante l'accesso con Google.")
    }
  }

  const handleLogout = async () => {
    if (!auth) return
    try {
      await signOut(auth)
      setAppState('login')
      setCredentials(initialCredentials)
      setPlaylists([])
    } catch (error) {
      console.error("Logout Error:", error)
    }
  }

  const toggleFavorite = (stream: XtreamStream, type: 'live' | 'vod' | 'series') => {
    setFavorites(prev => {
      const exists = prev.find(f => f.id === (stream.series_id || stream.stream_id))
      if (exists) {
        return prev.filter(f => f.id !== (stream.series_id || stream.stream_id))
      }
      return [...prev, { 
        id: stream.series_id || stream.stream_id, 
        name: stream.name, 
        icon: stream.stream_icon, 
        type 
      }]
    })
  }

  const isFavorite = (id: string | number) => favorites.some(f => f.id === id)

  const { streamUrl, directStreamUrl } = useMemo(() => {
    if (!selectedStream) return { streamUrl: null, directStreamUrl: null }
    const server = normalizeUrl(credentials.server)
    let target = ''
    
    if (selectedStream.stream_type === 'vod') {
      const ext = selectedStream.container_extension || 'mp4'
      target = `${server}/movie/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${selectedStream.stream_id}.${ext}`
    } else if (selectedStream.stream_type === 'episode') {
      const ext = selectedStream.container_extension || 'mp4'
      target = `${server}/series/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${selectedStream.stream_id}.${ext}`
    } else {
      target = `${server}/live/${encodeURIComponent(credentials.username)}/${encodeURIComponent(credentials.password)}/${selectedStream.stream_id}.m3u8`
    }
    return { 
      streamUrl: buildProxyUrl(credentials.proxyUrl, target),
      directStreamUrl: target
    }
  }, [credentials, selectedStream])

  const { videoRef, audioTracks, subtitleTracks, currentAudio, currentSubtitle, setAudioTrack, setSubtitleTrack } = useHlsPlayer(streamUrl)

  const isLoginValid = useMemo(() => {
    return credentials.server.trim().length > 5 && credentials.username.trim().length > 0 && credentials.password.trim().length > 0
  }, [credentials])

  const updateField = (field: keyof Credentials, value: string) => {
    setCredentials(current => ({ ...current, [field]: value }))
  }

  const loadCategories = async (tab: 'live' | 'vod' | 'series', creds = credentials) => {
    const action = tab === 'live' ? 'get_live_categories' : tab === 'vod' ? 'get_vod_categories' : 'get_series_categories'
    const url = buildApiUrl(creds, { action })
    return await fetchJson<XtreamCategory[]>(url)
  }

  const loadStreams = async (categoryId: string, tab: 'live' | 'vod' | 'series', creds = credentials) => {
    setIsDataLoading(true)
    setError(null)
    try {
      const action = tab === 'live' ? 'get_live_streams' : tab === 'vod' ? 'get_vod_streams' : 'get_series'
      const url = buildApiUrl(creds, { action, category_id: categoryId })
      const data = await fetchJson<any[]>(url)
      
      const typedData: XtreamStream[] = data.map(s => ({
        stream_id: s.stream_id || s.series_id,
        series_id: s.series_id,
        name: s.name,
        stream_icon: s.stream_icon || s.cover,
        container_extension: s.container_extension,
        stream_type: tab
      }))
      
      setStreams(typedData)
    } catch (e) {
      setError(toFriendlyError(e, 'data'))
    } finally {
      setIsDataLoading(false)
    }
  }

  const fetchAllStreamsForTab = async (tab: 'live' | 'vod' | 'series') => {
    if (allStreamsCache[tab]) return allStreamsCache[tab]
    
    const action = tab === 'live' ? 'get_live_streams' : tab === 'vod' ? 'get_vod_streams' : 'get_series'
    const url = buildApiUrl(credentials, { action }) // No category_id fetches all
    const data = await fetchJson<any[]>(url)
    
    const typedData: XtreamStream[] = data.map(s => ({
      stream_id: s.stream_id || s.series_id,
      series_id: s.series_id,
      name: s.name,
      stream_icon: s.stream_icon || s.cover,
      container_extension: s.container_extension,
      stream_type: tab
    }))
    
    setAllStreamsCache(prev => ({ ...prev, [tab]: typedData }))
    return typedData
  }

  useEffect(() => {
    const performGlobalSearch = async () => {
      if (searchQuery.trim().length >= 2 && activeTab !== 'favorites') {
        setIsDataLoading(true)
        try {
          const all = await fetchAllStreamsForTab(activeTab as 'live' | 'vod' | 'series')
          const query = searchQuery.toLowerCase()
          setStreams(all.filter(s => s.name.toLowerCase().includes(query)))
        } catch (e) {
          console.error("Failed to fetch all streams for search", e)
        } finally {
          setIsDataLoading(false)
        }
      } else if (searchQuery.trim().length === 0 && activeTab !== 'favorites' && selectedCategoryId) {
        // Revert to category streams
        loadStreams(selectedCategoryId, activeTab as 'live' | 'vod' | 'series')
      }
    }
    
    const timeoutId = setTimeout(performGlobalSearch, 500)
    return () => clearTimeout(timeoutId)
  }, [searchQuery, activeTab])

  const loadSeriesInfo = async (seriesId: string | number) => {
    setIsDataLoading(true)
    setError(null)
    try {
      const url = buildApiUrl(credentials, { action: 'get_series_info', series_id: seriesId.toString() })
      const data = await fetchJson<{ episodes: Record<string, XtreamEpisode[]> }>(url)
      setSeriesEpisodes(data.episodes || {})
      const firstSeason = Object.keys(data.episodes || {})[0]
      setSelectedSeason(firstSeason || '')
    } catch (e) {
      setError(toFriendlyError(e, 'data'))
    } finally {
      setIsDataLoading(false)
    }
  }

  const loadEpg = async (streamId: string | number) => {
    setIsEpgLoading(true)
    try {
      const url = buildApiUrl(credentials, { action: 'get_short_epg', stream_id: streamId.toString() })
      const data = await fetchJson<{ epg_listings: EpgProgram[] }>(url)
      setEpg(data.epg_listings || [])
    } catch {
      setEpg([])
    } finally {
      setIsEpgLoading(false)
    }
  }

  useEffect(() => {
    if (selectedStream && selectedStream.stream_type === 'live') {
      loadEpg(selectedStream.stream_id)
    } else {
      setEpg([])
    }
  }, [selectedStream])

  const doLogin = async (creds: Credentials, saveNew: boolean = false, newName: string = '') => {
    setIsLoading(true)
    setError(null)

    try {
      const authUrl = buildApiUrl(creds, {})
      const authData = await fetchJson<{ user_info?: XtreamUser }>(authUrl)

      if (!authData.user_info || authData.user_info.auth !== 1) throw new Error('HTTP 401')

      if (saveNew && user && db) {
        const finalName = newName.trim() || creds.username
        const newPlaylist: Playlist = {
          id: Date.now().toString(),
          name: finalName,
          credentials: { ...creds },
          userId: user.uid,
          createdAt: Date.now()
        }
        try {
          await setDoc(doc(db, `users/${user.uid}/playlists`, newPlaylist.id), newPlaylist)
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/playlists/${newPlaylist.id}`)
        }
      }

      setCredentials(creds)

      const cats = await loadCategories('live', creds)
      setCategories(cats)

      const firstCategoryId = cats[0]?.category_id ?? ''
      setSelectedCategoryId(firstCategoryId)
      setActiveTab('live')
      setAppState('dashboard')

      if (firstCategoryId) await loadStreams(firstCategoryId, 'live', creds)
    } catch (e) {
      setError(toFriendlyError(e, 'login'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isLoginValid) return
    doLogin(credentials, savePlaylist, playlistName)
  }

  const handlePlaylistClick = (playlist: Playlist) => {
    doLogin(playlist.credentials)
  }
  
  const deletePlaylist = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user || !db) return
    try {
      await deleteDoc(doc(db, `users/${user.uid}/playlists`, id))
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/playlists/${id}`)
    }
  }

  const handleTabChange = async (tab: 'live' | 'vod' | 'series' | 'favorites') => {
    if (tab === activeTab) return
    setActiveTab(tab)
    setSearchQuery('')
    setSelectedSeries(null)
    setError(null)
    
    if (tab === 'favorites') {
      setCategories([])
      setSelectedCategoryId('')
      setStreams(favorites.map(f => ({
        stream_id: f.id,
        name: f.name,
        stream_icon: f.icon,
        stream_type: f.type,
        series_id: f.type === 'series' ? (f.id as number) : undefined
      })))
      return
    }

    setIsDataLoading(true)
    setStreams([])
    try {
      const cats = await loadCategories(tab)
      setCategories(cats)
      const firstCategoryId = cats[0]?.category_id ?? ''
      setSelectedCategoryId(firstCategoryId)
      if (firstCategoryId) await loadStreams(firstCategoryId, tab)
    } catch (e) {
      setError(toFriendlyError(e, 'data'))
      setIsDataLoading(false)
    }
  }

  const handleCategoryChange = async (categoryId: string) => {
    setSelectedCategoryId(categoryId)
    setSearchQuery('')
    if (activeTab !== 'favorites') {
      await loadStreams(categoryId, activeTab as 'live' | 'vod' | 'series')
    }
  }

  const filteredStreams = useMemo(() => {
    if (activeTab === 'favorites' && searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      return streams.filter(s => s.name.toLowerCase().includes(query))
    }
    // For other tabs, streams is already filtered by the useEffect if searchQuery is present
    return streams
  }, [streams, searchQuery, activeTab])

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500/30">
      {appState === 'login' ? (
        <div className="flex min-h-screen items-center justify-center p-4">
          <section className="w-full max-w-md rounded-2xl bg-zinc-900/50 p-8 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
            <div className="mb-8 flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20">
                <Tv size={32} />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">IPTV Player</h1>
              <p className="mt-2 text-sm text-zinc-400">Accedi ai tuoi contenuti preferiti</p>
            </div>

            {!isAuthReady ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Loader2 size={32} className="animate-spin text-indigo-500" />
                <p className="text-sm text-zinc-400">Verifica credenziali in corso...</p>
              </div>
            ) : user ? (
              playlists.length > 0 && !isAddingNew ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium uppercase tracking-wider text-zinc-400">Le tue Playlist</h2>
                    <button onClick={handleLogout} className="text-xs text-zinc-500 hover:text-white transition-colors">Disconnetti</button>
                  </div>
                  <div className="grid gap-3">
                    {playlists.map(p => (
                      <button key={p.id} onClick={() => handlePlaylistClick(p)} disabled={isLoading} className="flex items-center justify-between p-4 rounded-xl bg-zinc-800/50 hover:bg-zinc-800 ring-1 ring-white/5 transition-all text-left group disabled:opacity-50">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
                            <Tv size={20} />
                          </div>
                          <div>
                            <div className="font-medium text-white">{p.name}</div>
                            <div className="text-xs text-zinc-500">{p.credentials.username}</div>
                          </div>
                        </div>
                        <div 
                          role="button"
                          onClick={(e) => deletePlaylist(p.id, e)}
                          className="p-2 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={18} />
                        </div>
                      </button>
                    ))}
                  </div>
                  
                  {error && (
                    <div className="flex items-start gap-3 rounded-xl bg-red-500/10 p-4 text-sm text-red-400 ring-1 ring-red-500/20">
                      <AlertCircle className="mt-0.5 shrink-0" size={16} />
                      <p>{error}</p>
                    </div>
                  )}

                  <button onClick={() => setIsAddingNew(true)} disabled={isLoading} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white/5 py-3.5 text-sm font-semibold text-white transition-all hover:bg-white/10 disabled:opacity-50">
                    {isLoading ? <><Loader2 size={18} className="animate-spin" /> Connessione...</> : <><Plus size={18} /> Aggiungi Nuova</>}
                  </button>
                </div>
              ) : (
                <form className="space-y-5" onSubmit={handleFormSubmit}>
                  {playlists.length > 0 && (
                    <div className="flex items-center justify-between mb-4">
                      <button type="button" onClick={() => setIsAddingNew(false)} className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
                        <ChevronLeft size={16} /> Torna alle playlist
                      </button>
                      <button type="button" onClick={handleLogout} className="text-xs text-zinc-500 hover:text-white transition-colors">Disconnetti</button>
                    </div>
                  )}
                  {!playlists.length && (
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs text-zinc-500">Loggato come {user.email}</span>
                      <button type="button" onClick={handleLogout} className="text-xs text-zinc-500 hover:text-white transition-colors">Disconnetti</button>
                    </div>
                  )}
                  
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">Nome Playlist <span className="text-zinc-600">(Opzionale)</span></label>
                    <input type="text" placeholder="Es. Casa, Sport..." value={playlistName} onChange={(e) => setPlaylistName(e.target.value)} className="w-full rounded-xl border-0 bg-zinc-800/50 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:bg-zinc-800 focus:ring-2 focus:ring-indigo-500 transition-all" />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">Server URL</label>
                    <input type="url" placeholder="https://provider.example" value={credentials.server} onChange={(e) => updateField('server', e.target.value)} className="w-full rounded-xl border-0 bg-zinc-800/50 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:bg-zinc-800 focus:ring-2 focus:ring-indigo-500 transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">Username</label>
                    <input type="text" placeholder="Username" value={credentials.username} onChange={(e) => updateField('username', e.target.value)} className="w-full rounded-xl border-0 bg-zinc-800/50 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:bg-zinc-800 focus:ring-2 focus:ring-indigo-500 transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">Password</label>
                    <input type="password" placeholder="••••••••" value={credentials.password} onChange={(e) => updateField('password', e.target.value)} className="w-full rounded-xl border-0 bg-zinc-800/50 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:bg-zinc-800 focus:ring-2 focus:ring-indigo-500 transition-all" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium uppercase tracking-wider text-zinc-400">Proxy URL <span className="text-zinc-600">(Opzionale)</span></label>
                    <input type="text" placeholder="/proxy" value={credentials.proxyUrl} onChange={(e) => updateField('proxyUrl', e.target.value)} className="w-full rounded-xl border-0 bg-zinc-800/50 px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:bg-zinc-800 focus:ring-2 focus:ring-indigo-500 transition-all" />
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <input type="checkbox" id="savePlaylist" checked={savePlaylist} onChange={(e) => setSavePlaylist(e.target.checked)} className="h-4 w-4 rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-zinc-900" />
                    <label htmlFor="savePlaylist" className="text-sm text-zinc-300">Salva come playlist nel cloud</label>
                  </div>

                  {error && (
                    <div className="flex items-start gap-3 rounded-xl bg-red-500/10 p-4 text-sm text-red-400 ring-1 ring-red-500/20">
                      <AlertCircle className="mt-0.5 shrink-0" size={16} />
                      <p>{error}</p>
                    </div>
                  )}

                  <button type="submit" disabled={!isLoginValid || isLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 py-3.5 text-sm font-semibold text-white transition-all hover:bg-indigo-400 focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
                    {isLoading ? <><Loader2 size={18} className="animate-spin" /> Connessione...</> : 'Accedi'}
                  </button>
                </form>
              )
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-zinc-400 text-center mb-6">Accedi per salvare e sincronizzare le tue playlist su tutti i tuoi dispositivi.</p>
                <button
                  onClick={handleGoogleLogin}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-white text-zinc-900 py-3.5 text-sm font-semibold transition-all hover:bg-zinc-200 focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    <path d="M1 1h22v22H1z" fill="none" />
                  </svg>
                  Accedi con Google
                </button>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="flex h-screen flex-col lg:flex-row overflow-hidden relative">
          {/* Sidebar */}
          <div className={`flex w-full lg:w-96 flex-col border-b lg:border-b-0 lg:border-r border-white/5 bg-zinc-900/30 ${isPlayerExpanded ? 'hidden lg:flex lg:h-full' : 'h-full'}`}>
            <div className="flex items-center justify-between border-b border-white/5 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                  <Tv size={20} />
                </div>
                <div>
                  <h2 className="font-semibold text-white leading-tight">IPTV Player</h2>
                  <p className="text-xs text-zinc-500">{credentials.username}</p>
                </div>
              </div>
              <button onClick={() => { setAppState('login'); setIsAddingNew(false); }} className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/5 hover:text-white" title="Torna alle Playlist">
                <ChevronLeft size={18} />
              </button>
            </div>

            <div className="flex items-center gap-1 border-b border-white/5 p-2 overflow-x-auto scrollbar-none">
              {[
                { id: 'live', icon: Tv, label: 'Live' },
                { id: 'vod', icon: Film, label: 'Film' },
                { id: 'series', icon: Clapperboard, label: 'Serie' },
                { id: 'favorites', icon: Heart, label: 'Preferiti' }
              ].map(tab => (
                <button 
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id as any)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all ${activeTab === tab.id ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'}`}
                >
                  <tab.icon size={16} className={activeTab === tab.id && tab.id === 'favorites' ? 'fill-current' : ''} /> {tab.label}
                </button>
              ))}
            </div>

            {activeTab !== 'favorites' && !selectedSeries && (
              <div className="flex flex-col gap-3 border-b border-white/5 p-4">
                <select value={selectedCategoryId} onChange={(e) => handleCategoryChange(e.target.value)} className="w-full rounded-xl border-0 bg-zinc-800/50 px-4 py-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500">
                  {categories.map(c => <option key={c.category_id} value={c.category_id}>{c.category_name}</option>)}
                </select>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                  <input type="text" placeholder="Cerca..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full rounded-xl border-0 bg-zinc-800/50 pl-10 pr-4 py-2.5 text-sm text-white focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
              {isDataLoading ? (
                <div className="flex h-32 items-center justify-center text-zinc-500"><Loader2 size={24} className="animate-spin" /></div>
              ) : selectedSeries ? (
                <div className="animate-in slide-in-from-right-4 duration-200">
                  <button onClick={() => setSelectedSeries(null)} className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-4 px-2">
                    <ChevronLeft size={16} /> Torna alle serie
                  </button>
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-4 px-2 scrollbar-none">
                    {Object.keys(seriesEpisodes).map(season => (
                      <button key={season} onClick={() => setSelectedSeason(season)} className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${selectedSeason === season ? 'bg-indigo-500 text-white' : 'bg-zinc-800 text-zinc-400'}`}>
                        Stagione {season}
                      </button>
                    ))}
                  </div>
                  <ul className="space-y-1">
                    {seriesEpisodes[selectedSeason]?.map(ep => (
                      <li key={ep.id}>
                        <button onClick={() => {
                          setSelectedStream({ stream_id: ep.id, name: ep.title, stream_type: 'episode', container_extension: ep.container_extension })
                          setIsPlayerExpanded(false)
                        }} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${selectedStream?.stream_id === ep.id ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20' : 'text-zinc-300 hover:bg-white/5'}`}>
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-zinc-800 text-zinc-600"><Play size={14} /></div>
                          <div className="flex-1 truncate">
                            <span className="text-sm font-medium block truncate">{ep.title}</span>
                            <span className="text-xs text-zinc-500">Episodio {ep.episode_num}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : filteredStreams.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center text-center text-zinc-500">
                  <Info size={24} className="mb-2 opacity-20" />
                  <p className="text-sm">Nessun contenuto trovato.</p>
                </div>
              ) : (
                <ul className="space-y-1">
                  {filteredStreams.map(stream => {
                    const isActive = selectedStream?.stream_id === stream.stream_id
                    const isFav = isFavorite(stream.series_id || stream.stream_id)
                    return (
                      <li key={stream.stream_id} className="group relative flex items-center">
                        <button
                          onClick={() => {
                            if (stream.stream_type === 'series') {
                              setSelectedSeries(stream)
                              loadSeriesInfo(stream.series_id!)
                            } else {
                              setSelectedStream(stream)
                              setIsPlayerExpanded(false)
                            }
                          }}
                          className={`flex flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${isActive ? 'bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20' : 'text-zinc-300 hover:bg-white/5'}`}
                        >
                          {stream.stream_icon ? (
                            <img src={stream.stream_icon} alt="" className="h-8 w-8 rounded bg-zinc-800 object-contain" onError={(e) => (e.target as HTMLImageElement).style.display = 'none'} />
                          ) : (
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded bg-zinc-800 ${isActive ? 'text-indigo-400' : 'text-zinc-600'}`}>
                              {stream.stream_type === 'series' ? <Clapperboard size={14} /> : <Play size={14} className={isActive ? 'fill-current' : ''} />}
                            </div>
                          )}
                          <span className="truncate text-sm font-medium pr-8">{stream.name}</span>
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); toggleFavorite(stream, stream.stream_type as any) }}
                          className={`absolute right-3 p-1.5 rounded-md transition-all ${isFav ? 'text-red-500' : 'text-zinc-600 hover:text-white hover:bg-white/10'}`}
                        >
                          <Heart size={16} className={isFav ? 'fill-current' : ''} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Desktop Empty State */}
          {!selectedStream && (
            <div className="hidden lg:flex flex-1 items-center justify-center bg-zinc-950">
              <div className="flex flex-col items-center justify-center text-zinc-600">
                <Tv size={48} className="mb-4 opacity-20" />
                <p>Seleziona un contenuto dalla lista</p>
              </div>
            </div>
          )}

          {/* Player Container (Floating or Expanded) */}
          <div 
            className={`transition-all duration-300 ease-in-out z-50 flex flex-col overflow-hidden ${
              isPlayerExpanded 
                ? 'fixed inset-0 bg-zinc-950 lg:relative lg:inset-auto lg:flex-1' 
                : selectedStream 
                  ? 'fixed bottom-4 right-4 w-40 sm:w-64 rounded-xl shadow-2xl ring-1 ring-white/10 bg-zinc-900 cursor-pointer hover:scale-105 lg:absolute lg:bottom-6 lg:right-6' 
                  : 'hidden'
            }`}
            onClick={() => {
              if (!isPlayerExpanded) setIsPlayerExpanded(true)
            }}
          >
            <div className={`relative bg-black flex flex-col justify-center shrink-0 ${isPlayerExpanded ? 'w-full aspect-video lg:flex-1' : 'w-full aspect-video'}`}>
              {/* Close button for floating player */}
              {!isPlayerExpanded && selectedStream && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setSelectedStream(null); }}
                  className="absolute top-1 right-1 z-50 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80 transition-all"
                >
                  <X size={14} />
                </button>
              )}

              {/* Back button for expanded player (Mobile only) */}
              {isPlayerExpanded && (
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsPlayerExpanded(false); }}
                  className="absolute top-4 left-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80 transition-all lg:hidden"
                >
                  <ChevronLeft size={24} />
                </button>
              )}
              
              <video 
                ref={videoRef} 
                controls={isPlayerExpanded} 
                playsInline 
                autoPlay 
                className="h-full w-full object-contain aspect-video" 
                style={{ pointerEvents: isPlayerExpanded ? 'auto' : 'none' }}
              />
              
              {!isPlayerExpanded && (
                <>
                  <div className="absolute inset-0 bg-black/20 hover:bg-transparent transition-colors" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/40">
                    <div className="bg-indigo-500 text-white rounded-full p-2 sm:p-3">
                      <Play size={16} className="fill-current sm:w-6 sm:h-6" />
                    </div>
                  </div>
                </>
              )}
            </div>
            
            {/* Info Bar */}
            {selectedStream && (
              <div className={`${isPlayerExpanded ? 'border-t border-white/10 bg-zinc-900 flex-1 overflow-y-auto' : 'p-2 border-t border-white/5'} flex flex-col`}>
                {isPlayerExpanded ? (
                  <div className="flex flex-col gap-4 p-4 lg:p-6 shrink-0">
                    <div className="flex items-center gap-4">
                      {selectedStream.stream_icon ? (
                        <img src={selectedStream.stream_icon} alt="" className="h-12 w-12 rounded-lg bg-zinc-800 object-contain" />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-500">
                          <Play size={24} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wider text-indigo-400 mb-1">In riproduzione</p>
                        <h2 className="text-lg font-semibold text-white truncate">{selectedStream.name}</h2>
                      </div>
                      
                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            if (videoRef.current && (videoRef.current as any).remotePlayback) {
                              (videoRef.current as any).remotePlayback.prompt().catch((e: any) => {
                                console.error('Cast error:', e)
                                alert('Impossibile avviare la trasmissione. Assicurati di avere un dispositivo compatibile nelle vicinanze.')
                              })
                            } else {
                              alert('Il tuo browser non supporta la trasmissione nativa. Prova a usare Chrome su Android o Desktop.')
                            }
                          }}
                          className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                          title="Trasmetti alla TV (Chromecast)"
                        >
                          <Cast size={20} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            if (!directStreamUrl) return

                            const isAndroid = /Android/i.test(navigator.userAgent)
                            const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)

                            if (isAndroid) {
                              try {
                                const urlObj = new URL(directStreamUrl)
                                const scheme = urlObj.protocol.replace(':', '')
                                const hostAndPath = urlObj.host + urlObj.pathname + urlObj.search
                                const fallbackUrl = encodeURIComponent(directStreamUrl)
                                const intentUrl = `intent://${hostAndPath}#Intent;scheme=${scheme};type=video/*;action=android.intent.action.VIEW;S.browser_fallback_url=${fallbackUrl};end;`
                                window.location.href = intentUrl
                                return
                              } catch (err) {
                                console.error('Error parsing URL for intent', err)
                              }
                            } else if (isIOS) {
                              window.location.href = `vlc://${directStreamUrl}`
                              return
                            }

                            // Fallback: download .m3u file
                            const m3uContent = `#EXTM3U\n#EXTINF:-1,${selectedStream?.name || 'Stream'}\n${directStreamUrl}`
                            const blob = new Blob([m3uContent], { type: 'audio/x-mpegurl' })
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = `${selectedStream?.name?.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'stream'}.m3u`
                            document.body.appendChild(a)
                            a.click()
                            document.body.removeChild(a)
                            URL.revokeObjectURL(url)
                          }}
                          className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                          title="Apri in un'app esterna (es. VLC)"
                        >
                          <ExternalLink size={20} />
                        </button>
                      </div>
                    </div>

                    {/* Track Selectors */}
                    {(audioTracks.length > 1 || subtitleTracks.length > 0) && (
                      <div className="flex flex-wrap gap-4 mt-2 pt-4 border-t border-white/5">
                        {audioTracks.length > 1 && (
                          <div className="flex items-center gap-2">
                            <AudioLines size={16} className="text-zinc-400" />
                            <select 
                              className="bg-zinc-800 text-sm text-white rounded-md px-2 py-1 border border-white/10 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              value={currentAudio}
                              onChange={(e) => setAudioTrack(Number(e.target.value))}
                            >
                              {audioTracks.map(track => (
                                <option key={track.id} value={track.id}>
                                  {track.name || track.lang || `Audio ${track.id + 1}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        
                        {subtitleTracks.length > 0 && (
                          <div className="flex items-center gap-2">
                            <Subtitles size={16} className="text-zinc-400" />
                            <select 
                              className="bg-zinc-800 text-sm text-white rounded-md px-2 py-1 border border-white/10 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              value={currentSubtitle}
                              onChange={(e) => setSubtitleTrack(Number(e.target.value))}
                            >
                              <option value={-1}>Disattivati</option>
                              {subtitleTracks.map(track => (
                                <option key={track.id} value={track.id}>
                                  {track.name || track.lang || `Sottotitolo ${track.id + 1}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="text-[10px] font-medium text-indigo-400 mb-0.5">In riproduzione</div>
                    <div className="text-xs font-semibold text-white truncate">{selectedStream.name}</div>
                  </>
                )}

                {/* EPG Section (Only when expanded) */}
                {isPlayerExpanded && selectedStream.stream_type === 'live' && (
                  <div className="border-t border-white/5 bg-zinc-950/50 p-4 lg:px-6 shrink-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-400 mb-3">
                      <Calendar size={16} /> Guida TV (EPG)
                    </div>
                    {isEpgLoading ? (
                      <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 size={14} className="animate-spin" /> Caricamento EPG...</div>
                    ) : epg.length > 0 ? (
                      <div className="flex flex-col gap-3">
                        {epg.slice(0, 5).map((prog, i) => {
                          const isCurrent = i === 0 // Assuming first is current in short_epg
                          return (
                            <div key={prog.id || i} className={`p-3 rounded-xl border ${isCurrent ? 'bg-indigo-500/10 border-indigo-500/30' : 'bg-zinc-900 border-white/5'}`}>
                              <div className="text-xs font-medium text-indigo-400 mb-1">{prog.start} - {prog.end}</div>
                              <div className={`text-sm font-semibold ${isCurrent ? 'text-white' : 'text-zinc-300'}`}>{decodeBase64(prog.title)}</div>
                              {prog.description && <div className="text-xs text-zinc-500 mt-1">{decodeBase64(prog.description).replace(/<[^>]*>?/gm, '')}</div>}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-500">Nessuna informazione EPG disponibile per questo canale.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
