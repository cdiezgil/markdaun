//! Word (`.docx`) and PowerPoint (`.pptx`) to Markdown. Both are ZIP + XML, so
//! the `zip` and `quick-xml` crates are all that is needed (no external tools).

use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use zip::ZipArchive;

/// Largest XML part read into memory.
const MAX_XML_BYTES: u64 = 32 * 1024 * 1024;
/// Largest embedded image kept.
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedImage {
    pub name: String,
    pub bytes: Vec<u8>,
    pub media_type: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Extracted {
    pub markdown: String,
    pub images: Vec<ExtractedImage>,
}

/// A single split section from a document.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Section {
    /// Text of the heading or slide title.
    pub title: String,
    /// Markdown content including the heading (for docx) or body text (for pptx).
    pub markdown: String,
}

/// Result of splitting a document into sections.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SplitResult {
    pub sections: Vec<Section>,
    pub images: Vec<ExtractedImage>,
}

// ─── Heading detection and Markdown splitting ────────────────────────────────

/// Returns the heading level (1-6) if `line` is a valid ATX heading, else None.
fn heading_level_of_line(line: &str) -> Option<usize> {
    let hashes = line.bytes().take_while(|&b| b == b'#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = &line[hashes..];
    if rest.is_empty() || rest.starts_with(' ') {
        Some(hashes)
    } else {
        None
    }
}

fn flush_section(
    sections: &mut Vec<Section>,
    current_title: &mut Option<String>,
    current_lines: &mut Vec<&str>,
) {
    let text = current_lines.join("\n");
    match current_title.take() {
        Some(title) => sections.push(Section { title, markdown: text }),
        None => {
            if !text.trim().is_empty() {
                sections.push(Section { title: "Sin título".to_string(), markdown: text });
            }
        }
    }
    current_lines.clear();
}

/// Splits Markdown text into sections by the dominant heading level (H1 or H2).
/// Returns `(sections, cut_level)` where `cut_level` is 1, 2, or 0 (no headings).
///
/// - If H1s exist, cuts by H1.
/// - If no H1 but H2s exist, cuts by H2.
/// - If no H1 or H2, returns a single section with the whole content.
/// - Preamble text before the first heading becomes a "Sin título" section (if non-blank).
/// - An empty heading title becomes "Sin título".
#[cfg_attr(test, allow(dead_code))]
pub(crate) fn split_markdown_by_headings(md: &str) -> (Vec<Section>, usize) {
    let lines: Vec<&str> = md.lines().collect();
    let cut_level = if lines.iter().any(|l| heading_level_of_line(l) == Some(1)) {
        1
    } else if lines.iter().any(|l| heading_level_of_line(l) == Some(2)) {
        2
    } else {
        return (vec![Section { title: "Sin título".to_string(), markdown: md.to_string() }], 0);
    };

    let mut sections: Vec<Section> = Vec::new();
    let mut current_title: Option<String> = None;
    let mut current_lines: Vec<&str> = Vec::new();

    for line in &lines {
        if heading_level_of_line(line) == Some(cut_level) {
            flush_section(&mut sections, &mut current_title, &mut current_lines);
            let after_hashes = &line[cut_level..];
            let title_text = after_hashes.strip_prefix(' ').unwrap_or(after_hashes);
            let title = title_text.trim().to_string();
            let title = if title.is_empty() { "Sin título".to_string() } else { title };
            current_title = Some(title);
            current_lines.push(line);
        } else {
            current_lines.push(line);
        }
    }
    flush_section(&mut sections, &mut current_title, &mut current_lines);

    if sections.is_empty() {
        return (vec![Section { title: "Sin título".to_string(), markdown: md.to_string() }], cut_level);
    }
    (sections, cut_level)
}

// ─── Public split API ─────────────────────────────────────────────────────────

/// Splits a `.docx` into sections (by H1, then H2, then whole doc).
pub fn split_docx(bytes: &[u8]) -> Result<SplitResult, String> {
    let Extracted { markdown, images } = extract_docx(bytes)?;
    let (sections, _level) = split_markdown_by_headings(&markdown);
    Ok(SplitResult { sections, images })
}

/// Dispatches to the correct splitter by file extension.
pub fn split_office(name: &str, bytes: &[u8]) -> Result<SplitResult, String> {
    let lower = name.to_lowercase();
    if lower.ends_with(".docx") {
        split_docx(bytes)
    } else if lower.ends_with(".pptx") {
        split_pptx(bytes)
    } else {
        Err("unsupported_office_format".to_string())
    }
}

/// Whether `name` (a file name) is a document this module extracts.
pub fn is_office_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".docx") || lower.ends_with(".pptx")
}

