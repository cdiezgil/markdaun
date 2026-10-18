use super::testutil::*;

#[tokio::test]
async fn mock_server_records_requests_and_replies() {
    let server = spawn(|req| {
        if req.path == "/hello" {
            MockResponse::json(200, r#"{"ok":true}"#)
        } else {
            MockResponse::json(404, "{}")
        }
    });
    let client = reqwest::Client::new();
    let ok = client
        .post(format!("{}/hello", server.url))
        .header("X-Test", "1")
        .body("payload")
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status().as_u16(), 200);
    let missing = client.get(format!("{}/nope", server.url)).send().await.unwrap();
    assert_eq!(missing.status().as_u16(), 404);

    let reqs = server.requests();
    assert_eq!(reqs.len(), 2);
    assert_eq!(reqs[0].method, "POST");
    assert_eq!(reqs[0].path, "/hello");
    assert_eq!(reqs[0].body, "payload");
    assert_eq!(reqs[0].header("x-test"), Some("1"));
}

#[tokio::test]
async fn mock_server_serves_html_and_binary_bodies_with_their_content_type() {
    let server = spawn(|req| match req.path.as_str() {
        "/page" => MockResponse::html(200, "<p>hola</p>"),
        _ => MockResponse::bytes(200, "image/png", vec![0x89, 0x50, 0x00, 0xff]),
    });
    let client = reqwest::Client::new();
    let page = client.get(format!("{}/page", server.url)).send().await.unwrap();
    assert_eq!(page.headers()["content-type"], "text/html; charset=utf-8");
    assert_eq!(page.text().await.unwrap(), "<p>hola</p>");
    let img = client.get(format!("{}/i.png", server.url)).send().await.unwrap();
    assert_eq!(img.headers()["content-type"], "image/png");
    assert_eq!(img.bytes().await.unwrap().as_ref(), &[0x89, 0x50, 0x00, 0xff]);
}
