// subset-font ships no type declarations. This covers the call fonts.ts makes.
declare module 'subset-font' {
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: { targetFormat?: 'sfnt' | 'woff' | 'woff2' },
  ): Promise<Buffer>
}