/// Extracts by file extension.
pub fn extract_office(name: &str, bytes: &[u8]) -> Result<Extracted, String> {
    if name.to_lowercase().ends_with(".docx") {
        extract_docx(bytes)
    } else if name.to_lowercase().ends_with(".pptx") {
        extract_pptx(bytes)
    } else {
        Err("unsupported_office_format".to_string())
    }
}

// ─── Tiny XML tree ────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
struct Node {
    /// Local name (namespace prefix removed).
    name: String,
    attrs: Vec<(String, String)>,
    kids: Vec<Node>,
    text: String,
}

impl Node {
    fn attr(&self, key: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
    fn child(&self, name: &str) -> Option<&Node> {
        self.kids.iter().find(|k| k.name == name)
    }
    fn kids_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> {
        self.kids.iter().filter(move |k| k.name == name)
    }
    /// First descendant (depth-first) with this name.
    fn find(&self, name: &str) -> Option<&Node> {
        for k in &self.kids {
            if k.name == name {
                return Some(k);
            }
            if let Some(f) = k.find(name) {
                return Some(f);
            }
        }
        None
    }
}

fn local(raw: &str) -> String {
    raw.rsplit(':').next().unwrap_or("").to_string()
}

fn node_of(e: &quick_xml::events::BytesStart<'_>) -> Node {
    // Each attribute is reachable by its qualified name (`r:id`) and, unless
    // another attribute already took it, by its local name (`id`).
    let mut attrs: Vec<(String, String)> = Vec::new();
    for a in e.attributes().flatten() {
        let value = a.normalized_value(quick_xml::XmlVersion::Implicit1_0).map(|v| v.to_string()).unwrap_or_default();
        let qname = a.key.as_ref().to_string();
        let short = local(&qname);
        attrs.push((qname.clone(), value.clone()));
        if short != qname && !attrs.iter().any(|(k, _)| *k == short) {
            attrs.push((short, value));
        }
    }
    Node { name: local(e.name().as_ref()), attrs, ..Default::default() }
}

fn parse_xml(bytes: &[u8]) -> Result<Node, String> {
    let mut reader = Reader::from_reader(bytes);
    let mut stack: Vec<Node> = vec![Node::default()];
    loop {
        match reader.read_event().map_err(|e| format!("xml_error: {e}"))? {
            Event::Start(e) => stack.push(node_of(&e)),
            Event::Empty(e) => {
                let n = node_of(&e);
                stack.last_mut().expect("root").kids.push(n);
            }
            Event::End(_) => {
                let n = stack.pop().expect("balanced");
                match stack.last_mut() {
                    Some(parent) => parent.kids.push(n),
                    None => return Err("xml_error: unbalanced".to_string()),
                }
            }
            Event::Text(t) => {
                stack.last_mut().expect("root").text.push_str(&t);
            }
            Event::CData(t) => {
                stack.last_mut().expect("root").text.push_str(&t);
            }
            Event::GeneralRef(r) => {
                let resolved = match r.resolve_char_ref() {
                    Ok(Some(c)) => Some(c.to_string()),
                    _ => match &*r {
                        "amp" => Some("&".to_string()),
                        "lt" => Some("<".to_string()),
                        "gt" => Some(">".to_string()),
                        "quot" => Some("\"".to_string()),
                        "apos" => Some("'".to_string()),
                        _ => None,
                    },
                };
                if let Some(s) = resolved {
                    stack.last_mut().expect("root").text.push_str(&s);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let mut root = stack.pop().ok_or_else(|| "xml_error: empty".to_string())?;
    if !stack.is_empty() || root.kids.is_empty() {
        return Err("xml_error: unbalanced".to_string());
    }
    Ok(root.kids.remove(0))
}

// ─── Package access ───────────────────────────────────────────────────────────

struct Package {
    zip: ZipArchive<Cursor<Vec<u8>>>,
}

impl Package {
    fn open(bytes: &[u8]) -> Result<Self, String> {
        let zip = ZipArchive::new(Cursor::new(bytes.to_vec())).map_err(|e| format!("invalid_document: {e}"))?;
        Ok(Self { zip })
    }

    fn read(&mut self, name: &str, cap: u64) -> Option<Vec<u8>> {
        let file = self.zip.by_name(name).ok()?;
        let mut buf = Vec::new();
        file.take(cap + 1).read_to_end(&mut buf).ok()?;
        (buf.len() as u64 <= cap).then_some(buf)
    }

    fn xml(&mut self, name: &str) -> Option<Node> {
        parse_xml(&self.read(name, MAX_XML_BYTES)?).ok()
    }

    fn names(&self) -> Vec<String> {
        self.zip.file_names().filter_map(|n| n.ok()).map(|n| n.to_string()).collect()
    }
}

/// Relationship id -> (target, is_external).
fn parse_rels(node: Option<Node>) -> HashMap<String, (String, bool, String)> {
    let mut out = HashMap::new();
    if let Some(root) = node {
        for r in root.kids_named("Relationship") {
            if let (Some(id), Some(target)) = (r.attr("Id"), r.attr("Target")) {
                let external = r.attr("TargetMode") == Some("External");
                out.insert(id.to_string(), (target.to_string(), external, r.attr("Type").unwrap_or("").to_string()));
            }
        }
    }
    out
}

/// Resolves a relationship target against the directory of the owning part.
fn resolve(base_dir: &str, target: &str) -> String {
    let mut parts: Vec<&str> = if let Some(t) = target.strip_prefix('/') {
        return t.to_string();
    } else {
        base_dir.split('/').filter(|s| !s.is_empty()).collect()
    };
    for seg in target.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

fn image_type(name: &str) -> Option<&'static str> {
    match name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).as_deref() {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        _ => None,
    }
}

/// Collects images (deduplicated by package path) and returns the inline marker.
#[derive(Default)]
struct ImageSink {
    seen: HashSet<String>,
    images: Vec<ExtractedImage>,
}

impl ImageSink {
    fn add(&mut self, pkg: &mut Package, path: &str) -> Option<String> {
        let name = path.rsplit('/').next()?.to_string();
        let media_type = image_type(&name)?;
        if self.seen.insert(path.to_string()) {
            let bytes = pkg.read(path, MAX_IMAGE_BYTES)?;
            self.images.push(ExtractedImage { name: name.clone(), bytes, media_type: media_type.to_string() });
        } else if !self.images.iter().any(|i| i.name == name) {
            return None;
        }
        Some(format!("[Imagen: {name}]"))
    }
}

// ─── Inline formatting ────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Seg {
    text: String,
    bold: bool,
    italic: bool,
}

fn flag(rpr: Option<&Node>, name: &str) -> bool {
    rpr.and_then(|r| r.child(name))
        .map(|n| !matches!(n.attr("val"), Some("0" | "false" | "off")))
        .unwrap_or(false)
}

/// Merges adjacent segments with the same formatting and renders them.
/// `plain` drops emphasis (headings, table cells keep it plain too).
fn emit(segs: &[Seg], plain: bool) -> String {
    let mut merged: Vec<Seg> = Vec::new();
    for s in segs {
        if s.text.is_empty() {
            continue;
        }
        match merged.last_mut() {
            Some(l) if plain || (l.bold == s.bold && l.italic == s.italic) => l.text.push_str(&s.text),
            _ => merged.push(s.clone()),
        }
    }
    let mut out = String::new();
    for s in merged {
        let (bold, italic) = if plain { (false, false) } else { (s.bold, s.italic) };
        let core = s.text.trim();
        if core.is_empty() || (!bold && !italic) {
            out.push_str(&s.text);
            continue;
        }
        let lead = &s.text[..s.text.len() - s.text.trim_start().len()];
        let trail = &s.text[s.text.trim_end().len()..];
        let mark = match (bold, italic) {
            (true, true) => "***",
            (true, false) => "**",
            _ => "*",
        };
        out.push_str(&format!("{lead}{mark}{core}{mark}{trail}"));
    }
    out
}

fn cell_text(s: &str) -> String {
    s.replace('|', "\\|").replace(['\n', '\r'], " ").trim().to_string()
}

/// GFM table from rows (first row is the header). Rows are padded to equal width.
fn gfm_table(rows: &[Vec<String>]) -> Option<String> {
    let width = rows.iter().map(Vec::len).max()?;
    if width == 0 {
        return None;
    }
    let line = |r: &Vec<String>| {
        let mut cells: Vec<String> = r.iter().map(|c| cell_text(c)).collect();
        cells.resize(width, String::new());
        format!("| {} |", cells.join(" | "))
    };
    let mut out = vec![line(&rows[0]), format!("| {} |", vec!["---"; width].join(" | "))];
    out.extend(rows[1..].iter().map(line));
    Some(out.join("\n"))
}

/// A Markdown block; consecutive list items are joined by a single newline.
struct Block {
    text: String,
    list: bool,
}

fn join_blocks(blocks: &[Block]) -> String {
    let mut out = String::new();
    for (i, b) in blocks.iter().enumerate() {
        if i > 0 {
            out.push_str(if b.list && blocks[i - 1].list { "\n" } else { "\n\n" });
        }
        out.push_str(&b.text);
    }
    out
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────

struct Docx<'a> {
    pkg: &'a mut Package,
    rels: HashMap<String, (String, bool, String)>,
    /// styleId -> lower-cased style name.
    styles: HashMap<String, String>,
    /// numId -> level -> is a bullet.
    numbering: HashMap<String, HashMap<u32, bool>>,
    counters: HashMap<String, Vec<u32>>,
    sink: ImageSink,
}

fn heading_level(style_id: &str, style_name: Option<&str>) -> Option<usize> {
    let from = |s: &str| -> Option<usize> {
        let s = s.to_lowercase().replace([' ', '-', '_'], "");
        if s == "title" || s == "ttulo" || s == "titulo" {
            return Some(1);
        }
        if s == "subtitle" || s == "subttulo" || s == "subtitulo" {
            return Some(2);
        }
        for prefix in ["heading", "ttulo", "titulo"] {
            if let Some(n) = s.strip_prefix(prefix) {
                return n.parse::<usize>().ok().filter(|n| (1..=6).contains(n));
            }
        }
        None
    };
    style_name.and_then(from).or_else(|| from(style_id))
}

impl Docx<'_> {
    fn load_numbering(&mut self) {
        let Some(root) = self.pkg.xml("word/numbering.xml") else { return };
        let mut abstract_levels: HashMap<String, HashMap<u32, bool>> = HashMap::new();
        for a in root.kids_named("abstractNum") {
            let Some(id) = a.attr("abstractNumId") else { continue };
            let levels = a
                .kids_named("lvl")
                .filter_map(|l| {
                    let ilvl = l.attr("ilvl")?.parse::<u32>().ok()?;
                    let fmt = l.child("numFmt").and_then(|f| f.attr("val")).unwrap_or("bullet");
                    Some((ilvl, matches!(fmt, "bullet" | "none")))
                })
                .collect();
            abstract_levels.insert(id.to_string(), levels);
        }
        for n in root.kids_named("num") {
            let (Some(id), Some(abs)) = (n.attr("numId"), n.child("abstractNumId").and_then(|a| a.attr("val"))) else {
                continue;
            };
            if let Some(levels) = abstract_levels.get(abs) {
                self.numbering.insert(id.to_string(), levels.clone());
            }
        }
    }

    fn load_styles(&mut self) {
        let Some(root) = self.pkg.xml("word/styles.xml") else { return };
        for s in root.kids_named("style") {
            if let (Some(id), Some(name)) = (s.attr("styleId"), s.child("name").and_then(|n| n.attr("val"))) {
                self.styles.insert(id.to_string(), name.to_lowercase());
            }
        }
    }

    fn collect_runs(&mut self, node: &Node, segs: &mut Vec<Seg>, out: &mut String) {
        for k in &node.kids {
            match k.name.as_str() {
                "r" => {
                    let rpr = k.child("rPr");
                    let (bold, italic) = (flag(rpr, "b"), flag(rpr, "i"));
                    let mut text = String::new();
                    let mut marker: Option<String> = None;
                    for c in &k.kids {
                        match c.name.as_str() {
                            "t" => text.push_str(&c.text),
                            "tab" => text.push(' '),
                            "br" | "cr" => text.push(' '),
                            "drawing" | "pict" => {
                                let embed = c
                                    .find("blip")
                                    .and_then(|b| b.attr("embed"))
                                    .or_else(|| c.find("imagedata").and_then(|b| b.attr("r:id")));
                                if let Some((target, false, _)) = embed.and_then(|id| self.rels.get(id)).cloned() {
                                    let path = resolve("word", &target);
                                    marker = self.sink.add(self.pkg, &path);
                                }
                            }
                            _ => {}
                        }
                    }
                    segs.push(Seg { text, bold, italic });
                    if let Some(m) = marker {
                        segs.push(Seg { text: m, bold: false, italic: false });
                    }
                }
                "hyperlink" => {
                    out.push_str(&emit(segs, false));
                    segs.clear();
                    let mut inner_segs = Vec::new();
                    let mut inner = String::new();
                    self.collect_runs(k, &mut inner_segs, &mut inner);
                    inner.push_str(&emit(&inner_segs, false));
                    let url = k.attr("r:id").and_then(|id| self.rels.get(id)).map(|(t, _, _)| t.clone());
                    match url {
                        Some(u) if !inner.trim().is_empty() => out.push_str(&format!("[{}]({u})", inner.trim())),
                        _ => out.push_str(&inner),
                    }
                }
                "smartTag" | "ins" | "fldSimple" | "sdt" | "sdtContent" | "customXml" => self.collect_runs(k, segs, out),
                _ => {}
            }
        }
    }

    fn inline(&mut self, p: &Node, plain: bool) -> String {
        let mut segs = Vec::new();
        let mut out = String::new();
        self.collect_runs(p, &mut segs, &mut out);
        out.push_str(&emit(&segs, plain));
        out.trim().to_string()
    }

    fn paragraph(&mut self, p: &Node, blocks: &mut Vec<Block>) {
        let ppr = p.child("pPr");
        let style_id = ppr.and_then(|x| x.child("pStyle")).and_then(|s| s.attr("val")).unwrap_or("");
        let style_name = self.styles.get(style_id).cloned();
        if let Some(level) = heading_level(style_id, style_name.as_deref()) {
            let text = self.inline(p, true);
            if !text.is_empty() {
                blocks.push(Block { text: format!("{} {text}", "#".repeat(level)), list: false });
            }
            return;
        }
        let text = self.inline(p, false);
        if text.is_empty() {
            return;
        }
        let num = ppr.and_then(|x| x.child("numPr"));
        let named_list = style_name.as_deref().map(|n| n.starts_with("list ")).unwrap_or(false);
        if let Some(num) = num {
            let num_id = num.child("numId").and_then(|n| n.attr("val")).unwrap_or("0").to_string();
            let lvl = num.child("ilvl").and_then(|n| n.attr("val")).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
            if num_id != "0" {
                let bullet = self.numbering.get(&num_id).and_then(|l| l.get(&lvl)).copied().unwrap_or(true);
                let line = if bullet {
                    format!("{}- {text}", "  ".repeat(lvl as usize))
                } else {
                    let counters = self.counters.entry(num_id).or_default();
                    counters.resize(lvl as usize + 1, 0);
                    counters[lvl as usize] += 1;
                    format!("{}{}. {text}", "   ".repeat(lvl as usize), counters[lvl as usize])
                };
                blocks.push(Block { text: line, list: true });
                return;
            }
        }
        if named_list {
            let numbered = style_name.as_deref().is_some_and(|n| n.contains("number"));
            let prefix = if numbered { "1." } else { "-" };
            blocks.push(Block { text: format!("{prefix} {text}"), list: true });
            return;
        }
        blocks.push(Block { text, list: false });
    }

    fn table(&mut self, tbl: &Node, blocks: &mut Vec<Block>) {
        let mut rows: Vec<Vec<String>> = Vec::new();
        for tr in tbl.kids_named("tr") {
            let mut cells = Vec::new();
            for tc in tr.kids_named("tc") {
                let texts: Vec<String> =
                    tc.kids_named("p").map(|p| self.inline(p, true)).filter(|t| !t.is_empty()).collect();
                cells.push(texts.join(" "));
                let span = tc
                    .child("tcPr")
                    .and_then(|p| p.child("gridSpan"))
                    .and_then(|g| g.attr("val"))
                    .and_then(|v| v.parse::<usize>().ok())
                    .unwrap_or(1);
                cells.extend(std::iter::repeat_n(String::new(), span.saturating_sub(1)));
            }
            rows.push(cells);
        }
        if let Some(t) = gfm_table(&rows) {
            blocks.push(Block { text: t, list: false });
        }
    }

    fn blocks(&mut self, parent: &Node, blocks: &mut Vec<Block>) {
        for k in &parent.kids {
            match k.name.as_str() {
                "p" => self.paragraph(k, blocks),
                "tbl" => self.table(k, blocks),
                "sdt" => {
                    if let Some(c) = k.child("sdtContent") {
                        self.blocks(c, blocks);
                    }
                }
                _ => {}
            }
        }
    }
}

pub fn extract_docx(bytes: &[u8]) -> Result<Extracted, String> {
    let mut pkg = Package::open(bytes)?;
    let doc = pkg.xml("word/document.xml").ok_or_else(|| "invalid_document: no word/document.xml".to_string())?;
    let rels = parse_rels(pkg.xml("word/_rels/document.xml.rels"));
    let mut d = Docx {
        pkg: &mut pkg,
        rels,
        styles: HashMap::new(),
        numbering: HashMap::new(),
        counters: HashMap::new(),
        sink: ImageSink::default(),
    };
    d.load_styles();
    d.load_numbering();
    let mut blocks = Vec::new();
    if let Some(body) = doc.child("body") {
        d.blocks(body, &mut blocks);
    }
    Ok(Extracted { markdown: join_blocks(&blocks), images: d.sink.images })
}

// ─── PPTX ─────────────────────────────────────────────────────────────────────

struct Pptx<'a> {
    pkg: &'a mut Package,
    sink: ImageSink,
}

fn ph_type(sp: &Node) -> Option<Option<String>> {
    let ph = sp.child("nvSpPr")?.child("nvPr")?.child("ph")?;
    Some(ph.attr("type").map(str::to_string))
}

/// Text of one `a:p`: runs and fields, `a:br` as a space; emphasis from `rPr`.
fn pptx_para(p: &Node) -> String {
    let mut segs = Vec::new();
    for k in &p.kids {
        match k.name.as_str() {
            "r" | "fld" => {
                let rpr = k.child("rPr");
                let on = |a: &str| rpr.and_then(|r| r.attr(a)).is_some_and(|v| v == "1" || v == "true");
                let text = k.child("t").map(|t| t.text.clone()).unwrap_or_default();
                segs.push(Seg { text, bold: on("b"), italic: on("i") });
            }
            "br" => segs.push(Seg { text: " ".into(), bold: false, italic: false }),
            _ => {}
        }
    }
    emit(&segs, false).trim().to_string()
}

fn pptx_table(tbl: &Node) -> Option<String> {
    let rows: Vec<Vec<String>> = tbl
        .kids_named("tr")
        .map(|tr| {
            tr.kids_named("tc")
                .map(|tc| {
                    let ps: Vec<String> = tc
                        .child("txBody")
                        .map(|b| b.kids_named("p").map(pptx_para).filter(|t| !t.is_empty()).collect())
                        .unwrap_or_default();
                    ps.join(" ")
                })
                .collect()
        })
        .collect();
    gfm_table(&rows)
}

impl Pptx<'_> {
    fn shapes(
        &mut self,
        tree: &Node,
        slide_dir: &str,
        rels: &HashMap<String, (String, bool, String)>,
        title: &mut Option<String>,
        blocks: &mut Vec<Block>,
    ) {
        for k in &tree.kids {
            match k.name.as_str() {
                "grpSp" => self.shapes(k, slide_dir, rels, title, blocks),
                "pic" => {
                    let embed = k.find("blip").and_then(|b| b.attr("embed"));
                    if let Some((target, false, _)) = embed.and_then(|id| rels.get(id)) {
                        if let Some(m) = self.sink.add(self.pkg, &resolve(slide_dir, target)) {
                            blocks.push(Block { text: m, list: false });
                        }
                    }
                }
                "graphicFrame" => {
                    if let Some(t) = k.find("tbl").and_then(pptx_table) {
                        blocks.push(Block { text: t, list: false });
                    }
                }
                "sp" => {
                    let ph = ph_type(k);
                    let kind = ph.as_ref().map(|t| t.as_deref().unwrap_or("body"));
                    if matches!(kind, Some("sldNum" | "dt" | "ftr" | "hdr")) {
                        continue;
                    }
                    let Some(body) = k.child("txBody") else { continue };
                    let paras: Vec<(&Node, String)> =
                        body.kids_named("p").map(|p| (p, pptx_para(p))).filter(|(_, t)| !t.is_empty()).collect();
                    if matches!(kind, Some("title" | "ctrTitle")) {
                        if title.is_none() && !paras.is_empty() {
                            *title = Some(paras.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join(" "));
                        }
                        continue;
                    }
                    let placeholder_body = matches!(kind, Some("body" | "obj"));
                    for (p, text) in paras {
                        let ppr = p.child("pPr");
                        let explicit = ppr.is_some_and(|x| x.child("buChar").is_some() || x.child("buAutoNum").is_some());
                        let none = ppr.is_some_and(|x| x.child("buNone").is_some());
                        if (placeholder_body && !none) || explicit {
                            let lvl = ppr.and_then(|x| x.attr("lvl")).and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
                            blocks.push(Block { text: format!("{}- {text}", "  ".repeat(lvl)), list: true });
                        } else {
                            blocks.push(Block { text, list: false });
                        }
                    }
                }
                _ => {}
            }
        }
    }

