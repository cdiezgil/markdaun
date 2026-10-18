//! URL clipping: fetch a page, keep its main article, convert it to Markdown,
//! save the images next to it and write the note into `Entrada/`.
//!
//! Crate choices (evaluated for the readability and Markdown steps):
//! - `dom_smoothie` (MIT, 0.18, 2025-26 releases): a close port of Mozilla's
//!   Readability.js, so it scores and cleans pages the way Firefox reader mode
//!   does. The older `readability` crate (0.3) is unmaintained and pulls an
//!   outdated html5ever; a hand-rolled scorer would be worse than both.
//! - `htmd` (Apache-2.0, 0.5, turndown.js-inspired): headings, lists, links,
//!   emphasis, code, quotes, tables and images. `html2md` was rejected because
//!   it is GPL-3.0+, and `dom_query`'s bundled Markdown serializer escapes
//!   punctuation too aggressively for readable notes.
//! - `dom_query` (MIT) is already a dependency of `dom_smoothie`; it is used
//!   to rewrite `<img>` sources before the conversion.
//!
//! Failures never lose the link: a note with the URL and the reason is written.

use crate::commands::inbox::inbox_ensure_inner;
use crate::fs::naming::sanitize_file_stem;
use dom_query::Document;
use dom_smoothie::Readability;
use reqwest::{Client, Url};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

#[derive(Debug, Clone)]
pub struct ClipOptions {
    pub timeout: Duration,
    pub max_images: usize,
    pub max_image_bytes: usize,
    pub max_page_bytes: usize,
}

impl Default for ClipOptions {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(15),
            max_images: 20,
            max_image_bytes: 10 * 1024 * 1024,
            max_page_bytes: 10 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ClipResult {
    pub note_path: PathBuf,
    pub title: String,
    /// False when only a failure note could be written.
    pub clipped: bool,
    pub failure: Option<String>,
    pub words: usize,
    pub images_downloaded: usize,
    pub images_failed: usize,
}

// ─── Fetching ─────────────────────────────────────────────────────────────────

/// Why a page could not be clipped, in Spanish for the note.
#[derive(Debug)]
struct Failure {
    reason: String,
    /// Page title when the HTML was fetched.
    title: Option<String>,
}

impl Failure {
    fn new(reason: impl Into<String>) -> Self {
        Self { reason: reason.into(), title: None }
    }
}

fn describe_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "tiempo de espera agotado".to_string()
    } else if e.is_connect() {
        "no se pudo conectar".to_string()
    } else if e.is_redirect() {
        "demasiadas redirecciones".to_string()
    } else {
        format!("error de red ({e})")
    }
}

fn build_client(opts: &ClipOptions) -> Result<Client, String> {
    // reqwest picks up HTTPS_PROXY / HTTP_PROXY / NO_PROXY from the environment.
    Client::builder()
        .use_rustls_tls()
        .timeout(opts.timeout)
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("client_error: {e}"))
}

/// Reads at most `cap` bytes of the body; `None` when it is larger.
async fn read_capped(mut resp: reqwest::Response, cap: usize) -> Result<Option<Vec<u8>>, reqwest::Error> {
    let mut out = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        if out.len() + chunk.len() > cap {
            return Ok(None);
        }
        out.extend_from_slice(&chunk);
    }
    Ok(Some(out))
}

fn charset_of(content_type: &str) -> Option<String> {
    let lower = content_type.to_lowercase();
    let i = lower.find("charset=")?;
    Some(lower[i + 8..].trim_matches(|c: char| c == '"' || c == '\'' || c == ';' || c.is_whitespace()).to_string())
}

fn meta_charset(bytes: &[u8]) -> Option<String> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(2048)]).to_lowercase();
    let i = head.find("charset=")?;
    let rest = &head[i + 8..];
    let rest = rest.trim_start_matches(['"', '\'']);
    let end = rest.find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))?;
    Some(rest[..end].to_string())
}

/// UTF-8 unless the page declares Latin-1 / Windows-1252.
fn decode_html(bytes: &[u8], content_type: &str) -> String {
    let charset = charset_of(content_type).or_else(|| meta_charset(bytes));
    match charset.as_deref() {
        Some("iso-8859-1" | "latin1" | "iso8859-1" | "windows-1252" | "cp1252") => bytes.iter().map(|b| *b as char).collect(),
        _ => String::from_utf8_lossy(bytes).to_string(),
    }
}

