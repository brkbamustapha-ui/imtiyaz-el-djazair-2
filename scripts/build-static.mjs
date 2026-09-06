/**
 * Exports the public site to plain files — HTML, CSS, JavaScript, images —
 * that any web host serves without Node and without a database.
 *
 * `output: "export"` cannot run against this project as it stands: Next
 * refuses to compile while the ten /api routes, the admin and the middleware
 * exist, because none of them can become a file. Deleting them is not an
 * option either — they are the site. So this builds from a COPY of the
 * project with those parts left out. The real tree is never touched.
 *
 * The site reads its language from a cookie, which a file on disk cannot do.
 * So it is built once per language and the results are assembled side by
 * side: the default language at the root, the others under /fr/ and /ar/.
 * The language switcher follows the same layout (see LocaleSwitcher).
 *
 *   npm run build:static
 *   SITE_URL=https://example.com npm run build:static
 *
 * Output: ./site-statique/ — upload its contents to public_html.
 */

import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const OUT = path.join(root, "site-statique");
const SITE_URL = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "";

/**
 * Parts that cannot exist as files, and so cannot be in an exported build.
 *
 * components/admin goes too: it imports the server actions under
 * src/app/admin/actions, so leaving it behind fails the type check. Nothing
 * on the public site imports from it — verified before adding it here.
 */
const DROP = [
  "src/app/api",
  "src/app/admin",
  "src/app/media",
  "src/components/admin",
  "src/middleware.ts",
];

/** Copied into the work tree; everything else is either generated or dropped. */
const KEEP = [
  "src",
  "public",
  "prisma",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "eslint.config.mjs",
  "node_modules",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    console.error(`\n${command} ${args.join(" ")} failed.`);
    process.exit(result.status ?? 1);
  }
}

/** The languages the site is published in, straight from the database. */
async function readLocales() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const row = await db.siteSetting.findUnique({ where: { key: "general" } });
    const general = JSON.parse(row?.valueJson ?? "{}");
    const enabled = (general.enabledLocales ?? []).filter((l) =>
      ["en", "fr", "ar"].includes(l),
    );
    const fallback = general.defaultLocale ?? "en";
    return {
      locales: enabled.length > 0 ? enabled : [fallback],
      defaultLocale: enabled.includes(fallback) ? fallback : (enabled[0] ?? "en"),
    };
  } finally {
    await db.$disconnect();
  }
}

console.log("Reading the site's languages from the database…");
const { locales, defaultLocale } = await readLocales();
console.log(`  languages: ${locales.join(", ")}   default: ${defaultLocale}\n`);

// ---------------------------------------------------------------- work tree
const work = path.join(os.tmpdir(), `ied-static-${Date.now()}`);
console.log("Preparing a copy of the project without the server-only parts…");
await mkdir(work, { recursive: true });

for (const entry of KEEP) {
  const from = path.join(root, entry);
  if (!existsSync(from)) continue;
  // node_modules is huge and unchanged: link it rather than copy it.
  if (entry === "node_modules") {
    const { symlink } = await import("node:fs/promises");
    await symlink(from, path.join(work, entry), "junction").catch(() => {});
    continue;
  }
  await cp(from, path.join(work, entry), { recursive: true });
}

for (const entry of DROP) {
  await rm(path.join(work, entry), { recursive: true, force: true });
  console.log(`  removed ${entry}`);
}

// next.config: switch to a file export, and stop the image optimiser — its
// /_next/image?url=… URLs need a server, so images must keep plain paths.
const configPath = path.join(work, "next.config.ts");
let config = await readFile(configPath, "utf8");
config = config.replace(
  /output: process\.env\.BUILD_STANDALONE === "true" \? "standalone" : undefined,/,
  'output: "export",',
);
config = config.replace(/images: \{\n(\s+)formats:/, "images: {\n$1unoptimized: true,\n$1formats:");
// The security headers move to .htaccess: an exported site has no server to
// set them, and Next warns about them on every build otherwise.
config = config.replace(/^\s*async headers\(\)[\s\S]*?^\s{2}\},$/m, "");
await writeFile(configPath, config, "utf8");
console.log("  next.config.ts: output: export, images unoptimized, headers dropped");

