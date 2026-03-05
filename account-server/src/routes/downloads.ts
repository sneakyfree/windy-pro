/**
 * Download routes — cache-proof GitHub release downloads.
 */
import { Router, Request, Response } from 'express';

const router = Router();

const GITHUB_REPO = 'sneakyfree/windy-pro';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
let _ghReleaseCache: any = null;
let _ghReleaseCacheTime = 0;
const GH_CACHE_TTL = 5 * 60 * 1000;

const PLATFORM_PATTERNS: Record<string, RegExp> = {
    'macos': /\.dmg$/i,
    'windows': /\.exe$/i,
    'linux-appimage': /\.AppImage$/i,
    'linux-deb': /\.deb$/i,
    'linux-install.sh': /install-windy-pro\.sh$/i,
};

async function getLatestGitHubRelease() {
    const now = Date.now();
    if (_ghReleaseCache && (now - _ghReleaseCacheTime) < GH_CACHE_TTL) {
        return _ghReleaseCache;
    }
    try {
        const response = await fetch(GITHUB_API_URL, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'WindyPro-Server/2.0',
            },
        });
        if (!response.ok) throw new Error(`GitHub API: ${response.status}`);
        _ghReleaseCache = await response.json();
        _ghReleaseCacheTime = now;
        return _ghReleaseCache;
    } catch (err: any) {
        console.error('[Download] GitHub API error:', err.message);
        if (_ghReleaseCache) return _ghReleaseCache;
        throw err;
    }
}

// ─── GET /download/latest/:platform ──────────────────────────

router.get('/latest/:platform', async (req: Request, res: Response) => {
    const platform = req.params.platform as string;
    const pattern = PLATFORM_PATTERNS[platform];

    if (!pattern) {
        return res.status(400).json({
            error: `Unknown platform: ${platform}`,
            available: Object.keys(PLATFORM_PATTERNS),
        });
    }

    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    try {
        const release = await getLatestGitHubRelease();
        const asset = release.assets.find((a: any) => pattern.test(a.name));

        if (!asset) {
            return res.status(404).json({
                error: `No ${platform} asset found in release ${release.tag_name}`,
                available_assets: release.assets.map((a: any) => a.name),
            });
        }

        const cacheBuster = `?v=${Date.now()}`;
        const downloadUrl = asset.browser_download_url + cacheBuster;

        console.log(`[Download] ${platform} → ${asset.name} (${release.tag_name})`);
        return res.redirect(302, downloadUrl);
    } catch (err: any) {
        res.status(502).json({ error: 'Failed to fetch latest release', details: err.message });
    }
});

// ─── GET /download/verify ────────────────────────────────────

router.get('/verify', async (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');

    try {
        const release = await getLatestGitHubRelease();
        const assets: Record<string, any> = {};

        for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
            const asset = release.assets.find((a: any) => pattern.test(a.name));
            if (asset) {
                assets[platform] = {
                    name: asset.name,
                    size_bytes: asset.size,
                    download_url: `/download/latest/${platform}`,
                    direct_url: asset.browser_download_url,
                    updated_at: asset.updated_at,
                    download_count: asset.download_count,
                };
            }
        }

        res.json({
            version: release.tag_name,
            published_at: release.published_at,
            release_url: release.html_url,
            assets,
            cache_age_seconds: Math.round((Date.now() - _ghReleaseCacheTime) / 1000),
        });
    } catch (err: any) {
        res.status(502).json({ error: 'Failed to fetch release info', details: err.message });
    }
});

// ─── GET /download/version ───────────────────────────────────

router.get('/version', async (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.set('Access-Control-Allow-Origin', '*');

    try {
        const release = await getLatestGitHubRelease();
        res.json({ version: release.tag_name, published_at: release.published_at });
    } catch (err: any) {
        res.status(502).json({ error: 'Failed to fetch version', version: 'v0.6.0' });
    }
});

export default router;
