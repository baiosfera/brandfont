import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const CATALOG_FILE = path.join(__dirname, 'catalog.json');
const BRANDS_DATA_FILE = path.join(__dirname, 'brands_data.json');
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PROYECTOS_DIR = '/var/www/baiosfera/PROYECTOS';

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
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

// Helper: Parse markdown astrobranding files for real OKLCH color palettes
function parseAstrobranding(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const ecosystems = [];
        const sections = content.split(/###?\s+/);

        for (const sec of sections) {
            if (!sec.toLowerCase().includes('oklch')) continue;
            const lines = sec.split('\n');
            const rawTitle = lines[0].trim();
            const title = rawTitle.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim();
            const rows = [];

            for (const line of lines) {
                if (line.includes('|') && !line.includes('---') && !line.toLowerCase().includes('semiótico') && !line.toLowerCase().includes('rol')) {
                    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
                    if (cols.length >= 3) {
                        const role = cols[0].replace(/\*\*/g, '').replace(/`/g, '').trim().toLowerCase().replace(/\s+/g, '-');
                        const oklch = cols[1].replace(/`/g, '').trim();
                        const hex = cols[2].replace(/`/g, '').trim();
                        const name = cols[3] ? cols[3].replace(/["“”\`\*]/g, '').trim() : '';
                        if (oklch.includes('oklch') || hex.startsWith('#')) {
                            rows.push({ role, oklch, hex, name });
                        }
                    }
                }
                const listMatch = line.match(/^-\s*([A-Za-z\s]+):\s*`?(oklch\([^`]+\))`?\s*→?\s*`?(#[A-Fa-f0-9]{3,6})`?\s*[“"]?([^"“”\n]*)["”]?/i);
                if (listMatch) {
                    rows.push({
                        role: listMatch[1].trim().toLowerCase().replace(/\s+/g, '-'),
                        oklch: listMatch[2].trim(),
                        hex: listMatch[3].trim(),
                        name: listMatch[4].trim()
                    });
                }
            }
            if (rows.length > 0) {
                ecosystems.push({
                    id: title.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40),
                    title,
                    tokens: rows
                });
            }
        }
        return ecosystems;
    } catch {
        return [];
    }
}

function parseBrandbook(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
        const bb = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const colorSec = bb.design_system?.color || {};
        const ecosystems = [];
        for (const [groupName, groupObj] of Object.entries(colorSec)) {
            const tokens = [];
            for (const [tokenName, tokenData] of Object.entries(groupObj)) {
                if (tokenData && typeof tokenData === 'object' && (tokenData.$value || tokenData.hex || tokenData.oklch)) {
                    tokens.push({
                        role: tokenName.toLowerCase().replace(/\s+/g, '-'),
                        oklch: tokenData.$value?.includes('oklch') ? tokenData.$value : '',
                        hex: tokenData.$extensions?.hex || (tokenData.$value?.startsWith('#') ? tokenData.$value : ''),
                        name: tokenData.$extensions?.name || tokenData.$description || tokenName
                    });
                }
            }
            if (tokens.length > 0) {
                ecosystems.push({
                    id: `bb_${groupName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`,
                    title: `Brandbook: ${groupName.replace(/_/g, ' ').toUpperCase()}`,
                    tokens
                });
            }
        }
        return ecosystems;
    } catch {
        return [];
    }
}

function loadAllBrands() {
    let brands = {};

    // 1. If PROYECTOS_DIR exists (local ZCP or mounted Drive SSoT), scan in vivo
    if (fs.existsSync(PROYECTOS_DIR)) {
        try {
            const entries = fs.readdirSync(PROYECTOS_DIR, { withFileTypes: true });
            for (const d of entries) {
                if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'sync') continue;
                const bName = d.name;
                const bDir = path.join(PROYECTOS_DIR, bName);
                let devDir = path.join(bDir, 'dev');
                if (!fs.existsSync(devDir)) devDir = bDir;

                const brandData = {
                    id: bName.toLowerCase(),
                    name: bName,
                    ecosystems: []
                };

                // Brandbook
                const bbEcos = parseBrandbook(path.join(devDir, 'brandbook.json'));
                brandData.ecosystems.push(...bbEcos);

                // Astrobranding
                if (fs.existsSync(devDir)) {
                    const files = fs.readdirSync(devDir);
                    const match = files.find(f => f.startsWith('astrobranding_') && f.endsWith('.md'));
                    if (match) {
                        const astroEcos = parseAstrobranding(path.join(devDir, match));
                        brandData.ecosystems.push(...astroEcos);
                    }
                }

                // Fallback default
                if (brandData.ecosystems.length === 0) {
                    brandData.ecosystems.push({
                        id: 'eco_sovereign_luxury',
                        title: 'Sovereign Gold & Obsidian',
                        tokens: [
                            { role: 'primary', oklch: 'oklch(0.75 0.15 85)', hex: '#d4af37', name: 'Imperial Gold' },
                            { role: 'secondary', oklch: 'oklch(0.60 0.10 70)', hex: '#9b783e', name: 'Aged Bronze' },
                            { role: 'accent', oklch: 'oklch(0.85 0.12 90)', hex: '#f3e5ab', name: 'Champagne Light' },
                            { role: 'background', oklch: 'oklch(0.12 0.02 260)', hex: '#0b0d14', name: 'Deep Obsidian' },
                            { role: 'surface', oklch: 'oklch(0.18 0.03 260)', hex: '#161a26', name: 'Charcoal Slate' },
                            { role: 'text', oklch: 'oklch(0.96 0.01 260)', hex: '#f1f4fa', name: 'Pure Light' },
                            { role: 'muted', oklch: 'oklch(0.60 0.03 260)', hex: '#848ea4', name: 'Muted Steel' }
                        ]
                    });
                }

                brands[bName] = brandData;
            }

            try {
                fs.writeFileSync(BRANDS_DATA_FILE, JSON.stringify(brands, null, 2), 'utf8');
            } catch {}
            return brands;
        } catch (err) {
            console.error('Error scanning PROYECTOS_DIR:', err);
        }
    }

    // 2. Fallback: read from BRANDS_DATA_FILE
    if (fs.existsSync(BRANDS_DATA_FILE)) {
        try {
            brands = JSON.parse(fs.readFileSync(BRANDS_DATA_FILE, 'utf8'));
            return brands;
        } catch (e) {
            console.error('Error reading BRANDS_DATA_FILE:', e);
        }
    }

    return brands;
}

const server = http.createServer(async (req, res) => {
    // Universal CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    try {
        const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = reqUrl.pathname;

        // 1. Healthcheck
        if (pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'brandfont', uptime: process.uptime() }));
            return;
        }

        // 2. Persistent Fonts Catalog (/api/fonts or /api/catalog)
        if (pathname === '/api/fonts' || pathname === '/api/catalog') {
            if (req.method === 'GET') {
                let fonts = [];
                if (fs.existsSync(CATALOG_FILE)) {
                    try {
                        const raw = await fs.promises.readFile(CATALOG_FILE, 'utf8');
                        fonts = JSON.parse(raw);
                    } catch (e) {
                        console.error('Error reading catalog.json:', e);
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: true, fonts }));
                return;
            }

            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => {
                    body += chunk;
                    if (body.length > 10 * 1024 * 1024) req.destroy();
                });
                req.on('end', async () => {
                    try {
                        const payload = JSON.parse(body);
                        const fonts = Array.isArray(payload) ? payload : (payload.fonts || []);
                        if (!Array.isArray(fonts)) throw new Error('Se esperaba lista de fuentes en "fonts"');

                        // Save backup
                        if (fs.existsSync(CATALOG_FILE)) {
                            try {
                                const oldData = await fs.promises.readFile(CATALOG_FILE, 'utf8');
                                await fs.promises.writeFile(`${CATALOG_FILE}.bak`, oldData, 'utf8');
                            } catch {}
                        }
                        await fs.promises.writeFile(CATALOG_FILE, JSON.stringify(fonts, null, 2), 'utf8');

                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ ok: true, count: fonts.length }));
                    } catch (err) {
                        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ ok: false, error: err.message }));
                    }
                });
                return;
            }
        }

        // 3. SVG Proxy (/api/render) — Exact 1:1 with workbench_server.py
        if (pathname === '/api/render' && req.method === 'GET') {
            const itemUuid = reqUrl.searchParams.get('itemUuid') || '';
            const text = reqUrl.searchParams.get('text') || 'BRAND';
            const variantId = reqUrl.searchParams.get('variant') || '';

            if (!itemUuid) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'itemUuid requerido' }));
                return;
            }

            const params = new URLSearchParams({
                itemUuid: itemUuid.trim(),
                text: text.trim(),
                typed: '1'
            });
            if (variantId.trim()) {
                params.set('variant', variantId.trim());
            }

            const svgUrl = `https://elements.envato.com/font-preview.svg?${params.toString()}`;

            try {
                const proxyResp = await fetch(svgUrl, {
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Referer': 'https://elements.envato.com/'
                    }
                });

                if (proxyResp.ok) {
                    const svgData = await proxyResp.text();
                    res.writeHead(200, {
                        'Content-Type': 'image/svg+xml; charset=utf-8',
                        'Cache-Control': 'public, max-age=3600'
                    });
                    res.end(svgData);
                    return;
                }
                res.writeHead(proxyResp.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Error conectando con Envato: ${proxyResp.statusText}` }));
            } catch (err) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Error conectando con Envato: ${err.message}` }));
            }
            return;
        }

        // 4. Envato Extraction (/api/extract) — Exact 1:1 with workbench_server.py (Base64 INITIAL_HYDRATION_DATA)
        if (pathname === '/api/extract' && req.method === 'GET') {
            let envatoUrl = (reqUrl.searchParams.get('url') || '').trim();
            const brandText = (reqUrl.searchParams.get('text') || 'BRAND').trim();

            if (!envatoUrl) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Parámetro 'url' requerido" }));
                return;
            }

            try {
                if (!envatoUrl.startsWith('http')) {
                    envatoUrl = `https://${envatoUrl}`;
                }

                const pageResp = await fetch(envatoUrl, {
                    headers: { 'User-Agent': USER_AGENT }
                });

                if (!pageResp.ok) {
                    throw new Error(`HTTP ${pageResp.status} desde Envato Elements`);
                }

                const htmlContent = await pageResp.text();
                const m = htmlContent.match(/window\.INITIAL_HYDRATION_DATA="([^"]+)"/);
                if (!m) {
                    throw new Error('No se encontró INITIAL_HYDRATION_DATA en la página de Envato Elements');
                }

                const decodedJson = Buffer.from(m[1], 'base64').toString('utf-8');
                const data = JSON.parse(decodedJson);
                const item = data?.page?.data?.data?.item || {};
                const itemUuid = item.itemUuid;
                const title = item.title || 'Fuente Envato';
                const fontPreview = item.fontPreview || {};
                let variants = fontPreview.variants || [];
                const itemAttributes = item.itemAttributes || {};
                const totalStyleCount = fontPreview.totalStyleCount || variants.length || 1;
                const defaultStyleName = fontPreview.defaultStyleName || 'Regular';

                if (!itemUuid) {
                    throw new Error('No se pudo obtener el itemUuid del ítem');
                }
                if (!variants.length) {
                    variants = [{ id: null, styleName: 'Default' }];
                }

                // Fetch preview SVG para cada variante
                const results = await Promise.all(variants.map(async (v) => {
                    const vId = v.id;
                    const vName = v.styleName || 'Default';
                    const params = new URLSearchParams({
                        itemUuid: itemUuid,
                        text: brandText,
                        typed: '1'
                    });
                    if (vId) params.set('variant', vId);

                    const svgUrl = `https://elements.envato.com/font-preview.svg?${params.toString()}`;
                    let svgCode = '';
                    try {
                        const sResp = await fetch(svgUrl, {
                            headers: {
                                'User-Agent': USER_AGENT,
                                'Referer': envatoUrl
                            }
                        });
                        if (sResp.ok) {
                            svgCode = await sResp.text();
                        }
                    } catch {}

                    return {
                        styleName: vName,
                        variantId: vId,
                        svgUrl: svgUrl,
                        svgContent: svgCode
                    };
                }));

                const responseData = {
                    ok: true,
                    title: title,
                    itemUuid: itemUuid,
                    url: envatoUrl,
                    text: brandText,
                    totalStyleCount: totalStyleCount,
                    defaultStyleName: defaultStyleName,
                    itemAttributes: {
                        ligatures: !!itemAttributes.ligatures,
                        stylisticSet: !!itemAttributes.stylisticSet,
                        alternates: !!itemAttributes.alternates,
                        spacing: itemAttributes.spacing || [],
                        serifSansSerif: itemAttributes.serifSansSerif || '',
                        fontUsage: itemAttributes.fontUsage || [],
                        supportedLanguages: itemAttributes.supportedLanguages || []
                    },
                    variants: results
                };

                // Auto-persist into catalog.json
                try {
                    const fontEntry = {
                        id: `envato_${itemUuid}`,
                        title: title,
                        url: envatoUrl,
                        itemUuid: itemUuid,
                        totalStyleCount: totalStyleCount,
                        defaultStyleName: defaultStyleName,
                        itemAttributes: responseData.itemAttributes,
                        variants: results,
                        previewSvg: results[0] ? results[0].svgContent : ''
                    };

                    let catalog = [];
                    if (fs.existsSync(CATALOG_FILE)) {
                        try {
                            const raw = await fs.promises.readFile(CATALOG_FILE, 'utf8');
                            catalog = JSON.parse(raw);
                        } catch {}
                    }
                    const existingIdx = catalog.findIndex(f => f.id === fontEntry.id);
                    if (existingIdx !== -1) {
                        catalog[existingIdx] = fontEntry;
                    } else {
                        catalog.unshift(fontEntry);
                    }
                    await fs.promises.writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2), 'utf8');
                } catch (catErr) {
                    console.error('Error auto-guardando en catalog.json:', catErr);
                }

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(responseData));
                return;

            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: false, error: err.message }));
                return;
            }
        }

        // 5. Dynamic SSoT Brands API (/api/brands, /api/brands/:brand, /api/brands/sync)
        if (pathname === '/api/brands') {
            const allBrands = loadAllBrands();
            const brandList = Object.keys(allBrands);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, brands: brandList }));
            return;
        }

        if (pathname === '/api/brands/sync') {
            const allBrands = loadAllBrands();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, count: Object.keys(allBrands).length, brands: Object.keys(allBrands) }));
            return;
        }

        if (pathname.startsWith('/api/brands/')) {
            const brandName = decodeURIComponent(pathname.replace('/api/brands/', '').replace(/\/$/, '')).trim();
            const allBrands = loadAllBrands();
            
            // Case-insensitive lookup
            const foundKey = Object.keys(allBrands).find(k => k.toLowerCase() === brandName.toLowerCase());
            const brandData = foundKey ? allBrands[foundKey] : null;

            if (!brandData) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: false, error: `Marca '${brandName}' no encontrada en SSoT` }));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
                ok: true,
                brand: brandData.name,
                ecosystems: brandData.ecosystems || [],
                brandbook: brandData.brandbook || null,
                fontManifest: brandData.fontManifest || null
            }));
            return;
        }

        // 6. Static File Serving
        let relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
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
        const isHtml = ext === '.html';

        res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Cache-Control': isHtml ? 'no-cache, no-store, must-revalidate' : (ext.match(/\.(woff2?|ttf|otf)$/) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
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
