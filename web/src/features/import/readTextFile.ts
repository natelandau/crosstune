/**
 * A text file's contents: UTF-16 when it opens with a UTF-16 byte-order mark, as Notepad saves
 * "Unicode", and UTF-8 otherwise. The decoder drops the mark either way.
 */
export async function readTextFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8'
  return new TextDecoder(encoding).decode(bytes)
}
