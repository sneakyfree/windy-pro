"""
Windy Pro Web Portal Phase 2 — Structural Verification Tests

Verifies all new pages, routes, API endpoints, PWA files,
and Landing page sections exist and are properly wired.
"""
import os
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'src', 'client', 'web')
SRC = os.path.join(WEB, 'src')

def read(path):
    return open(os.path.join(ROOT, *path.split('/'))).read()

# ─── 1. SPA Route Fix ─────────────────────────────────────────

def test_vite_has_spa_fallback():
    config = read('src/client/web/vite.config.js')
    assert "appType: 'spa'" in config

def test_vite_no_broken_translate_proxy():
    config = read('src/client/web/vite.config.js')
    # Should NOT have the old /translate proxy that intercepted React Router
    assert "bypass(req)" not in config

def test_app_has_settings_route():
    app = read('src/client/web/src/App.jsx')
    assert '"/settings"' in app
    assert 'Settings' in app

def test_app_has_admin_route():
    app = read('src/client/web/src/App.jsx')
    assert '"/admin"' in app
    assert 'Admin' in app

def test_app_has_profile_route():
    app = read('src/client/web/src/App.jsx')
    assert '"/profile"' in app
    assert 'Profile' in app

def test_app_has_translate_route():
    app = read('src/client/web/src/App.jsx')
    assert '"/translate"' in app

# ─── 2. Dashboard Enhancement ─────────────────────────────────

def test_dashboard_has_translation_stats():
    dash = read('src/client/web/src/pages/Dashboard.jsx')
    assert 'translationStats' in dash
    assert '/user/history' in dash

def test_dashboard_has_profile_link():
    dash = read('src/client/web/src/pages/Dashboard.jsx')
    assert '/profile' in dash

def test_dashboard_has_settings_link():
    dash = read('src/client/web/src/pages/Dashboard.jsx')
    assert '/settings' in dash

# ─── 3. Stripe / Settings Page ─────────────────────────────────

def test_settings_page_exists():
    assert os.path.isfile(os.path.join(SRC, 'pages', 'Settings.jsx'))

def test_settings_has_plan_display():
    settings = read('src/client/web/src/pages/Settings.jsx')
    assert 'Current Plan' in settings
    assert 'plan-badge' in settings

def test_settings_has_password_change():
    settings = read('src/client/web/src/pages/Settings.jsx')
    assert 'Change Password' in settings
    assert 'change-password' in settings

def test_settings_has_billing_portal():
    settings = read('src/client/web/src/pages/Settings.jsx')
    assert 'create-portal-session' in settings
    assert 'Manage Billing' in settings

def test_settings_has_billing_history():
    settings = read('src/client/web/src/pages/Settings.jsx')
    assert 'Billing History' in settings

# ─── 4. Landing Page Enhancement ──────────────────────────────

def test_landing_has_comparison_table():
    landing = read('src/client/web/src/pages/Landing.jsx')
    assert 'comparison-table' in landing
    assert 'Feature Comparison' in landing

def test_landing_has_testimonials():
    landing = read('src/client/web/src/pages/Landing.jsx')
    assert 'testimonial-card' in landing
    assert 'What Users Say' in landing

def test_landing_has_cta_banner():
    landing = read('src/client/web/src/pages/Landing.jsx')
    assert 'cta-banner' in landing
    assert 'Ready to transform' in landing

def test_landing_css_has_comparison():
    css = read('src/client/web/src/pages/Landing.css')
    assert '.comparison-table' in css

def test_landing_css_has_testimonials():
    css = read('src/client/web/src/pages/Landing.css')
    assert '.testimonial-card' in css
    assert '.testimonial-grid' in css

def test_landing_css_has_cta():
    css = read('src/client/web/src/pages/Landing.css')
    assert '.cta-banner' in css

# ─── 5. Admin Panel ───────────────────────────────────────────

def test_admin_page_exists():
    assert os.path.isfile(os.path.join(SRC, 'pages', 'Admin.jsx'))

def test_admin_has_user_management():
    admin = read('src/client/web/src/pages/Admin.jsx')
    assert 'User Management' in admin
    assert '/admin/users' in admin

def test_admin_has_stats_grid():
    admin = read('src/client/web/src/pages/Admin.jsx')
    assert '/admin/stats' in admin
    assert 'Total Users' in admin

def test_admin_has_revenue():
    admin = read('src/client/web/src/pages/Admin.jsx')
    assert '/admin/revenue' in admin
    assert 'Revenue' in admin

def test_admin_has_translation_chart():
    admin = read('src/client/web/src/pages/Admin.jsx')
    assert 'SimpleBarChart' in admin or 'Translation Volume' in admin

def test_admin_has_system_health():
    admin = read('src/client/web/src/pages/Admin.jsx')
    assert 'System Health' in admin

# ─── 5b. Admin Backend Endpoints ──────────────────────────────

def test_server_has_admin_users_endpoint():
    server = read('account-server/server.js')
    assert '/api/v1/admin/users' in server

def test_server_has_admin_stats_endpoint():
    server = read('account-server/server.js')
    assert '/api/v1/admin/stats' in server

def test_server_has_admin_revenue_endpoint():
    server = read('account-server/server.js')
    assert '/api/v1/admin/revenue' in server

def test_server_has_admin_middleware():
    server = read('account-server/server.js')
    assert 'adminOnly' in server

def test_server_has_billing_endpoint():
    server = read('account-server/server.js')
    assert '/api/v1/auth/billing' in server

def test_server_has_change_password():
    server = read('account-server/server.js')
    assert '/api/v1/auth/change-password' in server

def test_server_has_portal_session():
    server = read('account-server/server.js')
    assert '/api/v1/auth/create-portal-session' in server

def test_server_has_role_migration():
    server = read('account-server/server.js')
    assert "ALTER TABLE users ADD COLUMN role" in server

def test_server_has_stripe_customer_id_migration():
    server = read('account-server/server.js')
    assert "ALTER TABLE users ADD COLUMN stripe_customer_id" in server

# ─── 6. PWA Improvements ──────────────────────────────────────

def test_sw_caches_api_responses():
    sw = read('src/client/web/public/sw.js')
    assert 'windy-api-v1' in sw
    assert '/api/v1/recordings' in sw

def test_sw_has_api_cache_expiry():
    sw = read('src/client/web/public/sw.js')
    assert 'API_CACHE_MAX_AGE' in sw
    assert '24 * 60 * 60 * 1000' in sw

def test_sw_caches_icons():
    sw = read('src/client/web/public/sw.js')
    assert '/icon-192.png' in sw
    assert '/icon-512.png' in sw

def test_manifest_has_shortcuts():
    manifest = read('src/client/web/public/manifest.json')
    assert 'shortcuts' in manifest
    assert '/dashboard' in manifest
    assert '/translate' in manifest

def test_manifest_has_categories():
    manifest = read('src/client/web/public/manifest.json')
    assert 'categories' in manifest
    assert 'productivity' in manifest

def test_sw_registered_in_main():
    main = read('src/client/web/src/main.jsx')
    assert "serviceWorker" in main
    assert "sw.js" in main

# ─── 7. Profile Page ──────────────────────────────────────────

def test_profile_page_exists():
    assert os.path.isfile(os.path.join(SRC, 'pages', 'Profile.jsx'))

def test_profile_has_translation_history():
    profile = read('src/client/web/src/pages/Profile.jsx')
    assert 'Translation History' in profile
    assert '/user/history' in profile

def test_profile_has_delete_account():
    profile = read('src/client/web/src/pages/Profile.jsx')
    assert 'Delete Account' in profile
    assert 'Danger Zone' in profile
