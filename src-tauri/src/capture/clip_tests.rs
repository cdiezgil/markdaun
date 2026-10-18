use super::clip::{clip_url, ClipOptions};
use crate::llm::testutil::{closed_port_url, spawn, MockResponse, MockServer, Recorded};
use chrono::NaiveDate;
use std::fs;
use std::time::Duration;
use tempfile::tempdir;

fn now() -> chrono::NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 10, 18).unwrap().and_hms_opt(9, 5, 0).unwrap()
}

fn long_paragraph(topic: &str) -> String {
    format!(
        "<p>{topic} es un tema extenso que merece varias frases completas para que el algoritmo de legibilidad lo \
         considere contenido principal de la página. Escribimos oraciones largas, con comas, para aumentar la \
         puntuación del párrafo y separar el artículo del ruido que lo rodea, como menús, anuncios y pies de página.</p>"
    )
}

fn article_page(title: &str, imgs: &str) -> String {
    format!(
        r#"<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>{title} | Sitio de pruebas</title></head>
<body>
<header><nav><ul><li><a href="/">Inicio</a></li><li><a href="/suscribete">Suscríbete ahora</a></li></ul></nav></header>
<div class="ad-banner sponsored"><p>Compra ya el anuncio patrocinado</p></div>
<article>
<h1>{title}</h1>
{p1}
<h2>Una sección</h2>
{p2}
<ul><li>primer punto</li><li>segundo punto</li></ul>
<p>Un párrafo con <strong>negrita</strong>, <em>cursiva</em>, <code>codigo()</code> y un <a href="/otra-pagina">enlace relativo</a>.</p>
<blockquote><p>Una cita memorable que aparece dentro del artículo.</p></blockquote>
<table><thead><tr><th>Clave</th><th>Valor</th></tr></thead><tbody><tr><td>a</td><td>1</td></tr></tbody></table>
{imgs}
{p3}
</article>
<footer><p>Copyright pie de página legal</p></footer>
</body></html>"#,
        p1 = long_paragraph("El primer asunto"),
        p2 = long_paragraph("El segundo asunto"),
        p3 = long_paragraph("El tercer asunto"),
    )
}

const PNG: &[u8] = crate::capture::testutil::PNG;

fn site(page: String) -> MockServer {
    spawn(move |req: &Recorded| match req.path.as_str() {
        "/articulo" => MockResponse::html(200, &page),
        "/a.png" | "/b.png" => MockResponse::bytes(200, "image/png", PNG.to_vec()),
        "/roto.png" => MockResponse::json(404, "{}"),
        _ => MockResponse::json(404, "{}"),
    })
}

fn opts() -> ClipOptions {
    ClipOptions { timeout: Duration::from_secs(5), ..ClipOptions::default() }
}

#[tokio::test]
async fn clips_the_main_article_with_header_and_without_noise() {
    let server = site(article_page("Mi artículo: guía", ""));
    let vault = tempdir().unwrap();
    let url = format!("{}/articulo", server.url);
    let r = clip_url(vault.path(), &url, now(), &opts()).await.unwrap();
    assert!(r.clipped, "{:?}", r.failure);
    assert_eq!(r.title, "Mi artículo: guía");
    assert_eq!(r.note_path, vault.path().join("Entrada/Mi artículo- guía.md"));
    let md = fs::read_to_string(&r.note_path).unwrap();
    let lines: Vec<&str> = md.lines().collect();
    assert_eq!(lines[0], "# Mi artículo: guía");
    assert_eq!(lines[1], "");
    assert_eq!(lines[2], format!("Fuente: {url}"));
    assert_eq!(lines[3], "Capturado: 2026-10-18 09:05");
    assert_eq!(lines[4], "");
    assert!(md.matches("# Mi artículo: guía").count() == 1, "title is not repeated:\n{md}");
    assert!(md.contains("El primer asunto es un tema extenso"));
    assert!(md.contains("## Una sección"));
    assert!(md.contains("- primer punto") || md.contains("* primer punto"), "{md}");
    assert!(md.contains("**negrita**") && md.contains("*cursiva*") || md.contains("_cursiva_"), "{md}");
    assert!(md.contains("`codigo()`"));
    assert!(md.contains(&format!("({}/otra-pagina)", server.url)), "relative links become absolute:\n{md}");
    assert!(md.contains("> Una cita memorable"));
    assert!(md.contains("| Clave | Valor |"), "{md}");
    for noise in ["Suscríbete", "anuncio patrocinado", "Copyright"] {
        assert!(!md.contains(noise), "{noise} leaked:\n{md}");
    }
    assert!(r.words > 50);
    assert_eq!(r.images_downloaded, 0);
    assert!(!vault.path().join("Entrada/Mi artículo- guía_assets").exists(), "no assets folder without images");
}