    /// Renders one slide (loads XML, runs shapes + notes) and returns
    /// `(slide_title, body_markdown)`.  `_index` is reserved for callers.
    fn render_slide(
        &mut self,
        path: &str,
        _index: usize,
        rels: &HashMap<String, (String, bool, String)>,
    ) -> Option<(Option<String>, String)> {
        let root = self.pkg.xml(path)?;
        let (dir, _file) = path.rsplit_once('/').unwrap_or(("", path));
        let mut title = None;
        let mut blocks = Vec::new();
        if let Some(tree) = root.find("spTree") {
            self.shapes(tree, dir, rels, &mut title, &mut blocks);
        }
        let body = join_blocks(&blocks);
        let mut result = body;
        if let Some(n) = self.notes(dir, rels) {
            if !result.is_empty() {
                result.push_str("\n\n");
            }
            result.push_str(&n);
        }
        Some((title, result))
    }

    fn notes(&mut self, slide_dir: &str, rels: &HashMap<String, (String, bool, String)>) -> Option<String> {
        let (target, _, _) = rels.values().find(|(_, _, ty)| ty.ends_with("notesSlide"))?;
        let root = self.pkg.xml(&resolve(slide_dir, target))?;
        let tree = root.find("spTree")?;
        let mut lines: Vec<String> = Vec::new();
        for sp in tree.kids_named("sp") {
            if ph_type(sp).flatten().as_deref() != Some("body") {
                continue;
            }
            if let Some(b) = sp.child("txBody") {
                lines.extend(b.kids_named("p").map(pptx_para).filter(|t| !t.is_empty()));
            }
        }
        if lines.is_empty() {
            return None;
        }
        Some(lines.iter().enumerate().map(|(i, l)| if i == 0 { format!("> Notas: {l}") } else { format!("> {l}") }).collect::<Vec<_>>().join("\n"))
    }
}

