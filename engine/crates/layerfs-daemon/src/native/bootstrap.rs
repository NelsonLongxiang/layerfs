//! Bounded one-shot startup authority on inherited stdin; no credentials in argv.
use super::{failed, refused, Binding, Result};
use layerfs_history::{BranchId, HistoryName, LayerStackId, WorkspaceId};
use std::{io::Read, path::Path};
pub struct Startup {
    pub binding: Binding,
    pub named: Option<(LayerStackId, HistoryName)>,
}
pub fn read(input: &mut impl Read) -> Result<Startup> {
    let mut first = [0u8; 10];
    input
        .read_exact(&mut first)
        .map_err(|_| failed("native startup input failed"))?;
    if &first[..8] == b"LFSREG01" {
        return registered(input, u16::from_le_bytes([first[8], first[9]]) as usize);
    }
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
    answer.map(|binding| Startup {
        binding,
        named: None,
    })
}
fn registered(input: &mut impl Read, home_len: usize) -> Result<Startup> {
    let mut lengths = [0; 4];
    input
        .read_exact(&mut lengths)
        .map_err(|_| failed("registered startup input truncated"))?;
    let project_len = u16::from_le_bytes([lengths[0], lengths[1]]) as usize;
    let branch_len = u16::from_le_bytes([lengths[2], lengths[3]]) as usize;
    let size = home_len + project_len + branch_len + 32;
    if home_len == 0 || home_len > 4096 || project_len == 0 || branch_len == 0 || size > 65535 {
        return Err(refused(0xc000000d, "registered startup control window"));
    }
    let mut bytes = vec![0; size];
    input
        .read_exact(&mut bytes)
        .map_err(|_| failed("registered startup body truncated"))?;
    let workspace = WorkspaceId::from_slice(&bytes[..32])
        .map_err(|_| refused(0xc000000d, "native Workspace identity"))?;
    let text = |b: &[u8]| {
        std::str::from_utf8(b)
            .map(str::to_owned)
            .map_err(|_| refused(0xc000000d, "registered startup UTF-8"))
    };
    let home = text(&bytes[32..32 + home_len])?;
    let project = text(&bytes[32 + home_len..32 + home_len + project_len])?;
    let name = HistoryName::new(&text(&bytes[32 + home_len + project_len..])?)
        .map_err(|_| refused(0xc000000d, "native Branch name"))?;
    let record =
        layerfs_store_service::windows_project::read(Path::new(&home), &project).map_err(|e| {
            if matches!(
                e,
                layerfs_store_service::windows_project::ReadError::Unauthorized
            ) {
                refused(0xc0000022, "registered project is not owner-private")
            } else {
                super::types::sourced(e)
            }
        })?;
    if record.installed.is_none() {
        return Err(refused(0xc000000d, "registered project is not installed"));
    }
    let manifest = record.manifest;
    let branch = BranchId::from_bytes(manifest.branch)
        .map_err(|_| refused(0xc000000d, "project Branch identity"))?;
    let stack = LayerStackId::from_bytes(manifest.stack)
        .map_err(|_| refused(0xc000000d, "project LayerStack identity"))?;
    let binding = Binding::new(manifest.binding, manifest.cursor_key, branch, workspace)?;
    Ok(Startup {
        binding,
        named: Some((stack, name)),
    })
}
