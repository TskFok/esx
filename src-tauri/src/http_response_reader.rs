use std::io::{self, Read};

#[derive(Clone, Copy, Debug)]
pub(crate) enum ReadMode {
    Full,
    Preview { max_bytes: usize },
}

pub(crate) fn read_mode(
    mode: Option<&str>,
    preview_bytes: Option<usize>,
) -> Result<ReadMode, String> {
    match mode {
        None | Some("full") => Ok(ReadMode::Full),
        Some("preview") => Ok(ReadMode::Preview {
            max_bytes: preview_bytes.unwrap_or(16 * 1024),
        }),
        Some(_) => Err("不支持的响应读取模式。".into()),
    }
}

pub(crate) struct ReadResult {
    pub body_text: String,
    pub total_bytes: u64,
    pub truncated: bool,
}

pub(crate) const MAX_SAFE_BYTES: u64 = 9_007_199_254_740_991;

fn checked_total_bytes(total: u64, count: u64) -> io::Result<u64> {
    total
        .checked_add(count)
        .filter(|total| *total <= MAX_SAFE_BYTES)
        .ok_or_else(|| io::Error::other("响应字节数超出 JavaScript 安全整数范围。"))
}

pub(crate) fn read_response<R: Read>(reader: R, mode: ReadMode) -> Result<ReadResult, io::Error> {
    read_response_with_charset(reader, mode, None)
}

