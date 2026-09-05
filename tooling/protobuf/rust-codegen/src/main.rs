use std::{env, fs, io, path::{Path, PathBuf}};

fn collect_proto_files(root: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_proto_files(&path, out)?;
        } else if path.extension().and_then(|x| x.to_str()) == Some("proto") {
            out.push(path);
        }
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let source = PathBuf::from(args.next().ok_or("missing proto source directory")?);
    let output = PathBuf::from(args.next().ok_or("missing Rust output directory")?);

    fs::create_dir_all(&output)?;
    let mut protos = Vec::new();
    collect_proto_files(&source, &mut protos)?;
    protos.sort();
    if protos.is_empty() {
        return Err(format!("no .proto files found under {}", source.display()).into());
    }

    let mut config = prost_build::Config::new();
    config.out_dir(&output);
    config.include_file("mod.rs");
    config.compile_protos(&protos, &[source])?;
    Ok(())
}
