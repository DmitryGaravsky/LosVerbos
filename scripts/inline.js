/* Simple inliner: CSS <link>, JS <script src>, <img src>, and CSS url(...) to data URIs when local. */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const INPUT_HTML = path.join(ROOT, 'index.html');
const DIST_DIR = path.join(ROOT, 'dist');
const OUTPUT_HTML = path.join(DIST_DIR, 'index.html');
const DATA_DIR = path.join(ROOT, 'data');
const ICONS_DIR = path.join(ROOT, 'icons');
const MANIFEST_FILE = path.join(ROOT, 'manifest.webmanifest');
const SW_FILE = path.join(ROOT, 'sw.js');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function isExternal(href) {
  return /^(?:https?:)?\/\//i.test(href) || href.startsWith('data:');
}

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const map = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    cur: 'image/x-icon',
    bmp: 'image/bmp',
    avif: 'image/avif',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf'
  };
  return map[ext] || 'application/octet-stream';
}

function toDataURI(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const mime = guessMime(abs);
  const buf = fs.readFileSync(abs);
  const b64 = buf.toString('base64');
  return `data:${mime};base64,${b64}`;
}

function inlineCssUrls(cssContent, baseDir) {
  // Replace url(...) of local files with data URIs
  return cssContent.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, quote, url) => {
    const clean = url.split('#')[0].split('?')[0].trim();
    if (!clean || isExternal(clean) || clean.startsWith('data:')) return m;
    const abs = path.resolve(baseDir, clean);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return m;
    try {
      const dataUri = toDataURI(abs);
      return `url(${dataUri})`;
    } catch {
      return m;
    }
  });
}

function inlineStyles(html, htmlDir) {
  // <link rel="stylesheet" href="..."> => <style>...</style>
  const linkRe = /<link\b([^>]*?)rel=["']?stylesheet["']?([^>]*?)href=["']([^"']+)["']([^>]*)>/gi;
  return html.replace(linkRe, (match, a1, a2, href) => {
    if (isExternal(href)) return match;
    const cssPath = path.resolve(htmlDir, href);
    if (!fs.existsSync(cssPath)) return match;
    try {
      const rawCss = fs.readFileSync(cssPath, 'utf8');
      const inlinedCss = inlineCssUrls(rawCss, path.dirname(cssPath));
      return `<style>\n${inlinedCss}\n</style>`;
    } catch {
      return match;
    }
  });
}

function inlineScripts(html, htmlDir) {
  // <script src="..."></script> => <script>...</script>
  const scriptRe = /<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi;
  function joinAttrs(a, b) {
    const left = (a || '').trim();
    const right = (b || '').trim();
    const combined = [left, right].filter(Boolean).join(' ');
    return combined ? ' ' + combined : '';
  }
  // Very small ES module bundler for local files: resolves static import ... from './x.js'
  // and strips export keywords, concatenating modules in dependency order.
  function isLocalSpecifier(spec) {
    return spec.startsWith('./') || spec.startsWith('../');
  }
  function extractImportSpecifiers(code) {
    const specs = [];
    // import ... from 'spec'
    const re1 = /\bimport\s+[^;]*?from\s*["']([^"']+)["']\s*;?/g;
    let m;
    while ((m = re1.exec(code)) !== null) specs.push(m[1]);
    // side-effect import 'spec'; (not used here, but handle just in case)
    const re2 = /\bimport\s*["']([^"']+)["']\s*;?/g;
    while ((m = re2.exec(code)) !== null) specs.push(m[1]);
    return specs;
  }
  function stripImportsAndExports(code) {
    // remove entire import lines
    code = code.replace(/^\s*import\s+[^;]*;\s*$/mg, '');
    // remove side-effect import lines
    code = code.replace(/^\s*import\s*["'][^"']+["']\s*;\s*$/mg, '');
    // strip export keyword before declarations
    code = code.replace(/\bexport\s+(?=(class|function|const|let|var)\b)/g, '');
    // handle "export { A, B as C };" (not used in this repo) -> make them globals
    code = code.replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/mg, '');
    return code;
  }
  function bundleModuleEntry(entryAbs) {
    const graph = new Map(); // abs -> { path, code, deps }
    const visiting = new Set();
    const visited = new Set();
    function readFileSafe(p) {
      return fs.readFileSync(p, 'utf8');
    }
    function resolveImport(fromFile, spec) {
      const base = path.dirname(fromFile);
      let target = path.resolve(base, spec);
      // ensure .js extension if omitted
      if (!path.extname(target)) {
        if (fs.existsSync(target + '.js')) target = target + '.js';
      }
      return target;
    }
    function visit(fileAbs) {
      if (visited.has(fileAbs)) return;
      if (visiting.has(fileAbs)) {
        // simple cycle guard; skip to avoid infinite loop
        return;
      }
      visiting.add(fileAbs);
      let code;
      try { code = readFileSafe(fileAbs); } catch { code = ''; }
      const specs = extractImportSpecifiers(code).filter(isLocalSpecifier);
      const deps = [];
      for (const spec of specs) {
        const depAbs = resolveImport(fileAbs, spec);
        if (fs.existsSync(depAbs) && fs.statSync(depAbs).isFile()) {
          deps.push(depAbs);
          visit(depAbs);
        }
      }
      graph.set(fileAbs, { path: fileAbs, code, deps });
      visiting.delete(fileAbs);
      visited.add(fileAbs);
    }
    visit(entryAbs);
    // topo sort via DFS post-order already in visited order; build ordered list
    const ordered = [];
    const seen = new Set();
    function emit(fileAbs) {
      if (seen.has(fileAbs)) return;
      const node = graph.get(fileAbs);
      if (!node) return;
      for (const d of node.deps) emit(d);
      seen.add(fileAbs);
      ordered.push(node);
    }
    emit(entryAbs);
    // concatenate with headers; strip imports/exports
    let out = '';
    for (const node of ordered) {
      const rel = path.relative(htmlDir, node.path).replace(/\\/g, '/');
      out += `\n/* ==== module: ${rel} ==== */\n`;
      out += stripImportsAndExports(node.code).trim() + '\n';
    }
    return out;
  }
  return html.replace(scriptRe, (match, preAttrs, src, postAttrs) => {
    if (isExternal(src)) return match;
    const jsPath = path.resolve(htmlDir, src);
    if (!fs.existsSync(jsPath)) return match;
    try {
      const js = fs.readFileSync(jsPath, 'utf8');
      const attrs = joinAttrs(preAttrs, postAttrs);
      const isModule = /\btype\s*=\s*["']module["']/i.test(attrs) || /\bimport\b|\bexport\b/.test(js);
      if (isModule) {
        const bundled = bundleModuleEntry(jsPath);
        return `<script${attrs}>\n${bundled}\n<\/script>`;
      }
      // classic script: inline as-is
      return `<script${attrs}>\n${js}\n<\/script>`;
    } catch {
      return match;
    }
  });
}

function collectDataFiles() {
  if (!fs.existsSync(DATA_DIR)) return {};

  const entries = {};

  function walk(dir) {
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of list) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') {
        continue;
      }
      try {
        const raw = fs.readFileSync(absPath, 'utf8');
        const parsed = JSON.parse(raw);
        const rel = path.relative(ROOT, absPath).replace(/\\/g, '/');
        entries[rel] = parsed;
        entries['./' + rel] = parsed;
      } catch (error) {
        console.warn(`⚠️  No se pudo procesar ${absPath}: ${error.message}`);
      }
    }
  }

  walk(DATA_DIR);
  return entries;
}

