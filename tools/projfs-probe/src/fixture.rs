//! Deterministic, bounded content and alignment arithmetic for a single file.
pub const NAME: &str = "projected.txt";

pub fn seed() -> Vec<u8> {
    (0..96 * 1024).map(|i| (i % 251) as u8).collect()
}

/// A ProjFS write window: aligned start/end, except the final window at EOF.
pub fn read_window(
    offset: u64,
    length: u32,
    size: usize,
    alignment: u32,
) -> Option<(usize, usize)> {
    if alignment == 0 || !alignment.is_power_of_two() {
        return None;
    }
    let begin = usize::try_from(offset).ok()?;
    if begin > size {
        return None;
    }
    if length == 0 || begin == size {
        return Some((begin, begin));
    }
    let unit = alignment as usize;
    let end = begin.checked_add(length as usize)?.min(size);
    let aligned_end = end.checked_add(unit - 1)? / unit * unit;
    Some((begin / unit * unit, aligned_end.min(size)))
}
