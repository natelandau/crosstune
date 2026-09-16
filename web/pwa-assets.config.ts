import { defineConfig } from '@vite-pwa/assets-generator/config'

// The source tile is already slate with rounded corners. Padding and filling with the same
// slate lets the maskable and Apple icons stay opaque squares with the corners invisible.
const slate = '#2d3142'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: {
      sizes: [64, 192, 512],
      favicons: [[48, 'favicon.ico']],
      padding: 0,
    },
    // 0.3 padding shrinks the tile to 70%, which puts every part of the mark inside the 80%
    // safe circle a launcher may mask to.
    maskable: {
      sizes: [512],
      padding: 0.3,
      resizeOptions: { fit: 'contain', background: slate },
    },
    apple: {
      sizes: [180],
      padding: 0,
      resizeOptions: { fit: 'contain', background: slate },
    },
  },
  images: ['public/logo.svg'],
})