fn slide_number(name: &str) -> u32 {
    name.chars().filter(char::is_ascii_digit).collect::<String>().parse().unwrap_or(0)
}

fn slide_paths(pkg: &mut Package) -> Vec<String> {
    let ordered: Vec<String> = pkg
        .xml("ppt/presentation.xml")
        .map(|pres| {
            let rels = parse_rels(pkg.xml("ppt/_rels/presentation.xml.rels"));
            pres.find("sldIdLst")
                .map(|l| {
                    l.kids_named("sldId")
                        .filter_map(|s| s.attr("r:id").and_then(|id| rels.get(id)))
                        .map(|(t, _, _)| resolve("ppt", t))
                        .collect()
                })
                .unwrap_or_default()
        })
        .unwrap_or_default();
    if !ordered.is_empty() {
        return ordered;
    }
    let mut found: Vec<String> = pkg
        .names()
        .into_iter()
        .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
        .collect();
    found.sort_by_key(|n| slide_number(n));
    found
}

/// Builds a map from slide numeric id (as String) to slide zip path.
fn slide_id_to_path(pkg: &mut Package) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(pres) = pkg.xml("ppt/presentation.xml") {
        let rels = parse_rels(pkg.xml("ppt/_rels/presentation.xml.rels"));
        if let Some(id_lst) = pres.find("sldIdLst") {
            for sld in id_lst.kids_named("sldId") {
                if let (Some(id), Some(r_id)) = (sld.attr("id"), sld.attr("r:id")) {
                    if let Some((target, false, _)) = rels.get(r_id).cloned() {
                        map.insert(id.to_string(), resolve("ppt", &target));
                    }
                }
            }
        }
    }
    map
}

