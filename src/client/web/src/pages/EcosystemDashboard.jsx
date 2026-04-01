import { Suspense, lazy, useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import './EcosystemDashboard.css'

const WordPanel = lazy(() => import('./panels/WordPanel'))
const ChatPanel = lazy(() => import('./panels/ChatPanel'))
const MailPanel = lazy(() => import('./panels/MailPanel'))
const FlyPanel = lazy(() => import('./panels/FlyPanel'))
const CloudPanel = lazy(() => import('./panels/CloudPanel'))
const ClonePanel = lazy(() => import('./panels/ClonePanel'))
const PassportPanel = lazy(() => import('./panels/PassportPanel'))
const SettingsPanel = lazy(() => import('./panels/SettingsPanel'))

const PANELS = [
    { id: 'fly', emoji: '\ud83e\udeb0', label: 'Fly', component: FlyPanel },
    { id: 'word', emoji: '\ud83c\udf99\ufe0f', label: 'Word', component: WordPanel },
    { id: 'chat', emoji: '\ud83d\udcac', label: 'Chat', component: ChatPanel },
    { id: 'mail', emoji: '\ud83d\udce7', label: 'Mail', component: MailPanel },
    { id: 'cloud', emoji: '\u2601\ufe0f', label: 'Cloud', component: CloudPanel },
    { id: 'clone', emoji: '\ud83e\uddec', label: 'Clone', component: ClonePanel },
    { id: 'passport', emoji: '\ud83e\udea8', label: 'Passport', component: PassportPanel },
    { id: 'settings', emoji: '\u2699\ufe0f', label: 'Settings', component: SettingsPanel },
]

function getToken() { return localStorage.getItem('windy_token') }
function getUser() {
    try { return JSON.parse(localStorage.getItem('windy_user')) } catch { return null }
}

async function apiFetch(path, options = {}) {
    const token = getToken()
    const res = await fetch(`/api/v1${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers,
        },
    })
    if (res.status === 401) {
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        window.location.href = '/auth'
        return null
    }
    return res.json()
}

function Spinner() {
    return (
        <div className="eco-spinner">
            <div className="eco-spinner-ring" />
        </div>
    )
}

export { apiFetch }

export default function EcosystemDashboard() {
    const { panel: panelParam } = useParams()
    const navigate = useNavigate()
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const user = getUser()
    const activeId = panelParam || 'fly'
    const activePanel = PANELS.find(p => p.id === activeId) || PANELS[0]
    const ActiveComponent = activePanel.component

    useEffect(() => {
        if (!getToken()) navigate('/auth', { replace: true })
    }, [navigate])

    const handleLogout = () => {
        fetch('/api/v1/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
        }).catch(() => {})
        localStorage.removeItem('windy_token')
        localStorage.removeItem('windy_user')
        navigate('/auth')
    }

    return (
        <div className="eco-shell">
            {/* Mobile toggle */}
            <button className="eco-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
                {sidebarOpen ? '\u2715' : '\u2630'}
            </button>

            {/* Sidebar */}
            <aside className={`eco-sidebar ${sidebarOpen ? 'eco-sidebar-open' : ''}`}>
                <Link to="/" className="eco-brand">
                    <span className="eco-brand-icon">{'\ud83c\udf2a\ufe0f'}</span>
                    <span className="eco-brand-text">Windy</span>
                </Link>

                <nav className="eco-nav">
                    {PANELS.map(p => (
                        <Link
                            key={p.id}
                            to={`/app/${p.id}`}
                            className={`eco-nav-item ${activeId === p.id ? 'eco-nav-active' : ''}`}
                            onClick={() => setSidebarOpen(false)}
                        >
                            <span className="eco-nav-emoji">{p.emoji}</span>
                            <span className="eco-nav-label">{p.label}</span>
                        </Link>
                    ))}
                </nav>

                <div className="eco-sidebar-footer">
                    <div className="eco-user">
                        <span className="eco-avatar">{user?.name?.[0] || '?'}</span>
                        <div className="eco-user-info">
                            <span className="eco-user-name">{user?.name || 'User'}</span>
                            <span className="eco-user-email">{user?.email || ''}</span>
                        </div>
                    </div>
                    <button className="eco-logout" onClick={handleLogout}>Sign Out</button>
                </div>
            </aside>

            {/* Main content */}
            <main className="eco-main">
                <Suspense fallback={<Spinner />}>
                    <ActiveComponent apiFetch={apiFetch} user={user} />
                </Suspense>
            </main>

            {/* Mobile bottom nav */}
            <nav className="eco-bottom-nav">
                {PANELS.slice(0, 5).map(p => (
                    <Link
                        key={p.id}
                        to={`/app/${p.id}`}
                        className={`eco-bottom-item ${activeId === p.id ? 'eco-bottom-active' : ''}`}
                    >
                        <span>{p.emoji}</span>
                        <span className="eco-bottom-label">{p.label}</span>
                    </Link>
                ))}
            </nav>
        </div>
    )
}