#[tokio::test]
async fn downloads_images_rewrites_links_and_keeps_failed_ones_remote() {
    let imgs = r#"<p><img src="/a.png" alt="Primera"></p><p><img src="/roto.png" alt="Rota"></p><p><img src="/a.png" alt="Repetida"></p>"#;
    let server = site(article_page("Con imágenes", imgs));
    let vault = tempdir().unwrap();
    let r = clip_url(vault.path(), &format!("{}/articulo", server.url), now(), &opts()).await.unwrap();
    assert!(r.clipped, "{:?}", r.failure);
    assert_eq!((r.images_downloaded, r.images_failed), (1, 1));
    let md = fs::read_to_string(&r.note_path).unwrap();
    assert!(md.contains("![Primera](Con%20im%C3%A1genes_assets/image-1.png)") || md.contains("![Primera](Con%20imágenes_assets/image-1.png)") || md.contains("![Primera](Con imágenes_assets/image-1.png)"), "{md}");
    assert!(md.contains(&format!("![Rota]({}/roto.png)", server.url)), "{md}");
    // The repeated URL reuses the downloaded file.
    assert_eq!(md.matches("image-1.png").count(), 2, "{md}");
    let assets = vault.path().join("Entrada/Con imágenes_assets");
    assert_eq!(fs::read(assets.join("image-1.png")).unwrap(), PNG);
    assert_eq!(fs::read_dir(&assets).unwrap().count(), 1);
}

#[tokio::test]
async fn respects_image_count_and_size_limits() {
    let imgs = r#"<p><img src="/a.png" alt="uno"></p><p><img src="/b.png" alt="dos"></p>"#;
    let server = site(article_page("Limites", imgs));
    let vault = tempdir().unwrap();
    let url = format!("{}/articulo", server.url);
    let capped = ClipOptions { max_images: 1, ..opts() };
    let r = clip_url(vault.path(), &url, now(), &capped).await.unwrap();
    assert_eq!(r.images_downloaded, 1);
    let md = fs::read_to_string(&r.note_path).unwrap();
    assert!(md.contains(&format!("({}/b.png)", server.url)), "over-limit image stays remote:\n{md}");

    let tiny = ClipOptions { max_image_bytes: 10, ..opts() };
    let r = clip_url(vault.path(), &url, now(), &tiny).await.unwrap();
    assert_eq!((r.images_downloaded, r.images_failed), (0, 2), "images over the byte limit are not kept");
    assert!(!vault.path().join("Entrada/Limites 2_assets").exists());
}

#[tokio::test]
async fn same_article_twice_gets_numbered_names_and_assets() {
    let imgs = r#"<p><img src="/a.png" alt="uno"></p>"#;
    let server = site(article_page("Repetido", imgs));
    let vault = tempdir().unwrap();
    let url = format!("{}/articulo", server.url);
    let a = clip_url(vault.path(), &url, now(), &opts()).await.unwrap();
    let b = clip_url(vault.path(), &url, now(), &opts()).await.unwrap();
    assert_eq!(a.note_path.file_name().unwrap(), "Repetido.md");
    assert_eq!(b.note_path.file_name().unwrap(), "Repetido 2.md");
    assert!(vault.path().join("Entrada/Repetido 2_assets/image-1.png").is_file());
    assert!(fs::read_to_string(&b.note_path).unwrap().contains("Repetido%202_assets/image-1.png"));
}

#[tokio::test]
async fn follows_redirects() {
    let page = article_page("Redirigido", "");
    let server = spawn(move |req: &Recorded| match req.path.as_str() {
        "/viejo" => MockResponse::redirect(301, "/articulo"),
        "/articulo" => MockResponse::html(200, &page),
        _ => MockResponse::json(404, "{}"),
    });
    let vault = tempdir().unwrap();
    let r = clip_url(vault.path(), &format!("{}/viejo", server.url), now(), &opts()).await.unwrap();
    assert!(r.clipped && r.title == "Redirigido");
    assert!(fs::read_to_string(&r.note_path).unwrap().contains(&format!("Fuente: {}/viejo", server.url)));
}

