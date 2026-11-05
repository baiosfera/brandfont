import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf'
};

const server = http.createServer(async (req, res) => {
    // Enable CORS for web fonts and API consumers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    try {
        const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = reqUrl.pathname;

        // 1. Healthcheck for Zerops
        if (pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'brandfont', uptime: process.uptime() }));
            return;
        }

        // 2. API: Fonts catalog
        if (pathname === '/api/fonts') {
            const catalogPath = path.join(__dirname, 'catalog.json');
            if (req.method === 'GET') {
                if (!fs.existsSync(catalogPath)) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ fonts: [] }));
                    return;
                }
                const data = await fs.promises.readFile(catalogPath, 'utf8');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(data);
                return;
            }

            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                    body += chunk;
                    if (body.length > 10 * 1024 * 1024) {
                        req.destroy();
                    }
                });
                req.on('end', async () => {
                    try {
                        const parsed = JSON.parse(body);
                        const fontsToSave = Array.isArray(parsed) ? parsed : (parsed.fonts || []);
                        const tmpPath = `${catalogPath}.tmp_${Date.now()}`;
                        await fs.promises.writeFile(tmpPath, JSON.stringify(fontsToSave, null, 2), 'utf8');
                        await fs.promises.rename(tmpPath, catalogPath);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true, count: fontsToSave.length }));
                    } catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: err.message }));
                    }
                });
                return;
            }
        }

        // 3. API: Render font preview SVG
        if (pathname === '/api/render' && req.method === 'GET') {
            const itemUuid = reqUrl.searchParams.get('itemUuid');
            const text = reqUrl.searchParams.get('text') || '';
            const variant = reqUrl.searchParams.get('variant') || '';

            if (!itemUuid || !text) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Missing itemUuid or text query parameters' }));
                return;
            }

            const envatoUrl = `https://elements.envato.com/font-preview.svg?itemUuid=${encodeURIComponent(itemUuid)}&text=${encodeURIComponent(text)}&typed=1&variant=${encodeURIComponent(variant)}`;

            try {
                const proxyResp = await fetch(envatoUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'image/svg+xml,*/*'
                    }
                });

                if (proxyResp.ok) {
                    const svgData = await proxyResp.text();
                    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
                    res.end(svgData);
                    return;
                }
                res.writeHead(proxyResp.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: `Upstream error: ${proxyResp.statusText}` }));
            } catch (err) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }

        // 4. API: Extract Envato font metadata
        if (pathname === '/api/extract' && req.method === 'GET') {
            const targetUrl = reqUrl.searchParams.get('url');
            const sampleText = reqUrl.searchParams.get('text') || 'CATALINA GLAMUR';

            if (!targetUrl) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Missing url parameter' }));
                return;
            }

            try {
                const pageResp = await fetch(targetUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                const html = await pageResp.text();

                // Extract UUID and metadata if present in JSON or attributes
                const uuidMatch = html.match(/itemUuid["']?\s*:\s*["']([0-9a-f-]{36})["']/i) ||
                                  html.match(/data-item-uuid=["']([0-9a-f-]{36})["']/i) ||
                                  html.match(/([0-9a-f-]{36})/i);
                const titleMatch = html.match(/<title>([^<]+)<\/title>/i);

                const itemUuid = uuidMatch ? uuidMatch[1] : `custom_${Date.now()}`;
                const title = titleMatch ? titleMatch[1].replace(/\|.*$/, '').trim() : 'Extracted Font';

                // Fetch preview SVG
                const previewResp = await fetch(`https://elements.envato.com/font-preview.svg?itemUuid=${encodeURIComponent(itemUuid)}&text=${encodeURIComponent(sampleText)}&typed=1`);
                const previewSvg = previewResp.ok ? await previewResp.text() : '';

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    ok: true,
                    itemUuid,
                    title,
                    url: targetUrl,
                    totalStyleCount: 1,
                    defaultStyleName: 'REGULAR',
                    itemAttributes: {
                        ligatures: true,
                        stylisticSet: true,
                        alternates: true
                    },
                    variants: [
                        {
                            variantId: 'default',
                            styleName: 'REGULAR',
                            svgContent: previewSvg
                        }
                    ]
                }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }

        // 5. Static File Serving
        let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        // Prevent directory traversal
        const safePath = path.normalize(path.join(__dirname, relativePath));
        if (!safePath.startsWith(__dirname)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Access Denied');
            return;
        }

        let stat;
        try {
            stat = await fs.promises.stat(safePath);
            if (stat.isDirectory()) {
                const indexCandidate = path.join(safePath, 'index.html');
                stat = await fs.promises.stat(indexCandidate);
                relativePath = path.join(relativePath, 'index.html');
            }
        } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(safePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Cache-Control': ext.match(/\.(woff2?|ttf|otf)$/) ? 'public, max-age=31536000, immutable' : 'no-cache'
        });

        const stream = fs.createReadStream(safePath);
        stream.pipe(res);

    } catch (serverErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Internal Server Error: ${serverErr.message}`);
    }
});

server.listen(PORT, HOST, () => {
    console.log(`🚀 Brandfont runtime listening at http://${HOST}:${PORT}`);
});
