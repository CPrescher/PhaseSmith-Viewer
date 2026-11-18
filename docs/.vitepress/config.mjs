import { defineConfig } from 'vitepress';

// CI supplies the same repository prefix used by the viewer build.
const viewerBase = (process.env.VITE_BASE_PATH || '/').replace(/\/?$/, '/');
export default defineConfig({
  lang: 'en-US',
  title: 'PhaseSmith Viewer',
  description: 'Explore crystal structures: a practical guide to coordination, lattice planes, symmetry, measurements and diffraction.',
  srcDir: 'guide',
  outDir: '../dist/docs',
  base: `${viewerBase}docs/`,
  cleanUrls: false,
  head: [['link', { rel: 'icon', href: `${viewerBase}docs/icon.svg`, type: 'image/svg+xml' }]],
  themeConfig: {
    logo: { src: '/icon.svg', alt: '' },
    siteTitle: 'PhaseSmith Viewer',
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Tutorials', link: '/tutorials' },
      { text: 'Open viewer ↗', link: `https://cprescher.github.io/PhaseSmith-Viewer/`, target: '_blank', rel: 'noopener' },
    ],
    sidebar: [
      { text: 'Start here', items: [
        { text: 'Overview', link: '/' },
        { text: 'Your first structure', link: '/getting-started' },
        { text: 'Worked examples', link: '/tutorials' },
      ] },
      { text: 'Using the viewer', items: [
        { text: 'Files and structure library', link: '/structures' },
        { text: 'Navigation and display', link: '/navigation' },
        { text: 'Measurements and sites', link: '/measurements' },
        { text: 'Bonds and polyhedra', link: '/coordination' },
        { text: 'Planes, directions and symmetry', link: '/lattice' },
        { text: 'Pair distances and diffraction', link: '/plots' },
        { text: 'Saving and exporting', link: '/saving' },
      ] },
      { text: 'Reference', items: [
        { text: 'Scientific conventions', link: '/science' },
        { text: 'Troubleshooting', link: '/troubleshooting' },
        { text: 'Development and documentation', link: '/development' },
      ] },
    ],
    search: { provider: 'local' },
    outline: [2, 3],
    socialLinks: [{ icon: 'github', link: 'https://github.com/CPrescher/PhaseSmith-Viewer' }],
    editLink: { pattern: 'https://github.com/CPrescher/PhaseSmith-Viewer/edit/main/docs/guide/:path', text: 'Improve this page on GitHub' },
    footer: { message: 'Crystal structures, explored in your browser.' },
  },
});
