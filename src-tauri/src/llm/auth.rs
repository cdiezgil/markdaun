/// What goes into the auth header (or nothing).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Credential {
    None,
    Secret(String),
}