function injectDataScript(html) {
  const dataEntries = collectDataFiles();
  const keys = Object.keys(dataEntries);
  if (!keys.length) return html;

  const serialized = JSON.stringify(dataEntries).replace(/<\/script/gi, '<\\/script');
  const script = `<script>(function(){
  const data = ${serialized};
  const scope = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
  if (!scope) return;
  const target = scope.__INLINE_VERB_DATA__ || (scope.__INLINE_VERB_DATA__ = {});
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      target[key] = data[key];
    }
  }
})();</script>`;

  const anchor = html.indexOf('<script');
  if (anchor === -1) {
    return html + '\n' + script;
  }
  return html.slice(0, anchor) + script + '\n' + html.slice(anchor);
}

function inlineIcons(html, htmlDir) {
  // <link rel="icon" href="..."> (and apple-touch-icon)
  const iconRe = /<link\b([^>]*\brel=["'](?:shortcut\s+icon|icon|apple-touch-icon)["'][^>]*)\bhref=["']([^"']+)["']([^>]*)>/gi;
  return html.replace(iconRe, (match, relPart, href, rest) => {
    if (isExternal(href)) return match;
    const iconPath = path.resolve(htmlDir, href);
    if (!fs.existsSync(iconPath)) return match;
    try {
      const dataUri = toDataURI(iconPath);
      return `<link ${relPart.replace(/\s*$/, '')} href="${dataUri}"${rest}>`;
    } catch {
      return match;
    }
  });
}

function inlineImages(html, htmlDir) {
  // <img src="..."> => inline if local
  const imgRe = /<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>/gi;
  return html.replace(imgRe, (match, pre, src, post) => {
    if (isExternal(src)) return match;
    const imgPath = path.resolve(htmlDir, src.split('#')[0].split('?')[0]);
    if (!fs.existsSync(imgPath) || fs.statSync(imgPath).isDirectory()) return match;
    try {
      const dataUri = toDataURI(imgPath);
      return `<img ${pre}src="${dataUri}"${post}>`;
    } catch {
      return match;
    }
  });
}

function run() {
  if (!fs.existsSync(INPUT_HTML)) {
    console.error('index.html not found at repository root.');
    process.exit(1);
  }
  const htmlDir = path.dirname(INPUT_HTML);
  let html = fs.readFileSync(INPUT_HTML, 'utf8');

  html = inlineStyles(html, htmlDir);
  html = inlineScripts(html, htmlDir);
  html = injectDataScript(html);
  html = inlineIcons(html, htmlDir);
  html = inlineImages(html, htmlDir);

  // Ensure dist exists
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');

  if (fs.existsSync(MANIFEST_FILE)) {
    copyRecursive(MANIFEST_FILE, path.join(DIST_DIR, 'manifest.webmanifest'));
  }

  if (fs.existsSync(SW_FILE)) {
    copyRecursive(SW_FILE, path.join(DIST_DIR, 'sw.js'));
  }

  if (fs.existsSync(ICONS_DIR)) {
    copyRecursive(ICONS_DIR, path.join(DIST_DIR, 'icons'));
  }

  console.log('Single-file build saved to dist/index.html');
}

run();