// The two routes with a [slug] need a list of slugs to write out. This lives
// here rather than in the real source on purpose: a generateStaticParams sitting
// in the project turns /[slug] from "server-rendered on demand" into
// "prerendered at build time" for the LIVE site too — every page frozen as it
// was when the site was deployed, and the admin editing into the void. It is
// only ever wanted for an export.
const PARAMS = {
  "src/app/(site)/[slug]/page.tsx": `
export async function generateStaticParams() {
  const { db } = await import("@/lib/db");
  const pages = await db.page
    .findMany({ where: { isPublished: true }, select: { slug: true } })
    .catch(() => []);
  return pages.filter((page) => page.slug !== "home").map((page) => ({ slug: page.slug }));
}
`,
  "src/app/(site)/news/[slug]/page.tsx": `
export async function generateStaticParams() {
  const { db } = await import("@/lib/db");
  const posts = await db.post
    .findMany({ where: { isPublished: true }, select: { slug: true } })
    .catch(() => []);
  return posts.map((post) => ({ slug: post.slug }));
}
`,
};
for (const [file, code] of Object.entries(PARAMS)) {
  const target = path.join(work, file);
  await writeFile(target, (await readFile(target, "utf8")) + code, "utf8");
}
console.log("  [slug] routes: generateStaticParams added (export only)");

// robots.txt and sitemap.xml are declared force-dynamic, which an export
// rejects. As files they are written once, at build time.
for (const file of ["src/app/robots.ts", "src/app/sitemap.ts"]) {
  const target = path.join(work, file);
  const source = await readFile(target, "utf8");
  await writeFile(
    target,
    source.replace('export const dynamic = "force-dynamic";', 'export const dynamic = "force-static";'),
    "utf8",
  );
}
console.log("  robots.ts / sitemap.ts: force-static\n");

// ------------------------------------------------------------- one per lang
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const locale of locales) {
  console.log(`\n─── Building the ${locale.toUpperCase()} site ───\n`);
  await rm(path.join(work, ".next"), { recursive: true, force: true });
  await rm(path.join(work, "out"), { recursive: true, force: true });

  run("npx", ["next", "build"], {
    cwd: work,
    env: {
      ...process.env,
      NEXT_PUBLIC_STATIC_EXPORT: "true",
      NEXT_PUBLIC_STATIC_LOCALE: locale,
      NEXT_PUBLIC_STATIC_DEFAULT_LOCALE: defaultLocale,
      ...(SITE_URL ? { NEXT_PUBLIC_SITE_URL: SITE_URL } : {}),
    },
  });

  const exported = path.join(work, "out");
  if (!existsSync(exported)) {
    console.error("\nThe export produced no out/ folder.");
    process.exit(1);
  }

  // The default language sits at the root; the others get a folder.
  const destination = locale === defaultLocale ? OUT : path.join(OUT, locale);
  await mkdir(destination, { recursive: true });
  await cp(exported, destination, { recursive: true, force: true });
  console.log(`\n  → ${locale} written to ${path.relative(root, destination) || "."}/`);
}

// Each language was built as if it were the only one, so its pages link to
// "/about" — the English copy. Under /fr/ and /ar/ those links have to point
// within the same language, or clicking the translated menu walks the visitor
// back into English. Only the site's own routes are rewritten: /_next/ and
// /assets/ are shared from the root on purpose.
async function localiseLinks(dir, locale, routes) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await localiseLinks(full, locale, routes);
      continue;
    }
    if (!/\.(html|txt)$/.test(entry.name)) continue;

    let text = await readFile(full, "utf8");
    for (const route of routes) {
      // Quoted exactly, so "/about" is rewritten but "/about-us" is not.
      text = text.split(`"${route}"`).join(`"/${locale}${route}"`);
      // The same links appear again inside the payload the client router
      // reads, where they are strings within a string and their quotes are
      // backslash-escaped. Missing this form leaves the first click on a
      // menu item walking back into the default language — the HTML looked
      // right, the navigation did not.
      text = text.split(`\\"${route}\\"`).join(`\\"/${locale}${route}\\"`);
    }
    text = text.split('href="/"').join(`href="/${locale}/"`);
    text = text.split('\\"href\\":\\"/\\"').join(`\\"href\\":\\"/${locale}/\\"`);
    await writeFile(full, text, "utf8");
  }
}

