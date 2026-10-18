use super::h1_follow::H1FollowDb;
use std::path::Path;

fn db() -> H1FollowDb {
    H1FollowDb::open(Path::new(":memory:")).unwrap()
}

#[test]
fn unknown_notes_do_not_follow() {
    assert!(!db().is_following("/v", "a.md").unwrap());
}

#[test]
fn set_and_clear_following() {
    let db = db();
    db.set_following("/v", "a.md", true).unwrap();
    db.set_following("/v", "a.md", true).unwrap();
    assert!(db.is_following("/v", "a.md").unwrap());
    assert!(!db.is_following("/otra", "a.md").unwrap());
    db.set_following("/v", "a.md", false).unwrap();
    assert!(!db.is_following("/v", "a.md").unwrap());
}

#[test]
fn rekey_follows_renames_and_folder_moves() {
    let db = db();
    db.set_following("/v", "a/Sin título.md", true).unwrap();
    db.set_following("/v", "a/Otra.md", true).unwrap();
    db.rekey("/v", "a/Sin título.md", "a/Idea.md").unwrap();
    assert!(db.is_following("/v", "a/Idea.md").unwrap());
    assert!(!db.is_following("/v", "a/Sin título.md").unwrap());
    db.rekey("/v", "a", "b/a").unwrap();
    assert!(db.is_following("/v", "b/a/Idea.md").unwrap());
    assert!(db.is_following("/v", "b/a/Otra.md").unwrap());
    assert!(!db.is_following("/v", "a/Idea.md").unwrap());
}

#[test]
fn remove_cleans_a_note_or_a_whole_folder() {
    let db = db();
    db.set_following("/v", "a/N.md", true).unwrap();
    db.set_following("/v", "a/sub/M.md", true).unwrap();
    db.set_following("/v", "ab.md", true).unwrap();
    db.remove("/v", "a").unwrap();
    assert!(!db.is_following("/v", "a/N.md").unwrap());
    assert!(!db.is_following("/v", "a/sub/M.md").unwrap());
    assert!(db.is_following("/v", "ab.md").unwrap(), "sibling with a common prefix survives");
}
