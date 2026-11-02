//! Bounded one-shot startup authority on inherited stdin; no credentials in argv.
use super::{failed, refused, Binding, Result};
use layerfs_history::{BranchId, WorkspaceId};
use std::io::Read;
pub fn read(input: &mut impl Read) -> Result<Binding> {
    let mut first = [0u8; 10];
    input
        .read_exact(&mut first)
        .map_err(|_| failed("native startup input failed"))?;
    if &first[..8] != b"LFSBND01" {
        return Err(refused(0xc000000d, "native startup frame version"));
    }
    let n = u16::from_le_bytes([first[8], first[9]]) as usize;
    if !(1..=128).contains(&n) {
        return Err(refused(0xc000000d, "native catalog window"));
    }
    let mut frame = vec![0; n + 81];
    let answer = (|| {
        input
            .read_exact(&mut frame)
            .map_err(|_| failed("native startup input truncated"))?;
        let branch = BranchId::from_slice(&frame[n + 32..n + 49])
            .map_err(|_| refused(0xc000000d, "native Branch identity"))?;
        let workspace = WorkspaceId::from_slice(&frame[n + 49..])
            .map_err(|_| refused(0xc000000d, "native Workspace identity"))?;
        Binding::new(
            frame[..n].to_vec(),
            frame[n..n + 32].try_into().expect("width"),
            branch,
            workspace,
        )
    })();
    frame.fill(0);
    answer
}
