import http from 'node:http';
import { createRequire } from 'node:module';
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

function parseChromaManifest(filePath) {
    if (!fs.existsSync(filePath)) return [];
    try {
        const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const ecosystems = [];
        if (Array.isArray(manifest.ecosystems)) {
            for (const eco of manifest.ecosystems) {
                if (eco.themes?.dark) {
                    const darkTokens = [];
                    for (const [role, token] of Object.entries(eco.themes.dark)) {
                        darkTokens.push({
                            role,
                            oklch: token.$value || '',
                            hex: token.hex || '',
                            name: token.$description || role
                        });
                    }
                    ecosystems.push({
                        id: `${eco.id}_dark`,
                        title: `${eco.name} (Modo Oscuro)`,
                        tokens: darkTokens
                    });
                }
                if (eco.themes?.light) {
                    const lightTokens = [];
                    for (const [role, token] of Object.entries(eco.themes.light)) {
                        lightTokens.push({
                            role,
                            oklch: token.$value || '',
                            hex: token.hex || '',
                            name: token.$description || role
                        });
                    }
                    ecosystems.push({
                        id: `${eco.id}_light`,
                        title: `${eco.name} (Modo Claro)`,
                        tokens: lightTokens
                    });
                }
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

                // 1. Chroma Manifest (SOTA OKLCH first priority)
                const chromaPath = path.join(devDir, 'chroma_manifest.json');
                const chromaEcos = parseChromaManifest(chromaPath);
                if (chromaEcos.length > 0) {
                    brandData.ecosystems.push(...chromaEcos);
                }

                // 2. Brandbook
                const brandbookPath = path.join(devDir, 'brandbook.json');
                const bbEcos = parseBrandbook(brandbookPath);
                if (fs.existsSync(brandbookPath)) {
                    try {
                        brandData.brandbook = JSON.parse(fs.readFileSync(brandbookPath, 'utf8'));
                    } catch {}
                }
                if (chromaEcos.length === 0) {
                    brandData.ecosystems.push(...bbEcos);
                }

                // 3. Font Manifest (SOTA Typography)
                const fontManifestPath = path.join(devDir, 'font_manifest.json');
                if (fs.existsSync(fontManifestPath)) {
                    try {
                        brandData.fontManifest = JSON.parse(fs.readFileSync(fontManifestPath, 'utf8'));
                    } catch {}
                }

                // 4. Astrobranding (fallback if no chroma)
                if (chromaEcos.length === 0 && fs.existsSync(devDir)) {
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


const require = createRequire(import.meta.url);
let lucideData = null;
let tablerData = null;
let faData = null;

try {
    lucideData = require('@iconify-json/lucide/icons.json');
    tablerData = require('@iconify-json/tabler/icons.json');
    faData = require('@iconify-json/fa6-solid/icons.json');
} catch (e) {
    console.warn('Notice: Local iconify collections will be loaded on demand:', e.message);
}

const SPANISH_ICON_DICTIONARY = {
    "corona": "crown", "coronas": "crown",
    "escudo": "shield", "escudos": "shield",
    "estrella": "star", "estrellas": "star",
    "diamante": "diamond", "diamantes": "diamond", "gema": "gem", "joya": "gem",
    "fuego": "fire", "llama": "flame", "llamas": "flame",
    "sol": "sun", "soles": "sun",
    "luna": "moon", "lunas": "moon",
    "leon": "lion", "león": "lion", "leones": "lion",
    "aguila": "eagle", "águila": "eagle",
    "pluma": "feather", "plumas": "feather",
    "llave": "key", "llaves": "key",
    "trofeo": "trophy", "trofeos": "trophy", "copa": "trophy",
    "reloj": "clock", "tiempo": "time",
    "flor": "flower", "flores": "flower", "hoja": "leaf", "planta": "plant",
    "corazon": "heart", "corazón": "heart",
    "ojo": "eye", "ojos": "eye",
    "circulo": "circle", "círculo": "circle",
    "cruz": "cross", "cruces": "cross",
    "espada": "sword", "espadas": "sword",
    "castillo": "castle", "torre": "tower",
    "anillo": "ring", "anillos": "ring",
    "brujula": "compass", "brújula": "compass",
    "rayo": "lightning", "trueno": "bolt",
    "libro": "book", "libros": "book",
    "ala": "wing", "alas": "wing",
    "medalla": "medal", "premio": "award",
    "mariposa": "butterfly", "rosa": "rose",
    "infinito": "infinity", "ancla": "anchor",
    "casa": "home", "edificio": "building",
    "maletin": "briefcase", "maletín": "briefcase",
    "globo": "globe", "mundo": "world",
    "destello": "sparkles", "destellos": "sparkles", "brillo": "sparkles",
    "magia": "magic", "varita": "wand",
    "ajedrez": "chess", "rey": "king", "reina": "queen",
    "dragon": "dragon", "dragón": "dragon",
    "arbol": "tree", "árbol": "tree", "bosque": "forest"
};

const EXPANDED_ICON_THESAURUS = {
    "flor": ["flower", "rose", "rosette", "tulip", "lotus", "plant", "leaf", "clover", "seedling", "blossom", "bloom", "petal", "sprout", "sunflower"],
    "flores": ["flower", "rose", "rosette", "tulip", "lotus", "plant", "leaf", "clover", "seedling", "blossom", "bloom", "petal", "sprout", "sunflower"],
    "flower": ["flower", "rose", "rosette", "tulip", "lotus", "plant", "leaf", "clover", "seedling", "blossom", "bloom", "petal", "sprout", "sunflower"],
    "flowers": ["flower", "rose", "rosette", "tulip", "lotus", "plant", "leaf", "clover", "seedling", "blossom", "bloom", "petal", "sprout", "sunflower"],
    "rosa": ["rose", "rosette", "flower", "tulip", "lotus", "blossom", "bloom", "petal", "plant", "leaf"],
    "rose": ["rose", "rosette", "flower", "tulip", "lotus", "blossom", "bloom", "petal", "plant", "leaf"],
    "hoja": ["leaf", "plant", "clover", "seedling", "flower", "tree", "sprout", "botany"],
    "hojas": ["leaf", "plant", "clover", "seedling", "flower", "tree", "sprout", "botany"],
    "planta": ["plant", "leaf", "seedling", "sprout", "flower", "tree", "botany"],
    "plantas": ["plant", "leaf", "seedling", "sprout", "flower", "tree", "botany"],
    "corona": ["crown", "king", "queen", "tiara", "royal", "royalty", "scepter", "monarch", "throne"],
    "coronas": ["crown", "king", "queen", "tiara", "royal", "royalty", "scepter", "monarch", "throne"],
    "crown": ["crown", "king", "queen", "tiara", "royal", "royalty", "scepter", "monarch", "throne"],
    "escudo": ["shield", "armor", "defense", "security", "protect", "badge", "crest", "guard"],
    "escudos": ["shield", "armor", "defense", "security", "protect", "badge", "crest", "guard"],
    "shield": ["shield", "armor", "defense", "security", "protect", "badge", "crest", "guard"],
    "estrella": ["star", "sparkles", "sparkle", "shine", "glow", "galaxy", "constellation", "nova", "meteor"],
    "estrellas": ["star", "sparkles", "sparkle", "shine", "glow", "galaxy", "constellation", "nova", "meteor"],
    "star": ["star", "sparkles", "sparkle", "shine", "glow", "galaxy", "constellation", "nova", "meteor"],
    "diamante": ["diamond", "gem", "jewel", "crystal", "ruby", "emerald", "sapphire", "ring", "stone"],
    "diamantes": ["diamond", "gem", "jewel", "crystal", "ruby", "emerald", "sapphire", "ring", "stone"],
    "diamond": ["diamond", "gem", "jewel", "crystal", "ruby", "emerald", "sapphire", "ring", "stone"],
    "fuego": ["fire", "flame", "blaze", "burn", "spark", "torch", "bonfire"],
    "llama": ["flame", "fire", "blaze", "burn", "spark", "torch"],
    "llamas": ["flame", "fire", "blaze", "burn", "spark", "torch"],
    "fire": ["fire", "flame", "blaze", "burn", "spark", "torch", "bonfire"],
    "sol": ["sun", "sunny", "solar", "sunrise", "sunset", "bright", "ray", "light", "day"],
    "sun": ["sun", "sunny", "solar", "sunrise", "sunset", "bright", "ray", "light", "day"],
    "luna": ["moon", "lunar", "crescent", "night", "eclipse"],
    "moon": ["moon", "lunar", "crescent", "night", "eclipse"],
    "corazon": ["heart", "love", "like"],
    "corazón": ["heart", "love", "like"],
    "heart": ["heart", "love", "like"],
    "reloj": ["clock", "time", "hourglass", "watch", "timer"],
    "clock": ["clock", "time", "hourglass", "watch", "timer"],
    "trofeo": ["trophy", "award", "medal", "cup", "winner"],
    "trophy": ["trophy", "award", "medal", "cup", "winner"],
    "leon": ["lion", "cat", "paw", "animal"],
    "león": ["lion", "cat", "paw", "animal"],
    "lion": ["lion", "cat", "paw", "animal"],
    "aguila": ["eagle", "falcon", "hawk", "bird", "wing", "feather"],
    "águila": ["eagle", "falcon", "hawk", "bird", "wing", "feather"],
    "eagle": ["eagle", "falcon", "hawk", "bird", "wing", "feather"],
    "mariposa": ["butterfly", "bug", "wing"],
    "butterfly": ["butterfly", "bug", "wing"],
    "mar": ["wave", "sea", "ocean", "water", "drop", "droplet", "anchor", "fish", "shell"],
    "agua": ["water", "drop", "droplet", "wave", "sea", "ocean"],
    "musica": ["music", "volume", "sound", "note", "headphones"],
    "música": ["music", "volume", "sound", "note", "headphones"],
    "music": ["music", "volume", "sound", "note", "headphones"]
};

function translateSearchQuery(query) {
    if (!query) return "";
    const clean = query.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (SPANISH_ICON_DICTIONARY[clean]) return SPANISH_ICON_DICTIONARY[clean];
    const words = clean.split(/\s+/);
    return words.map(w => SPANISH_ICON_DICTIONARY[w] || w).join(" ");
}

function matchScore(key, term, isPrimary = true) {
    if (key === term) return isPrimary ? 100 : 70;
    if (key.startsWith(term + "-") || key.endsWith("-" + term)) return isPrimary ? 80 : 50;
    if (key.includes("-" + term + "-")) return isPrimary ? 70 : 40;
    if (key.startsWith(term)) return isPrimary ? 60 : 35;
    if (key.includes(term)) return isPrimary ? 40 : 25;
    return 0;
}

function isIrrelevantIcon(key, rawQuery) {
    // Filter out numeric badges (e.g. rosette-number-0..9, rosette-number-10, number-1) unless user explicitly typed digits
    if (/rosette-number-\d/.test(key) || /number-\d/.test(key) || /-badge-\d/.test(key)) {
        return !/\d/.test(rawQuery);
    }
    // Filter out disabled variants (-off) unless query explicitly requests off
    if (key.endsWith("-off") && !rawQuery.includes("off")) {
        return true;
    }
    return false;
}

function searchLocalIcons(query, category = "all", limit = 60) {
    const rawQ = (query || "").trim().toLowerCase();
    const cleanQ = rawQ.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const transQ = translateSearchQuery(rawQ);
    const primaryTerms = Array.from(new Set([rawQ, cleanQ, transQ])).filter(Boolean);

    // Expand through semantic thesaurus
    let expandedTerms = [];
    for (const term of [rawQ, cleanQ, transQ]) {
        if (EXPANDED_ICON_THESAURUS[term]) {
            expandedTerms = expandedTerms.concat(EXPANDED_ICON_THESAURUS[term]);
        }
    }
    const secondaryTerms = Array.from(new Set(expandedTerms)).filter(t => !primaryTerms.includes(t));

    const collections = [];
    if ((category === "all" || category === "lucide") && lucideData) collections.push({ name: "lucide", data: lucideData });
    if ((category === "all" || category === "tabler") && tablerData) collections.push({ name: "tabler", data: tablerData });
    if ((category === "all" || category === "fa") && faData) collections.push({ name: "fa", data: faData });

    const scoredMatches = [];

    for (const col of collections) {
        const keys = Object.keys(col.data.icons);
        for (const key of keys) {
            if (isIrrelevantIcon(key, rawQ)) continue;

            let bestScore = 0;
            // Primary matches
            for (const term of primaryTerms) {
                const s = matchScore(key, term, true);
                if (s > bestScore) bestScore = s;
            }
            // Secondary (thesaurus) matches
            for (const term of secondaryTerms) {
                const s = matchScore(key, term, false);
                if (s > bestScore) bestScore = s;
            }

            if (bestScore > 0) {
                const id = `${col.name}_${key}`;
                const icon = col.data.icons[key];
                const w = icon.width || col.data.width || 24;
                const h = icon.height || col.data.height || 24;
                scoredMatches.push({
                    id,
                    name: key,
                    prefix: col.name,
                    category: col.name,
                    score: bestScore,
                    svg: `<svg viewBox="0 0 ${w} ${h}">${icon.body}</svg>`
                });
            }
        }
    }

    scoredMatches.sort((a, b) => b.score - a.score);
    return scoredMatches.slice(0, limit);
}

const POPULAR_BRAND_ICONS = [
    "crown", "shield", "shield-check", "shield-halved", "diamond", "gem",
    "award", "trophy", "star", "sparkles", "compass", "feather", "feather-pointed",
    "fire", "flame", "sun", "sun-high", "moon", "anchor", "key", "castle",
    "dragon", "eye", "bolt", "ring", "heart", "swords", "wand", "medal",
    "cross", "chess-king", "flower", "infinity", "pyramid", "clover", "target", "globe"
];

function getCollectionIcons(category = "all", limit = 48, offset = 0) {
    const collections = [];
    if ((category === "all" || category === "lucide") && lucideData) collections.push({ name: "lucide", data: lucideData });
    if ((category === "all" || category === "tabler") && tablerData) collections.push({ name: "tabler", data: tablerData });
    if ((category === "all" || category === "fa") && faData) collections.push({ name: "fa", data: faData });

    const results = [];
    const addedIds = new Set();

    // Priority 1: Popular brandmark icons first
    if (offset === 0) {
        for (const popName of POPULAR_BRAND_ICONS) {
            for (const col of collections) {
                if (col.data.icons[popName]) {
                    const id = `${col.name}_${popName}`;
                    if (!addedIds.has(id)) {
                        addedIds.add(id);
                        const icon = col.data.icons[popName];
                        const w = icon.width || col.data.width || 24;
                        const h = icon.height || col.data.height || 24;
                        results.push({
                            id,
                            name: popName,
                            prefix: col.name,
                            category: col.name,
                            svg: `<svg viewBox="0 0 ${w} ${h}">${icon.body}</svg>`
                        });
                        if (results.length >= limit) return results;
                    }
                }
            }
        }
    }

    // Priority 2: General alphabetical browse
    for (const col of collections) {
        const keys = Object.keys(col.data.icons);
        for (const key of keys) {
            const id = `${col.name}_${key}`;
            if (!addedIds.has(id)) {
                addedIds.add(id);
                const icon = col.data.icons[key];
                const w = icon.width || col.data.width || 24;
                const h = icon.height || col.data.height || 24;
                results.push({
                    id,
                    name: key,
                    prefix: col.name,
                    category: col.name,
                    svg: `<svg viewBox="0 0 ${w} ${h}">${icon.body}</svg>`
                });
                if (results.length >= limit) return results;
            }
        }
    }
    return results;
}

// In-memory cache for rendered SVG previews
const svgRenderCache = new Map();

// Helper to pre-populate svgRenderCache from catalog.json
try {
    if (fs.existsSync(CATALOG_FILE)) {
        const catRaw = fs.readFileSync(CATALOG_FILE, 'utf8');
        const catFonts = JSON.parse(catRaw);
        if (Array.isArray(catFonts)) {
            for (const font of catFonts) {
                if (font.itemUuid && Array.isArray(font.variants)) {
                    for (const v of font.variants) {
                        if (v.svgContent && v.svgUrl) {
                            try {
                                const u = new URL(v.svgUrl);
                                const txt = u.searchParams.get('text') || '';
                                const varId = u.searchParams.get('variant') || v.variantId || '';
                                if (txt) {
                                    svgRenderCache.set(`${font.itemUuid}_${varId}_${txt}`, v.svgContent);
                                    svgRenderCache.set(`${font.itemUuid}__${txt}`, v.svgContent);
                                }
                            } catch {}
                        }
                    }
                }
            }
            console.log(`✓ Pre-hydrated ${svgRenderCache.size} SVG previews into svgRenderCache`);
        }
    }
} catch (e) {
    console.warn('Could not pre-populate svgRenderCache:', e.message);
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

        // 3. SVG Proxy (/api/render) — High Performance with Server-side In-Memory Cache
if (pathname === '/api/render' && req.method === 'GET') {
    const itemUuid = reqUrl.searchParams.get('itemUuid') || '';
    const text = reqUrl.searchParams.get('text') || 'BRAND';
    const variantId = reqUrl.searchParams.get('variant') || '';

    if (!itemUuid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'itemUuid requerido' }));
        return;
    }

    const cacheKey = `${itemUuid.trim()}_${variantId.trim()}_${text.trim()}`;
    const fallbackKey = `${itemUuid.trim()}__${text.trim()}`;

    if (svgRenderCache.has(cacheKey)) {
        res.writeHead(200, {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
            'X-Cache': 'HIT'
        });
        res.end(svgRenderCache.get(cacheKey));
        return;
    }
    if (svgRenderCache.has(fallbackKey)) {
        res.writeHead(200, {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
            'X-Cache': 'HIT-FALLBACK'
        });
        res.end(svgRenderCache.get(fallbackKey));
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
            svgRenderCache.set(cacheKey, svgData);
            res.writeHead(200, {
                'Content-Type': 'image/svg+xml; charset=utf-8',
                'Cache-Control': 'public, max-age=3600',
                'X-Cache': 'MISS'
            });
            res.end(svgData);
            return;
        }

        // If Envato returned an error but we have any cached preview for this font, use it as fallback!
        for (const [k, v] of svgRenderCache.entries()) {
            if (k.startsWith(`${itemUuid.trim()}_`)) {
                res.writeHead(200, {
                    'Content-Type': 'image/svg+xml; charset=utf-8',
                    'Cache-Control': 'public, max-age=600',
                    'X-Cache': 'STALE-FALLBACK'
                });
                res.end(v);
                return;
            }
        }

        const errData = await proxyResp.text();
        let errCode = 'font_preview_error';
        try {
            const parsed = JSON.parse(errData);
            if (parsed.errorCode) errCode = parsed.errorCode;
        } catch {}
        res.writeHead(proxyResp.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, errorCode: errCode, error: `Error desde Envato (${proxyResp.status}): ${proxyResp.statusText}` }));
    } catch (err) {
        // Fallback on network error
        for (const [k, v] of svgRenderCache.entries()) {
            if (k.startsWith(`${itemUuid.trim()}_`)) {
                res.writeHead(200, {
                    'Content-Type': 'image/svg+xml; charset=utf-8',
                    'Cache-Control': 'public, max-age=600',
                    'X-Cache': 'NETWORK-FALLBACK'
                });
                res.end(v);
                return;
            }
        }
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Error conectando con Envato: ${err.message}` }));
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
                    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(envatoUrl)) {
                        envatoUrl = `https://app.envato.com/fonts/${envatoUrl}`;
                    } else {
                        envatoUrl = `https://${envatoUrl}`;
                    }
                }

                const pageResp = await fetch(envatoUrl, {
                    headers: { 'User-Agent': USER_AGENT }
                });

                if (!pageResp.ok) {
                    throw new Error(`HTTP ${pageResp.status} desde Envato`);
                }

                const htmlContent = await pageResp.text();

                let itemUuid = '';
                let title = 'Fuente Envato';
                let author = '';
                let authorUrl = '';
                let coverImage = '';
                let sampleImages = [];
                let itemAttributes = {};
                let variants = [];
                let totalStyleCount = 1;
                let defaultStyleName = 'Regular';

                const m = htmlContent.match(/window\.INITIAL_HYDRATION_DATA="([^"]+)"/);
                const uuidMatch = envatoUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);

                if (m) {
                    // Modo clásico elements.envato.com
                    const decodedJson = Buffer.from(m[1], 'base64').toString('utf-8');
                    const data = JSON.parse(decodedJson);
                    const item = data?.page?.data?.data?.item || {};
                    itemUuid = item.itemUuid;
                    title = item.title || 'Fuente Envato';
                    const fontPreview = item.fontPreview || {};
                    variants = fontPreview.variants || [];
                    itemAttributes = item.itemAttributes || {};
                    totalStyleCount = fontPreview.totalStyleCount || variants.length || 1;
                    defaultStyleName = fontPreview.defaultStyleName || 'Regular';
                    coverImage = item.coverImageUrls?.w900 || item.coverImageUrls?.w632 || item.coverImageUrls?.og1200x630 || item.openGraphImageUrl || '';
                    sampleImages = (item.previewImageSrcSets || []).map(s => s.split(' ')[0]).slice(0, 6);
                    author = item.author || '';
                    authorUrl = item.authorUrl ? `https://elements.envato.com${item.authorUrl}` : '';
                } else if (uuidMatch || envatoUrl.includes('app.envato.com')) {
                    // Modo moderno app.envato.com / Newvato
                    itemUuid = uuidMatch ? uuidMatch[1] : '';
                    const titleMatch = htmlContent.match(/data-analytics-item_title="([^"]+)"/) || htmlContent.match(/<title>([^<]+) - Fonts - Envato<\/title>/);
                    title = titleMatch ? titleMatch[1].trim() : 'Fuente Envato';

                    const authorMatch = htmlContent.match(/data-analytics-item_author="([^"]+)"/);
                    author = authorMatch ? authorMatch[1].trim() : '';
                    authorUrl = author ? `https://app.envato.com/search?itemType=fonts&includeAuthor=${encodeURIComponent(author)}` : '';

                    const imgMatches = [...htmlContent.matchAll(new RegExp(`https://elements-resized\\.envatousercontent\\.com/elements-content-platform-public-assets/[^"'\\s\\\\]+/fonts/${itemUuid}/assets/[^"'\\s\\\\]+`, 'g'))].map(x => x[0]);
                    if (imgMatches.length > 0) {
                        coverImage = imgMatches[0];
                        sampleImages = imgMatches.slice(1, 6);
                    }
                } else {
                    throw new Error('No se encontró INITIAL_HYDRATION_DATA ni formato compatible de Envato');
                }

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

                const hasValidSvg = results.some(v => v.svgContent && v.svgContent.includes('<svg'));
                const unsupported = !hasValidSvg;

                const responseData = {
                    ok: true,
                    title: title,
                    itemUuid: itemUuid,
                    url: envatoUrl,
                    text: brandText,
                    totalStyleCount: totalStyleCount,
                    defaultStyleName: defaultStyleName,
                    unsupported: unsupported,
                    unsupportedReason: unsupported ? 'font_preview_unsupported' : undefined,
                    coverImage: coverImage,
                    sampleImages: sampleImages,
                    author: author,
                    authorUrl: authorUrl,
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
                        previewSvg: results[0] ? results[0].svgContent : '',
                        unsupported: unsupported,
                        unsupportedReason: unsupported ? 'font_preview_unsupported' : undefined,
                        coverImage: coverImage,
                        sampleImages: sampleImages,
                        author: author,
                        authorUrl: authorUrl
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

        
        // 5.5 Native Icon Directory & Search API (/api/icons, /api/icons/search)
        if (pathname === '/api/icons/search') {
            const q = reqUrl.searchParams.get('q') || '';
            const cat = reqUrl.searchParams.get('category') || 'all';
            const limit = parseInt(reqUrl.searchParams.get('limit') || '48', 10);

            const matches = searchLocalIcons(q, cat, limit);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, count: matches.length, query: q, icons: matches }));
            return;
        }

        if (pathname === '/api/icons') {
            const cat = reqUrl.searchParams.get('category') || 'all';
            const limit = parseInt(reqUrl.searchParams.get('limit') || '48', 10);
            const offset = parseInt(reqUrl.searchParams.get('offset') || '0', 10);

            const icons = getCollectionIcons(cat, limit, offset);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, count: icons.length, category: cat, icons: icons }));
            return;
        }

        // 6. Static File Serving
        let decodedPathname = pathname;
        try {
            decodedPathname = decodeURIComponent(pathname);
        } catch {}
        let relativePath = decodedPathname === '/' ? 'index.html' : decodedPathname.replace(/^\/+/, '');
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