fn looks_like_html(bytes: &[u8]) -> bool {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_lowercase();
    head.contains("<html") || head.contains("<!doctype html") || head.contains("<body") || head.contains("<p")
}

async fn fetch_html(client: &Client, url: &Url, opts: &ClipOptions) -> Result<String, Failure> {
    let resp = client.get(url.clone()).send().await.map_err(|e| Failure::new(describe_error(&e)))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(Failure::new(format!("HTTP {}", status.as_u16())));
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = read_capped(resp, opts.max_page_bytes)
        .await
        .map_err(|e| Failure::new(describe_error(&e)))?
        .ok_or_else(|| Failure::new("la página es demasiado grande"))?;
    let mime = content_type.split(';').next().unwrap_or("").trim().to_lowercase();
    let declared_html = mime.contains("html") || mime.contains("xml");
    if !declared_html && (!mime.is_empty() || !looks_like_html(&bytes)) {
        let shown = if mime.is_empty() { "desconocido".to_string() } else { mime };
        return Err(Failure::new(format!("el contenido no es HTML ({shown})")));
    }
    Ok(decode_html(&bytes, &content_type))
}

// ─── Extraction (synchronous, DOM types are not Send) ─────────────────────────

struct Article {
    title: String,
    /// Main content as HTML with absolute URLs.
    content_html: String,
}

fn page_title(html: &str) -> Option<String> {
    let doc = Document::from(html);
    let t = doc.select("title").text().trim().to_string();
    (!t.is_empty()).then_some(t)
}

/// Readability keeps short `<title>` values whole ("Post | Site name"); when the
/// page's first `<h1>` is the part before the site name, that is the title.
fn refine_title(html: &str, title: &str) -> String {
    let doc = Document::from(html);
    let h1 = doc.select("h1").first().text().split_whitespace().collect::<Vec<_>>().join(" ");
    let (lt, lh) = (title.to_lowercase(), h1.to_lowercase());
    if !h1.is_empty() && lt != lh && lt.starts_with(&lh) {
        let rest = title[h1.len()..].trim_start();
        if rest.starts_with(['|', '-', '–', '—', '·', ':']) {
            return h1;
        }
    }
    title.to_string()
}

fn extract_article(html: &str, url: &Url) -> Result<Article, Failure> {
    let fail = |reason: &str| Failure { reason: reason.to_string(), title: page_title(html) };
    let mut readability = Readability::new(html, Some(url.as_str()), None).map_err(|_| fail("no se encontró contenido legible"))?;
    let article = readability.parse().map_err(|_| fail("no se encontró contenido legible"))?;
    if article.text_content.trim().is_empty() {
        return Err(fail("no se encontró contenido legible"));
    }
    let title = refine_title(html, article.title.trim());
    let title = if title.is_empty() { page_title(html).unwrap_or_else(|| url.host_str().unwrap_or("Página").to_string()) } else { title };
    Ok(Article { title, content_html: article.content.to_string() })
}

/// Image sources found in the article, resolved against the page URL, in
/// document order, without duplicates.
fn image_urls(content_html: &str, base: &Url) -> Vec<Url> {
    let doc = Document::from(content_html);
    let mut out: Vec<Url> = Vec::new();
    for img in doc.select("img").iter() {
        let Some(src) = img.attr("src") else { continue };
        if let Ok(u) = base.join(src.trim()) {
            if matches!(u.scheme(), "http" | "https") && !out.contains(&u) {
                out.push(u);
            }
        }
    }
    out
}

