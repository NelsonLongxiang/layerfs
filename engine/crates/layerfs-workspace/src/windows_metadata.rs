//! Persisted Windows Hidden/System/Archive flags through Content's opaque attributes.
//! No OS calls and no alternate metadata encoder. Unannotated roots mean zero.
use layerfs_content::{
    filesystem::attributes::{read_opaque, AttributeKey, AttributeReadWork},
    object::inode_leaf::InodeMetadata,
    AuthenticatedObjects, ContentError, ContentResult,
};

pub(crate) const MASK: u32 = 0x26;
pub(crate) fn key() -> ContentResult<AttributeKey> {
    AttributeKey::new("windows".into(), b"file-attributes".to_vec())
}
pub(crate) fn read(
    reader: &dyn AuthenticatedObjects,
    metadata: InodeMetadata,
) -> ContentResult<u32> {
    let Some(root) = metadata.root() else {
        return Ok(0);
    };
    let Some(bytes) = read_opaque(reader, root, &key()?, 4, &mut AttributeReadWork::default())?
    else {
        return Ok(0);
    };
    let value = u32::from_be_bytes(
        bytes
            .as_slice()
            .try_into()
            .map_err(|_| ContentError::InvalidRecord("Windows attribute width"))?,
    );
    if value & !MASK != 0 {
        return Err(ContentError::InvalidRecord("Windows attribute flags"));
    }
    Ok(value)
}
/// Build or patch all changed attributes in one canonical pass; no read of a
/// newly emitted intermediate root and no alternate attribute encoding.
pub(crate) fn patch(
    reader: &dyn AuthenticatedObjects,
    consumer: &mut dyn layerfs_content::FinalizedConsumer,
    kind: layerfs_content::object::inode_leaf::InodeKind,
    value: layerfs_content::filesystem::attributes::PortableMetadata,
    flags: u32,
    stored: Option<InodeMetadata>,
) -> ContentResult<InodeMetadata> {
    use layerfs_content::filesystem::{
        attributes::{
            apply_patches, build_attribute_tree, emit_value, AttributeEntry, AttributePatch,
        },
        FilesystemObjects,
    };
    let mut objects = FilesystemObjects::new(reader, consumer);
    let mut patches = vec![
        AttributePatch::Set {
            key: AttributeKey::new("portable".into(), b"mode".to_vec())?,
            value: value.mode_bytes(kind)?.to_vec(),
        },
        AttributePatch::Set {
            key: AttributeKey::new("portable".into(), b"mtime".to_vec())?,
            value: value.mtime_bytes()?.to_vec(),
        },
    ];
    patches.push(if flags == 0 {
        AttributePatch::Remove { key: key()? }
    } else {
        AttributePatch::Set {
            key: key()?,
            value: flags.to_be_bytes().to_vec(),
        }
    });
    let root = if let Some(root) = stored.and_then(|m| m.root()) {
        apply_patches(reader, &mut objects, root, &patches)?.0
    } else {
        let mut entries = Vec::new();
        for patch in patches {
            if let AttributePatch::Set { key, value } = patch {
                entries.push(Ok(AttributeEntry {
                    key,
                    value_root: emit_value(&mut objects, &value)?,
                }));
            }
        }
        build_attribute_tree(&mut objects, entries.into_iter())?.0
    };
    Ok(InodeMetadata::Root(root))
}