#[tokio::test]
async fn sends_a_desktop_browser_user_agent() {
    let server = site(article_page("UA", ""));
    let vault = tempdir().unwrap();
    clip_url(vault.path(), &format!("{}/articulo", server.url), now(), &opts()).await.unwrap();
    let ua = server.requests()[0].header("user-agent").unwrap().to_string();
    assert!(ua.starts_with("Mozilla/5.0"), "{ua}");
}

#[tokio::test]
async fn decodes_latin1_pages() {
    let html = article_page("Café", "").replace("<meta charset=\"utf-8\">", "<meta charset=\"iso-8859-1\">");
    let bytes: Vec<u8> = html.chars().map(|c| if (c as u32) < 256 { c as u32 as u8 } else { b'?' }).collect();
    let server = spawn(move |_| MockResponse::bytes(200, "text/html", bytes.clone()));
    let vault = tempdir().unwrap();
    let r = clip_url(vault.path(), &server.url, now(), &opts()).await.unwrap();
    assert_eq!(r.title, "Café");
}

async fn failure_note(handler: impl Fn(&Recorded) -> MockResponse + Send + Sync + 'static, o: ClipOptions) -> (String, String) {
    let server = spawn(handler);
    let vault = tempdir().unwrap();
    let url = format!("{}/x", server.url);
    let r = clip_url(vault.path(), &url, now(), &o).await.unwrap();
    assert!(!r.clipped);
    assert_eq!(r.note_path, vault.path().join("Entrada/127.0.0.1 — 2026-10-18.md"));
    let md = fs::read_to_string(&r.note_path).unwrap();
    assert!(md.contains("# 127.0.0.1 — 2026-10-18"), "{md}");
    assert!(md.contains(&format!("Fuente: {url}")) && md.contains("Capturado: 2026-10-18 09:05"), "{md}");
    (md, r.failure.unwrap())
}

#[tokio::test]
async fn http_errors_leave_a_note_with_the_reason() {
    let (md, reason) = failure_note(|_| MockResponse::html(404, "<html><title>Nada</title></html>"), opts()).await;
    assert_eq!(reason, "HTTP 404");
    assert!(md.contains("No se pudo recortar: HTTP 404"), "{md}");
}

#[tokio::test]
async fn non_html_content_leaves_a_note() {
    let (md, _) = failure_note(|_| MockResponse::bytes(200, "application/pdf", b"%PDF".to_vec()), opts()).await;
    assert!(md.contains("No se pudo recortar: el contenido no es HTML (application/pdf)"), "{md}");
}

#[tokio::test]
async fn timeout_leaves_a_note() {
    let o = ClipOptions { timeout: Duration::from_millis(200), ..opts() };
    let (md, _) = failure_note(|_| MockResponse::html(200, "<p>tarde</p>").delayed(1500), o).await;
    assert!(md.contains("No se pudo recortar: tiempo de espera agotado"), "{md}");
}

#[tokio::test]
async fn empty_extraction_keeps_the_page_title_in_the_note() {
    let (md, _) = failure_note(|_| MockResponse::html(200, "<html><head><title>Página vacía</title></head><body></body></html>"), opts()).await;
    assert!(md.contains("No se pudo recortar: no se encontró contenido legible"), "{md}");
    assert!(md.contains("Título: Página vacía"), "{md}");
}

#[tokio::test]
async fn unreachable_host_leaves_a_note_and_collisions_are_numbered() {
    let vault = tempdir().unwrap();
    let url = closed_port_url();
    let a = clip_url(vault.path(), &url, now(), &opts()).await.unwrap();
    let b = clip_url(vault.path(), &url, now(), &opts()).await.unwrap();
    assert!(!a.clipped && !b.clipped);
    assert!(fs::read_to_string(&a.note_path).unwrap().contains("No se pudo recortar: no se pudo conectar"));
    assert_eq!(b.note_path.file_name().unwrap(), "127.0.0.1 — 2026-10-18 2.md");
}

#[tokio::test]
async fn rejects_non_http_urls_without_writing_anything() {
    let vault = tempdir().unwrap();
    for bad in ["ftp://example.com/a", "no es una url", "file:///etc/passwd", ""] {
        assert_eq!(clip_url(vault.path(), bad, now(), &opts()).await.unwrap_err(), "invalid_url", "{bad}");
    }
    assert!(!vault.path().join("Entrada").exists() || fs::read_dir(vault.path().join("Entrada")).unwrap().count() == 0);
}