const routes = new Set();
for (const entry of await readdir(OUT, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".html") && entry.name !== "404.html") {
    routes.add(`/${entry.name.replace(/\.html$/, "")}`);
  }
}
if (existsSync(path.join(OUT, "news"))) {
  for (const entry of await readdir(path.join(OUT, "news"))) {
    if (entry.endsWith(".html")) routes.add(`/news/${entry.replace(/\.html$/, "")}`);
  }
}
// Longest first: /news/an-article must be rewritten before /news.
const ordered = [...routes].sort((a, b) => b.length - a.length);

for (const locale of locales.filter((l) => l !== defaultLocale)) {
  await localiseLinks(path.join(OUT, locale), locale, ordered);
  console.log(`  ${locale}: internal links now stay in ${locale}`);

  // The extra languages ship a duplicate copy of the same CSS, JavaScript and
  // photographs. One set at the root serves all three.
  for (const shared of ["_next", "assets"]) {
    await rm(path.join(OUT, locale, shared), { recursive: true, force: true });
  }
}
console.log("  deduplicated _next/ and assets/ across languages");

// Three languages now live at three addresses, but nothing says so. Without
// hreflang Google treats them as three unrelated pages — or as duplicates of
// each other — and without every language in one sitemap it never finds /fr/
// and /ar/ at all. Both are added here, over the finished files.
if (locales.length > 1 && SITE_URL) {
  const base = SITE_URL.replace(/\/+$/, "");
  const urlFor = (locale, route) => {
    const prefix = locale === defaultLocale ? "" : `/${locale}`;
    return `${base}${prefix}${route === "/index" ? "/" : route}`;
  };

  async function addHreflang(dir, locale) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (locales.includes(entry.name) || entry.name === "_next" || entry.name === "assets") continue;
        await addHreflang(full, locale);
        continue;
      }
      if (!entry.name.endsWith(".html") || entry.name === "404.html") continue;

      const relative = path.relative(locale === defaultLocale ? OUT : path.join(OUT, locale), full);
      const route = "/" + relative.replace(/\\/g, "/").replace(/\.html$/, "");
      const tags = locales
        .map((l) => `<link rel="alternate" hrefLang="${l}" href="${urlFor(l, route)}"/>`)
        .join("");
      const xDefault = `<link rel="alternate" hrefLang="x-default" href="${urlFor(defaultLocale, route)}"/>`;

      let html = await readFile(full, "utf8");

      // Each language was built as if it were the site, so /fr/about and
      // /ar/about both declare the English URL as their canonical — which
      // tells Google they are duplicates and only the English one deserves
      // indexing. That would undo the hreflang above entirely. Every page
      // must point at itself.
      const self = urlFor(locale, route);
      const english = urlFor(defaultLocale, route);
      if (locale !== defaultLocale) {
        // The home page is emitted with and without its trailing slash
        // depending on where the URL was built, so both spellings are
        // replaced — missing one leaves /fr/ declaring the English home as
        // its canonical.
        for (const from of new Set([english, english.replace(/\/$/, "")])) {
          html = html
            .split(`<link rel="canonical" href="${from}"/>`)
            .join(`<link rel="canonical" href="${self}"/>`)
            .split(`property="og:url" content="${from}"`)
            .join(`property="og:url" content="${self}"`);
        }
      }

      if (!html.includes("hrefLang=")) {
        html = html.replace("</head>", `${tags}${xDefault}</head>`);
        await writeFile(full, html, "utf8");
      }
    }
  }

  for (const locale of locales) {
    await addHreflang(locale === defaultLocale ? OUT : path.join(OUT, locale), locale);
  }
  console.log("  added hreflang to every page, in all languages");

  // One sitemap at the root, covering all three languages. The per-language
  // copies are removed: a second sitemap listing only its own language would
  // compete with this one.
  const routesForSitemap = [...routes].sort();
  const entries = [];
  for (const route of routesForSitemap) {
    for (const locale of locales) {
      const alternates = locales
        .map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${urlFor(l, route)}"/>`)
        .join("\n");
      entries.push(
        `  <url>\n    <loc>${urlFor(locale, route)}</loc>\n${alternates}\n` +
          `    <changefreq>${route === "/index" ? "weekly" : "monthly"}</changefreq>\n` +
          `    <priority>${route === "/index" ? "1.0" : "0.7"}</priority>\n  </url>`,
      );
    }
  }
  await writeFile(
    path.join(OUT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
      `xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`,
    "utf8",
  );
  for (const locale of locales.filter((l) => l !== defaultLocale)) {
    for (const file of ["sitemap.xml", "robots.txt"]) {
      await rm(path.join(OUT, locale, file), { force: true });
    }
  }
  console.log(`  one sitemap.xml covering ${entries.length} URLs across ${locales.length} languages`);
}