/// Rewrites every `<img>` to `replace[url]` (local relative path) or, for the
/// images that could not be kept, to the absolute remote URL; then converts to
/// Markdown.
fn to_markdown(content_html: &str, base: &Url, local: &HashMap<Url, String>) -> Result<String, String> {
    let doc = Document::from(content_html);
    for img in doc.select("img").iter() {
        let Some(src) = img.attr("src") else { continue };
        let Ok(abs) = base.join(src.trim()) else { continue };
        let new = local.get(&abs).cloned().unwrap_or_else(|| abs.to_string());
        img.set_attr("src", &new);
        img.remove_attr("srcset");
    }
    let html = doc.select("body").inner_html().to_string();
    let html = if html.trim().is_empty() { doc.html().to_string() } else { html };
    let options = htmd::options::Options {
        bullet_list_marker: htmd::options::BulletListMarker::Dash,
        ul_bullet_spacing: 1,
        ol_number_spacing: 1,
        hr_style: htmd::options::HrStyle::Dashes,
        ..Default::default()
    };
    let md = htmd::HtmlToMarkdown::builder()
        .options(options)
        .skip_tags(vec!["script", "style", "noscript", "iframe"])
        .build()
        .convert(&html)
        .map_err(|e| format!("markdown_error: {e}"))?;
    Ok(tidy(&md))
}

/// Collapses runs of blank lines and trims the ends.
fn tidy(md: &str) -> String {
    let mut out = String::new();
    let mut blanks = 0;
    for line in md.lines() {
        if line.trim().is_empty() {
            blanks += 1;
            continue;
        }
        if !out.is_empty() {
            out.push_str(if blanks > 0 { "\n\n" } else { "\n" });
        }
        blanks = 0;
        out.push_str(line.trim_end());
    }
    out
}

/// Drops a leading `# <title>` line: the note header already has it.
fn without_leading_title(md: &str, title: &str) -> String {
    let trimmed = md.trim_start();
    if let Some(first) = trimmed.lines().next() {
        if let Some(h) = first.strip_prefix("# ") {
            if h.trim().eq_ignore_ascii_case(title.trim()) {
                return trimmed[first.len()..].trim_start().to_string();
            }
        }
    }
    md.to_string()
}

// ─── Images ───────────────────────────────────────────────────────────────────

fn image_ext(content_type: &str, url: &Url) -> String {
    match content_type.split(';').next().unwrap_or("").trim().to_lowercase().as_str() {
        "image/png" => return "png".into(),
        "image/jpeg" | "image/jpg" => return "jpg".into(),
        "image/gif" => return "gif".into(),
        "image/webp" => return "webp".into(),
        "image/svg+xml" => return "svg".into(),
        "image/avif" => return "avif".into(),
        _ => {}
    }
    url.path()
        .rsplit('.')
        .next()
        .filter(|e| (1..=4).contains(&e.len()) && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(str::to_lowercase)
        .unwrap_or_else(|| "img".into())
}

async fn download_image(client: &Client, url: Url, max_bytes: usize) -> Option<(Vec<u8>, String)> {
    let resp = client.get(url.clone()).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let content_type = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    if !content_type.is_empty() && !content_type.to_lowercase().starts_with("image/") {
        return None;
    }
    let bytes = read_capped(resp, max_bytes).await.ok()??;
    Some((bytes, image_ext(&content_type, &url)))
}

/// Percent-encodes what would break a Markdown link destination.
fn encode_segment(s: &str) -> String {
    let mut out: Vec<u8> = Vec::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) || b >= 0x80 {
            out.push(b);
        } else {
            out.extend_from_slice(format!("%{b:02X}").as_bytes());
        }
    }
    String::from_utf8(out).unwrap_or_default()
}

// ─── Writing ──────────────────────────────────────────────────────────────────

/// `<stem>.md` that does not exist yet and whose `<stem>_assets` folder is free
/// too (`stem 2`, `stem 3`… otherwise).
fn free_stem(dir: &Path, base: &str) -> String {
    let mut n = 1;
    loop {
        let stem = if n == 1 { base.to_string() } else { format!("{base} {n}") };
        if !dir.join(format!("{stem}.md")).exists() && !dir.join(format!("{stem}_assets")).exists() {
            return stem;
        }
        n += 1;
    }
}

fn header(title: &str, url: &str, now: chrono::NaiveDateTime) -> String {
    format!("# {title}\n\nFuente: {url}\nCapturado: {}\n\n", now.format("%Y-%m-%d %H:%M"))
}

