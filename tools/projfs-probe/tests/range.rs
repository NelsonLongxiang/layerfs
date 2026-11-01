use layerfs_native_probe::{read_window, seed};
#[test]
fn fixture_is_deterministic_and_nontrivial() {
    let bytes = seed();
    assert_eq!(bytes.len(), 96 * 1024);
    assert_eq!(bytes, seed());
    assert_eq!(&bytes[..4], &[0, 1, 2, 3]);
    assert_eq!(bytes[251], 0);
}
#[test]
fn aligned_windows_cover_the_requested_bytes() {
    assert_eq!(read_window(4093, 23, 98304, 4096), Some((0, 8192)));
    assert_eq!(read_window(4096, 4096, 98304, 4096), Some((4096, 8192)));
    assert_eq!(read_window(98300, 4096, 98304, 4096), Some((94208, 98304)));
}
#[test]
fn final_partial_block_stops_at_eof() {
    assert_eq!(read_window(4096, 4096, 4103, 4096), Some((4096, 4103)));
}
#[test]
fn zero_length_and_eof_are_noops() {
    assert_eq!(read_window(5, 0, 10, 4096), Some((5, 5)));
    assert_eq!(read_window(10, 1, 10, 4096), Some((10, 10)));
}
#[test]
fn invalid_alignment_range_and_overflow_refuse() {
    assert_eq!(read_window(0, 1, 10, 0), None);
    assert_eq!(read_window(0, 1, 10, 3), None);
    assert_eq!(read_window(11, 1, 10, 4096), None);
    // At exact EOF no bytes are needed; test overflow from inside the range.
    assert_eq!(
        read_window(usize::MAX as u64, 1, usize::MAX, 4096),
        Some((usize::MAX, usize::MAX))
    );
    assert_eq!(
        read_window(usize::MAX as u64 - 1, 4, usize::MAX, 4096),
        None
    );
}
