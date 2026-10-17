use super::error::LlmError;

#[test]
fn unit_variants_serialize_with_kind_only() {
    let v = serde_json::to_value(LlmError::Unreachable).unwrap();
    assert_eq!(v, serde_json::json!({ "kind": "Unreachable" }));
}

#[test]
fn bad_response_serializes_kind_and_detail() {
    let v = serde_json::to_value(LlmError::BadResponse("boom".into())).unwrap();
    assert_eq!(v, serde_json::json!({ "kind": "BadResponse", "detail": "boom" }));
}

#[test]
fn roundtrips_through_json() {
    let e = LlmError::Storage("disk".into());
    let back: LlmError = serde_json::from_str(&serde_json::to_string(&e).unwrap()).unwrap();
    assert_eq!(back, e);
}

#[test]
fn display_is_human_readable() {
    assert_eq!(LlmError::Timeout.to_string(), "timed out");
    assert_eq!(LlmError::BadResponse("x".into()).to_string(), "bad response: x");
}