/// Returns OOXML sections as `(section_name, slide_ids)` or `None` if absent.
fn pptx_sections_map(pkg: &mut Package) -> Option<Vec<(String, Vec<String>)>> {
    let pres = pkg.xml("ppt/presentation.xml")?;
    let section_lst = pres.find("sectionLst")?;
    let sections: Vec<(String, Vec<String>)> = section_lst
        .kids_named("section")
        .map(|sec| {
            let name = sec.attr("name").unwrap_or("Sin título").to_string();
            let ids: Vec<String> = sec
                .find("sldIdLst")
                .map(|lst| {
                    lst.kids_named("sldId")
                        .filter_map(|s| s.attr("id").map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            (name, ids)
        })
        .collect();
    if sections.is_empty() { None } else { Some(sections) }
}

pub fn extract_pptx(bytes: &[u8]) -> Result<Extracted, String> {
    let mut pkg = Package::open(bytes)?;
    let paths = slide_paths(&mut pkg);
    if paths.is_empty() {
        return Err("invalid_document: no slides".to_string());
    }
    let mut p = Pptx { pkg: &mut pkg, sink: ImageSink::default() };
    let mut sections: Vec<String> = Vec::new();
    for (i, path) in paths.iter().enumerate() {
        let (dir, file) = path.rsplit_once('/').unwrap_or(("", path));
        let rels = parse_rels(p.pkg.xml(&format!("{dir}/_rels/{file}.rels")));
        let Some((title, body)) = p.render_slide(path, i, &rels) else { continue };
        let mut section = match &title {
            Some(t) => format!("## Diapositiva {} — {t}", i + 1),
            None => format!("## Diapositiva {}", i + 1),
        };
        if !body.is_empty() {
            section.push_str("\n\n");
            section.push_str(&body);
        }
        sections.push(section);
    }
    if sections.is_empty() {
        return Err("invalid_document: no readable slides".to_string());
    }
    Ok(Extracted { markdown: sections.join("\n\n"), images: p.sink.images })
}

/// Splits a `.pptx` into sections: one per OOXML section (if `<p:sectionLst>` exists)
/// or one per slide.
pub fn split_pptx(bytes: &[u8]) -> Result<SplitResult, String> {
    let mut pkg = Package::open(bytes)?;
    let paths = slide_paths(&mut pkg);
    if paths.is_empty() {
        return Err("invalid_document: no slides".to_string());
    }
    let id_map = slide_id_to_path(&mut pkg);
    let ooxml_sections = pptx_sections_map(&mut pkg);
    let mut p = Pptx { pkg: &mut pkg, sink: ImageSink::default() };
    let mut result_sections: Vec<Section> = Vec::new();

    if let Some(ooxml) = ooxml_sections {
        // One result section per OOXML section.
        for (section_name, slide_ids) in &ooxml {
            if slide_ids.is_empty() {
                continue; // TC-09: empty sections are skipped
            }
            let mut combined = String::new();
            for slide_id in slide_ids {
                let Some(slide_path) = id_map.get(slide_id) else { continue };
                let slide_path = slide_path.clone();
                let rels = {
                    let (dir, file) = slide_path.rsplit_once('/').unwrap_or(("", &slide_path));
                    parse_rels(p.pkg.xml(&format!("{dir}/_rels/{file}.rels")))
                };
                if let Some((_title, body)) = p.render_slide(&slide_path, 0, &rels) {
                    if !body.is_empty() {
                        if !combined.is_empty() {
                            combined.push_str("\n\n");
                        }
                        combined.push_str(&body);
                    }
                }
            }
            let title = if section_name.trim().is_empty() {
                "Sin título".to_string()
            } else {
                section_name.clone()
            };
            result_sections.push(Section { title, markdown: combined });
        }
    } else {
        // One section per slide.
        for (i, path) in paths.iter().enumerate() {
            let (dir, file) = path.rsplit_once('/').unwrap_or(("", path));
            let rels = parse_rels(p.pkg.xml(&format!("{dir}/_rels/{file}.rels")));
            let Some((slide_title, body)) = p.render_slide(path, i, &rels) else { continue };
            let title = slide_title.unwrap_or_else(|| "Sin título".to_string());
            result_sections.push(Section { title, markdown: body });
        }
    }

    if result_sections.is_empty() {
        return Err("invalid_document: no readable slides".to_string());
    }
    Ok(SplitResult { sections: result_sections, images: p.sink.images })
}