fn write_failure(dir: &Path, url: &Url, raw_url: &str, now: chrono::NaiveDateTime, f: &Failure) -> Result<ClipResult, String> {
    let host = url.host_str().unwrap_or("enlace");
    let day = now.format("%Y-%m-%d");
    let name = format!("{host} — {day}");
    let stem = free_stem(dir, &sanitize_file_stem(&name).unwrap_or_else(|| "Enlace".to_string()));
    let path = dir.join(format!("{stem}.md"));
    let mut body = header(&name, raw_url, now);
    if let Some(t) = &f.title {
        body.push_str(&format!("Título: {t}\n\n"));
    }
    body.push_str(&format!("No se pudo recortar: {}\n", f.reason));
    std::fs::write(&path, body).map_err(|e| format!("io_error: {e}"))?;
    Ok(ClipResult {
        note_path: path,
        title: f.title.clone().unwrap_or(name),
        clipped: false,
        failure: Some(f.reason.clone()),
        words: 0,
        images_downloaded: 0,
        images_failed: 0,
    })
}

/// Clips `raw_url` into `<vault>/Entrada/`. Only an invalid URL is an error;
/// every other failure produces a note that keeps the link.
pub async fn clip_url(
    vault: &Path,
    raw_url: &str,
    now: chrono::NaiveDateTime,
    opts: &ClipOptions,
) -> Result<ClipResult, String> {
    let raw_url = raw_url.trim();
    let url = Url::parse(raw_url).map_err(|_| "invalid_url".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("invalid_url".to_string());
    }
    let dir = inbox_ensure_inner(vault)?;
    let client = build_client(opts)?;

    let article = match fetch_html(&client, &url, opts).await {
        Ok(html) => {
            let u = url.clone();
            tokio::task::spawn_blocking(move || extract_article(&html, &u))
                .await
                .map_err(|e| format!("task_error: {e}"))?
        }
        Err(f) => Err(f),
    };
    let article = match article {
        Ok(a) => a,
        Err(f) => return write_failure(&dir, &url, raw_url, now, &f),
    };

    let stem = free_stem(&dir, &sanitize_file_stem(&article.title).unwrap_or_else(|| url.host_str().unwrap_or("Página").to_string()));
    let assets_name = format!("{stem}_assets");

    // Download images (concurrently, kept in document order).
    let content_html = article.content_html.clone();
    let base = url.clone();
    let urls = tokio::task::spawn_blocking(move || image_urls(&content_html, &base))
        .await
        .map_err(|e| format!("task_error: {e}"))?;
    let (to_fetch, over_limit) = urls.split_at(urls.len().min(opts.max_images));
    let mut set = tokio::task::JoinSet::new();
    for (i, u) in to_fetch.iter().cloned().enumerate() {
        let (c, max) = (client.clone(), opts.max_image_bytes);
        set.spawn(async move { (i, download_image(&c, u, max).await) });
    }
    let mut results: Vec<Option<(Vec<u8>, String)>> = vec![None; to_fetch.len()];
    while let Some(joined) = set.join_next().await {
        if let Ok((i, r)) = joined {
            results[i] = r;
        }
    }

    let mut local: HashMap<Url, String> = HashMap::new();
    let mut downloaded = 0;
    let mut failed = over_limit.len();
    let assets_dir = dir.join(&assets_name);
    for (u, r) in to_fetch.iter().zip(results) {
        match r {
            Some((bytes, ext)) => {
                downloaded += 1;
                std::fs::create_dir_all(&assets_dir).map_err(|e| format!("io_error: {e}"))?;
                let file = format!("image-{downloaded}.{ext}");
                std::fs::write(assets_dir.join(&file), bytes).map_err(|e| format!("io_error: {e}"))?;
                local.insert(u.clone(), format!("{}/{file}", encode_segment(&assets_name)));
            }
            None => failed += 1,
        }
    }

    let (content_html, base) = (article.content_html, url.clone());
    let markdown = tokio::task::spawn_blocking(move || to_markdown(&content_html, &base, &local))
        .await
        .map_err(|e| format!("task_error: {e}"))??;
    let body = without_leading_title(&markdown, &article.title);
    let words = body.split_whitespace().count();
    let path = dir.join(format!("{stem}.md"));
    let note = format!("{}{body}\n", header(&article.title, raw_url, now));
    std::fs::write(&path, note).map_err(|e| format!("io_error: {e}"))?;
    Ok(ClipResult {
        note_path: path,
        title: article.title,
        clipped: true,
        failure: None,
        words,
        images_downloaded: downloaded,
        images_failed: failed,
    })
}