// Next writes flat files: /about.html. The site's own links ask for /about,
// so something has to connect the two. The .htaccess below does it — but on
// someone else's hosting the .htaccess is the single most likely thing to go
// missing: it is a hidden file, and cPanel's file manager does not show it
// unless you turn that on.
//
// So each page is also written as /about/index.html. Then the site stands up
// on its own: Apache serves a directory's index without being asked, and
// redirects /about to /about/ by itself. mod_rewrite off, .htaccess lost —
// it still works. The copies cost a few megabytes and remove a whole class
// of "it shows 404 and I don't know why".
async function alsoAsDirectories(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_next" || entry.name === "assets") continue;
      await alsoAsDirectories(full);
      continue;
    }
    if (!entry.name.endsWith(".html")) continue;
    if (entry.name === "index.html" || entry.name === "404.html") continue;

    const asDirectory = path.join(dir, entry.name.replace(/\.html$/, ""));
    await mkdir(asDirectory, { recursive: true });
    await cp(full, path.join(asDirectory, "index.html"));
  }
}
await alsoAsDirectories(OUT);
console.log("  every page also written as a folder with index.html");

// Visitors and the site's own links ask for /about, so Apache needs to be
// told. Without this the site works only where MultiViews happens to be on.
await writeFile(
  path.join(OUT, ".htaccess"),
  `# Imtiyaz El Djazair — exported site
# Upload this file together with the rest. It is hidden: make sure the
# file manager is showing hidden files, or the site will return 404s.

DirectoryIndex index.html
ErrorDocument 404 /404.html

<IfModule mod_rewrite.c>
  RewriteEngine On

  # Relative substitutions, so this works whether the site sits at the root
  # of the account or in an addon domain's own folder.

  # /about -> about.html   and   /fr/about -> fr/about.html
  #
  # The substitution is relative on purpose: it then works the same whether
  # this folder is the account's public_html or an addon domain's own folder.
  #
  # There is deliberately no "!-d" condition here: /news is BOTH news.html and
  # a news/ directory holding the articles. Excluding directories makes Apache
  # prefer the directory, and it answered 404 on the news page — verified.
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME}.html -f
  RewriteRule ^(.+?)/?$ $1.html [L]
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/plain text/xml application/javascript application/json image/svg+xml
</IfModule>

# Everything under /_next/ carries a fingerprint in its name and can be kept
# for a year. HTML must not be, or an edit never reaches anyone.
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css               "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType image/png              "access plus 6 months"
  ExpiresByType image/jpeg             "access plus 6 months"
  ExpiresByType image/webp             "access plus 6 months"
  ExpiresByType video/mp4              "access plus 6 months"
  ExpiresByType text/html              "access plus 0 seconds"
</IfModule>

# The headers next.config.ts sets on a running server, set here instead.
<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set X-Frame-Options "SAMEORIGIN"
  Header set Referrer-Policy "strict-origin-when-cross-origin"
  Header set Permissions-Policy "camera=(), microphone=(), geolocation=()"
</IfModule>
`,
  "utf8",
);
console.log("  wrote .htaccess (clean URLs, 404 page, caching, security headers)");

