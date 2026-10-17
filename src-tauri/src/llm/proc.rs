use super::error::LlmError;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

/// Finds an executable by name. Injectable so tests can point at fake scripts.
pub trait BinaryResolver: Send + Sync {
    fn resolve(&self, name: &str) -> Option<PathBuf>;
}

/// Test resolver: a fixed name -> path table.
#[cfg(test)]
#[derive(Default)]
pub struct FixedResolver(pub HashMap<String, PathBuf>);

#[cfg(test)]
impl FixedResolver {
    pub fn with(mut self, name: &str, path: impl Into<PathBuf>) -> Self {
        self.0.insert(name.to_string(), path.into());
        self
    }
}

#[cfg(test)]
impl BinaryResolver for FixedResolver {
    fn resolve(&self, name: &str) -> Option<PathBuf> {
        self.0.get(name).cloned()
    }
}

/// Dock-launched macOS apps do not inherit the user's PATH, so ask a login
/// shell (`zsh -lc 'command -v X'`; `where X` on Windows). Successes are cached.
#[derive(Default)]
pub struct LoginShellResolver {
    cache: Mutex<HashMap<String, PathBuf>>,
}

fn safe_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

impl BinaryResolver for LoginShellResolver {
    fn resolve(&self, name: &str) -> Option<PathBuf> {
        if !safe_name(name) {
            return None;
        }
        if let Some(p) = self.cache.lock().unwrap().get(name) {
            return Some(p.clone());
        }
        let out = if cfg!(windows) {
            std::process::Command::new("where").arg(name).output().ok()?
        } else {
            let cmd = format!("command -v {name}");
            // Prefer the user's login shell (zsh on macOS) for a PATH that
            // matches the terminal; fall back to sh where zsh is absent (e.g. Linux CI).
            match std::process::Command::new("zsh").args(["-lc", &cmd]).output() {
                Ok(out) if out.status.success() => out,
                _ => std::process::Command::new("sh").args(["-lc", &cmd]).output().ok()?,
            }
        };
        if !out.status.success() {
            return None;
        }
        // Login shells may print rc-file noise first; the last absolute existing path wins.
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let found = stdout
            .lines()
            .rev()
            .map(str::trim)
            .map(PathBuf::from)
            .find(|p| p.is_absolute() && p.is_file())?;
        self.cache.lock().unwrap().insert(name.to_string(), found.clone());
        Some(found)
    }
}

#[derive(Debug, Clone)]
pub struct CmdOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

const ETXTBSY_MAX_RETRIES: u32 = 50;

/// Calls `spawn`, retrying up to `max_retries` times (sleeping `delay` between
/// attempts) while it fails with ETXTBSY (os error 26). Any other error, or the
/// last ETXTBSY once the budget is spent, is returned as-is.
pub(crate) fn spawn_with_retry<T>(
    max_retries: u32,
    delay: Duration,
    mut spawn: impl FnMut() -> std::io::Result<T>,
) -> std::io::Result<T> {
    let mut retries = 0;
    loop {
        match spawn() {
            Err(e) if e.raw_os_error() == Some(26) && retries < max_retries => {
                retries += 1;
                std::thread::sleep(delay);
            }
            other => return other,
        }
    }
}

/// Runs `bin` non-interactively: optional stdin, scrubbed env vars, fixed cwd,
/// hard timeout (the child is killed when the future is dropped).
pub async fn run(
    bin: &Path,
    args: &[String],
    stdin: Option<&str>,
    env_remove: &[&str],
    cwd: &Path,
    timeout: Duration,
) -> Result<CmdOutput, LlmError> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for key in env_remove {
        cmd.env_remove(key);
    }
    // Linux can refuse to exec a freshly-written script with ETXTBSY (os error 26)
    // while its write has not fully settled; a bounded number of brief retries settles the race.
    let mut child = match spawn_with_retry(ETXTBSY_MAX_RETRIES, Duration::from_millis(20), || cmd.spawn()) {
        Ok(child) => child,
        Err(e) => {
            return Err(if e.kind() == std::io::ErrorKind::NotFound {
                LlmError::CliMissing
            } else {
                LlmError::BadResponse(format!("cannot start {}: {e}", bin.display()))
            });
        }
    };
    if let Some(mut si) = child.stdin.take() {
        let data = stdin.unwrap_or("").to_string();
        // Write in a task so a child that never reads cannot deadlock us; dropping closes stdin.
        tokio::spawn(async move {
            let _ = si.write_all(data.as_bytes()).await;
        });
    }
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Err(_) => Err(LlmError::Timeout),
        Ok(Err(e)) => Err(LlmError::BadResponse(format!("process error: {e}"))),
        Ok(Ok(o)) => Ok(CmdOutput {
            code: o.status.code(),
            stdout: String::from_utf8_lossy(&o.stdout).to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).to_string(),
        }),
    }
}