pub(crate) fn read_response_with_charset<R: Read>(
    mut reader: R,
    mode: ReadMode,
    charset: Option<&str>,
) -> Result<ReadResult, io::Error> {
    let max_bytes = match mode {
        ReadMode::Full => usize::MAX,
        ReadMode::Preview { max_bytes } => max_bytes,
    };
    let mut retained = Vec::new();
    let mut total_bytes = 0u64;
    let mut chunk = [0u8; 16 * 1024];
    loop {
        let count = match reader.read(&mut chunk) {
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            result => result?,
        };
        if count == 0 {
            break;
        }
        total_bytes = checked_total_bytes(total_bytes, count as u64)?;
        let keep = count.min(max_bytes.saturating_sub(retained.len()));
        retained.extend_from_slice(&chunk[..keep]);
    }
    let mut truncated = total_bytes > retained.len() as u64;
    let encoding = charset
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    let mut body_text = if matches!(mode, ReadMode::Full) {
        encoding.decode(&retained).0.into_owned()
    } else {
        // 截断前缀不是流终点：解码器保留未完成字符，不将其变为损坏字符。
        let mut decoder = encoding.new_decoder();
        let capacity = decoder
            .max_utf8_buffer_length(retained.len())
            .ok_or_else(|| io::Error::other("响应解码大小超出可用范围。"))?;
        let mut text = String::with_capacity(capacity);
        let (result, consumed, _) = decoder.decode_to_string(&retained, &mut text, !truncated);
        debug_assert_eq!(result, encoding_rs::CoderResult::InputEmpty);
        debug_assert_eq!(consumed, retained.len());
        text
    };
    if matches!(mode, ReadMode::Preview { .. }) && body_text.len() > max_bytes {
        let mut end = max_bytes;
        while !body_text.is_char_boundary(end) {
            end -= 1;
        }
        body_text.truncate(end);
        truncated = true;
    }
    Ok(ReadResult {
        body_text,
        total_bytes,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Read};
    struct Chunked {
        bytes: Vec<u8>,
        offset: usize,
    }
    impl Read for Chunked {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let n = 7.min(buf.len()).min(self.bytes.len() - self.offset);
            buf[..n].copy_from_slice(&self.bytes[self.offset..self.offset + n]);
            self.offset += n;
            Ok(n)
        }
    }
    #[test]
    fn preview_preserves_utf8_and_drains_to_eof() {
        let input = format!("{}中😀尾", "a".repeat(16383));
        let mut reader = Chunked {
            bytes: input.as_bytes().to_vec(),
            offset: 0,
        };
        let result = read_response(&mut reader, ReadMode::Preview { max_bytes: 16384 }).unwrap();
        assert_eq!(reader.offset, input.len());
        assert_eq!(result.body_text, "a".repeat(16383));
        assert_eq!(result.total_bytes, input.len() as u64);
        assert!(result.truncated);
    }
    #[test]
    fn exact_limit_full_and_errors() {
        for mode in [ReadMode::Full, ReadMode::Preview { max_bytes: 7 }] {
            let result = read_response("中😀".as_bytes(), mode).unwrap();
            assert_eq!(result.body_text, "中😀");
            assert_eq!(result.total_bytes, 7);
            assert!(!result.truncated);
        }
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::other("fixture"))
            }
        }
        assert!(read_response(Broken, ReadMode::Full).is_err());
        assert!(read_response(Broken, ReadMode::Preview { max_bytes: 0 }).is_err());
    }
    #[test]
    fn local_large_response_measurements() {
        use std::time::Instant;
        for mb in [1, 10, 100] {
            let length = mb * 1024 * 1024;
            let started = Instant::now();
            let result = read_response(
                io::repeat(b'x').take(length),
                ReadMode::Preview { max_bytes: 16384 },
            )
            .unwrap();
            assert_eq!(result.total_bytes, length);
            assert_eq!(result.body_text.len(), 16384);
            eprintln!(
                "fixture response_mib={mb} retained_bytes={} total_bytes={} read_us={}",
                result.body_text.len(),
                result.total_bytes,
                started.elapsed().as_micros()
            );
        }
    }
    #[test]
    fn malformed_utf8_and_zero_preview_are_bounded() {
        let result = read_response(
            [0xff, 0xff, 0xff].as_slice(),
            ReadMode::Preview { max_bytes: 2 },
        )
        .unwrap();
        assert!(result.body_text.len() <= 2);
        let expanded =
            read_response([0xff, 0xff].as_slice(), ReadMode::Preview { max_bytes: 2 }).unwrap();
        assert!(expanded.truncated);
        assert!(expanded.body_text.len() <= 2);
        assert!(result.truncated);
        let result =
            read_response(b"error body".as_slice(), ReadMode::Preview { max_bytes: 0 }).unwrap();
        assert!(result.body_text.is_empty());
        assert_eq!(result.total_bytes, 10);
        assert!(result.truncated);
        assert!(matches!(read_mode(None, None).unwrap(), ReadMode::Full));
        assert!(read_mode(Some("invalid"), None).is_err());
    }

    #[test]
    fn preview_preserves_bom_decoding_without_changing_raw_byte_count() {
        let result = read_response(
            b"\xef\xbb\xbf{}".as_slice(),
            ReadMode::Preview { max_bytes: 10 },
        )
        .unwrap();
        assert_eq!(result.body_text, "{}");
        assert_eq!(result.total_bytes, 5);
        assert!(!result.truncated);
    }

    #[test]
    fn preview_decodes_declared_charset_without_partial_characters() {
        let result = read_response_with_charset(
            [0xe9].as_slice(),
            ReadMode::Preview { max_bytes: 8 },
            Some("windows-1252"),
        )
        .unwrap();
        assert_eq!(result.body_text, "é");
        assert_eq!(result.total_bytes, 1);
        assert!(!result.truncated);
        let (gbk, _, _) = encoding_rs::GBK.encode("中文");
        let result = read_response_with_charset(
            gbk.as_ref(),
            ReadMode::Preview { max_bytes: 3 },
            Some("gbk"),
        )
        .unwrap();
        assert_eq!(result.body_text, "中");
        assert_eq!(result.total_bytes, 4);
        assert!(result.truncated);
    }

    #[test]
    fn full_preserves_charset_and_bom_decoding() {
        let result =
            read_response_with_charset([0xe9].as_slice(), ReadMode::Full, Some("windows-1252"))
                .unwrap();
        assert_eq!(result.body_text, "é");
        assert_eq!(result.total_bytes, 1);
        assert_eq!(
            read_response(b"\xef\xbb\xbf{}".as_slice(), ReadMode::Full)
                .unwrap()
                .body_text,
            "{}"
        );
    }

    #[test]
    fn unsafe_js_byte_counts_return_errors() {
        assert_eq!(
            checked_total_bytes(MAX_SAFE_BYTES - 1, 1).unwrap(),
            MAX_SAFE_BYTES
        );
        assert!(checked_total_bytes(MAX_SAFE_BYTES, 1).is_err());
        assert!(checked_total_bytes(u64::MAX, 1).is_err());
    }
}