// The videos are the whole weight of this folder: 44 MB of the 54. Re-encoding
// them here rather than in public/ keeps the source untouched while making the
// upload something a shared host and a slow connection can actually take.
const videoDir = path.join(OUT, "assets", "video");
if (existsSync(videoDir)) {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (ffmpeg.status === 0) {
    console.log("\nCompressing the videos for upload…");
    let before = 0;
    let after = 0;
    const { stat } = await import("node:fs/promises");
    for (const name of (await readdir(videoDir)).filter((n) => n.endsWith(".mp4"))) {
      const file = path.join(videoDir, name);
      const temp = path.join(videoDir, `.tmp-${name}`);
      before += (await stat(file)).size;
      const done = spawnSync(
        "ffmpeg",
        ["-y", "-v", "error", "-i", file,
         "-c:v", "libx264", "-crf", "29", "-preset", "slow", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", temp],
        { stdio: "inherit" },
      );
      if (done.status === 0 && existsSync(temp)) {
        const { rename } = await import("node:fs/promises");
        await rename(temp, file);
      } else {
        await rm(temp, { force: true });
      }
      after += (await stat(file)).size;
    }
    const mb = (n) => (n / 1048576).toFixed(1);
    console.log(`  videos: ${mb(before)} MB -> ${mb(after)} MB`);
  } else {
    console.log("\n  ffmpeg not installed — videos left at full size.");
  }
}

await writeFile(
  path.join(OUT, "LISEZ-MOI.txt"),
  [
    "================================================================",
    "  IMTIYAZ EL DJAZAIR — SITE STATIQUE",
    "  Genere par : npm run build:static",
    `  Compile pour : ${SITE_URL || "(aucun domaine indique)"}`,
    "================================================================",
    "",
    "INSTALLATION",
    "------------",
    "Deposer TOUT le contenu de ce dossier dans public_html.",
    "Aucun Node.js, aucune base de donnees, aucun \"npm install\".",
    "",
    "  ATTENTION : le fichier .htaccess est cache. Activer",
    "  \"Afficher les fichiers caches\" dans le gestionnaire de",
    "  fichiers cPanel, sinon les adresses comme /about",
    "  renverront une erreur 404.",
    "",
    "",
    "CE QUI FONCTIONNE",
    "-----------------",
    `  ${locales.length * 12} pages : 12 pages en ${locales.length} langues`,
    ...locales.map(
      (l) => `      ${l}  ->  ${l === defaultLocale ? "/" : `/${l}/`}${l === "ar" ? "   (droite a gauche)" : ""}`,
    ),
    "",
    "  Le changement de langue, qui garde la page en cours",
    "  Le formulaire de contact, qui ouvre la messagerie du",
    "      visiteur avec le message deja redige",
    "  Les photos, les videos, les menus, tous les liens",
    "  robots.txt et un sitemap.xml couvrant toutes les langues",
    "  Les balises hreflang et les canoniques par langue",
    "  Une page 404 aux couleurs du site",
    "",
    "",
    "CE QUI N'EXISTE PAS DANS UNE VERSION STATIQUE",
    "---------------------------------------------",
    "  Le tableau de bord /admin",
    "      Le contenu ne peut plus etre modifie en ligne.",
    "      Chaque changement demande de regenerer ce dossier.",
    "",
    "  L'envoi direct des messages",
    "      Le formulaire passe par la messagerie du visiteur.",
    "      Rien n'est enregistre sur le serveur.",
    "",
    "  Le comptage des visites",
    "      Utiliser les statistiques de cPanel.",
    "",
    "",
    "REGENERER APRES UNE MODIFICATION",
    "--------------------------------",
    "Modifier le contenu dans le tableau de bord de la version",
    "en ligne, puis relancer :",
    "",
    `    SITE_URL=${SITE_URL || "https://votre-domaine"} npm run build:static`,
    "",
    "Le dossier site-statique/ est reconstruit entierement.",
    "",
    "================================================================",
    "",
  ].join("\n"),
  "utf8",
);
console.log("  wrote LISEZ-MOI.txt");

await rm(work, { recursive: true, force: true });

let files = 0;
async function count(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await count(path.join(dir, entry.name));
    else files += 1;
  }
}
await count(OUT);

console.log(`\nReady: site-statique/ — ${files.toLocaleString()} files.`);
console.log("Upload its contents to public_html. No Node, no database.");
