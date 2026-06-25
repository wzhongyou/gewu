import type { ManifestV3Export } from '@crxjs/vite-plugin'

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: '格物 Gewu',
  description: '外文网页双栏翻译 + 页面问答阅读助手',
  version: '0.2.0',
  action: {
    default_title: '格物',
    default_popup: 'src/popup/index.html'
  },
  options_page: 'src/options/index.html',
  side_panel: {
    default_path: 'src/sidepanel/index.html'
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle'
    }
  ],
  permissions: ['activeTab', 'scripting', 'storage', 'sidePanel', 'tabs'],
  host_permissions: ['http://*/*', 'https://*/*'],
  web_accessible_resources: [
    {
      matches: ['http://*/*', 'https://*/*'],
      resources: ['src/reader/index.html', 'src/pdf/index.html']
    }
  ],
  icons: {
    16: 'icons/icon_16.png',
    32: 'icons/icon_32.png',
    48: 'icons/icon_48.png',
    128: 'icons/icon_128.png'
  }
}

export default manifest
